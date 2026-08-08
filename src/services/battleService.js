// battleService — TikTok-style live battles.
//
// A "battle" is a scheduled head-to-head live event between two creators. One
// creator creates it and invites an opponent; the opponent accepts or rejects.
// At the scheduled time both go live together in one shared room (split screen)
// and viewers vote / gift to decide a winner (glory only).
//
// Optionally a battle is "staked": each side puts down an equal coin deposit as
// an ATTENDANCE BOND. The deposit is settled in real coins (never gems):
//   - both turn up   -> each gets their stake back
//   - one turns up   -> that person takes the whole pot
//   - nobody turns up -> the app keeps it
// Money lives in the authoritative live-service wallet; this client only asks it
// to move coins and mirrors social/discovery state into Firestore `battles`.
//
// Everything degrades gracefully: no Firebase -> no-op; no live-service -> the
// (free) social flow still works and staking simply reports the failure.

import { db, firebaseEnabled } from '../config/firebase';
import { increment } from 'firebase/firestore';
import { fixStorageUrl } from '../utils/urlUtils';
import {
  battleDeposit as apiBattleDeposit,
  makeIdempotencyKey,
} from '../api/economyLiveApi';
import {
  acceptBattleArena as apiAcceptBattleArena,
  cancelBattleArena as apiCancelBattleArena,
  declineBattleArena as apiDeclineBattleArena,
  endBattleArena as apiEndBattleArena,
  getBattleArena as apiGetBattleArena,
  registerBattleArena as apiRegisterBattleArena,
  voteBattleArena as apiVoteBattleArena,
} from '../api/battleArenaApi';
import { createReminder } from './reminderService';

const BATTLES = 'battles';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BATTLE_STATUS = {
  PENDING: 'pending', // invite sent, awaiting opponent
  SCHEDULED: 'scheduled', // accepted, waiting for start time
  LIVE: 'live', // happening now
  COMPLETED: 'completed', // finished + settled
  REJECTED: 'rejected', // opponent declined
  CANCELLED: 'cancelled', // creator pulled it before start
  EXPIRED: 'expired', // start time passed without acceptance
};

// Coin stake presets shown in the create flow. 0 == free (no deposit).
export const STAKE_PRESETS = [0, 50, 100, 500];

export const DEFAULT_DURATION_SEC = 300; // 5 minutes, like a TikTok battle
export const JOIN_GRACE_MS = 2 * 60 * 1000; // server no-show grace after published start

export function isStaked(battle) {
  return !!battle && battle.depositMode === 'staked' && Number(battle.stakeCoins) > 0;
}

/** Which side of the battle this uid is on, or null for a viewer. */
export function battleSideFor(battle, uid) {
  if (!battle || !uid) return null;
  if (battle.creatorUid === uid) return 'creator';
  if (battle.opponentUid === uid) return 'opponent';
  return null;
}

export function watchTypeLabelForBattle() {
  return 'battle';
}

function userPhoto(u) {
  return fixStorageUrl(u?.photoURL || u?.avatar || u?.userPhotoURL || u?.photo || '');
}

// ---------------------------------------------------------------------------
// Person resolution (opponent picker)
// ---------------------------------------------------------------------------

/**
 * Search the users collection for people matching a free-text query. Returns a
 * ranked list of { id, displayName, username, photoURL }.
 */
export async function searchUsers(queryText, excludeUid, limit = 20) {
  if (!firebaseEnabled || !db?.collection) return [];
  const q = String(queryText || '').replace(/^@/, '').trim().toLowerCase();
  try {
    const snap = await db.collection('users').limit(200).get();
    const all = (snap?.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u?.id && u.id !== excludeUid);

    const scored = [];
    for (const u of all) {
      const username = String(u.username || '').toLowerCase();
      const display = String(u.displayName || u.name || '').toLowerCase();
      let score = 0;
      if (!q) {
        score = 1; // no query -> show everyone (recent-ish order below)
      } else if (username === q || display === q) score = 100;
      else if (username.startsWith(q) || display.startsWith(q)) score = 80;
      else if (username.includes(q) || display.includes(q)) score = 50;
      if (score > 0) {
        scored.push({
          score,
          user: {
            id: u.id,
            displayName: u.displayName || u.name || u.username || 'User',
            username: u.username || '',
            photoURL: userPhoto(u),
          },
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.user);
  } catch {
    return [];
  }
}

/** Resolve a single user's public profile { id, displayName, username, photoURL }. */
export async function getUserProfile(uid) {
  if (!firebaseEnabled || !db?.collection || !uid) return null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    const u = typeof snap?.data === 'function' ? snap.data() : null;
    if (!u) return { id: uid, displayName: 'You', username: '', photoURL: '' };
    return {
      id: uid,
      displayName: u.displayName || u.name || u.username || 'You',
      username: u.username || '',
      photoURL: userPhoto(u),
    };
  } catch {
    return { id: uid, displayName: 'You', username: '', photoURL: '' };
  }
}

// ---------------------------------------------------------------------------
// Creation + lifecycle
// ---------------------------------------------------------------------------

function battleRef(id) {
  return db.collection(BATTLES).doc(id);
}

function newBattleId() {
  return `btl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a battle invite. `creator` and `opponent` are
 * { id, displayName, username, photoURL }. For staked battles the creator's
 * deposit is taken now (they authorise their own debit); the opponent's is
 * taken when they accept. Returns { ok, id, battle } or { ok:false, reason }.
 */
export async function createBattle(creator, opponent, opts = {}) {
  if (!firebaseEnabled || !db?.collection) return { ok: false, reason: 'unavailable' };
  if (!creator?.id || !opponent?.id) return { ok: false, reason: 'missing_participants' };
  if (creator.id === opponent.id) return { ok: false, reason: 'self' };

  const id = newBattleId();
  const stakeCoins = Math.max(0, Math.round(Number(opts.stakeCoins) || 0));
  const depositMode = stakeCoins > 0 ? 'staked' : 'free';
  const now = Date.now();
  const scheduledStartAt = Number(opts.scheduledStartAt) || now + 10 * 60 * 1000;

  let creatorPaid = false;
  const battle = {
    creatorUid: creator.id,
    creatorName: creator.displayName || creator.username || 'User',
    creatorUsername: creator.username || '',
    creatorPhoto: creator.photoURL || '',
    opponentUid: opponent.id,
    opponentName: opponent.displayName || opponent.username || 'User',
    opponentUsername: opponent.username || '',
    opponentPhoto: opponent.photoURL || '',
    participantsUids: [creator.id, opponent.id],
    status: BATTLE_STATUS.PENDING,
    title: String(opts.title || '').trim() || `${creator.displayName || 'Creator'} vs ${opponent.displayName || 'Opponent'}`,
    scheduledStartAt,
    durationSec: Math.max(60, Math.round(Number(opts.durationSec) || DEFAULT_DURATION_SEC)),
    depositMode,
    stakeCoins,
    creatorPaid,
    opponentPaid: false,
    notifySupporters: opts.notifySupporters !== false,
    liveStreamId: null,
    stageArn: null,
    creatorJoined: false,
    opponentJoined: false,
    score: { creator: 0, opponent: 0 },
    winnerUid: null,
    settlement: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    // Register every battle before any stage or escrow dependency. This is the
    // authoritative event row that makes free battles fully startable.
    const arena = await apiRegisterBattleArena({
      battleId: id,
      opponentUid: opponent.id,
      creatorName: battle.creatorName,
      creatorUsername: battle.creatorUsername,
      opponentName: battle.opponentName,
      opponentUsername: battle.opponentUsername,
      title: battle.title,
      scheduledStartAt,
      durationSec: battle.durationSec,
      depositMode,
      stakeCoins,
    });
    battle.serverState = arena.state;
    battle.serverVersion = arena.version;
    battle.roomId = arena.roomId;

    if (depositMode === 'staked') {
      const dep = await depositForBattle(id, 'creator', stakeCoins, creator.id, opponent.id);
      if (!dep.ok) {
        await apiCancelBattleArena(id).catch(() => {});
        return { ok: false, reason: dep.reason || 'deposit_failed' };
      }
      creatorPaid = true;
      battle.creatorPaid = true;
    }

    await battleRef(id).set(battle, { merge: true });
    const created = { id, ...battle };
    // Local + server reminder so the scheduled fight isn't missed.
    await setBattleReminder(created, creator.id, 10).catch(() => {});
    return { ok: true, id, battle: created };
  } catch (e) {
    console.warn('[battleService] createBattle write failed', e?.code || e?.message || e);
    // Closing the server event refunds any stake and held gifts idempotently.
    await apiCancelBattleArena(id).catch(() => {});
    const code = e?.code;
    if (code === 'INSUFFICIENT_FUNDS') return { ok: false, reason: 'insufficient_funds' };
    return { ok: false, reason: creatorPaid ? 'write_failed' : 'registry_failed' };
  }
}

/** Opponent accepts. Takes their deposit (staked) then flips to scheduled. */
export async function acceptBattle(battle, uid) {
  if (!battle?.id || battle.opponentUid !== uid) return { ok: false, reason: 'not_invitee' };
  if (battle.status !== BATTLE_STATUS.PENDING) return { ok: false, reason: 'not_pending' };

  if (isStaked(battle) && !battle.opponentPaid) {
    const dep = await depositForBattle(battle.id, 'opponent', battle.stakeCoins, battle.creatorUid, uid);
    if (!dep.ok) return { ok: false, reason: dep.reason || 'deposit_failed' };
  }

  try {
    const arena = await apiAcceptBattleArena(battle.id);
    await battleRef(battle.id).update({
      status: BATTLE_STATUS.SCHEDULED,
      serverState: arena.state,
      serverVersion: arena.version,
      opponentPaid: isStaked(battle) ? true : battle.opponentPaid,
      acceptedAt: Date.now(),
      updatedAt: Date.now(),
    });
    // Opponent reminder once the fight is locked in as scheduled.
    await setBattleReminder(
      { ...battle, status: BATTLE_STATUS.SCHEDULED },
      uid,
      10
    ).catch(() => {});
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write_failed' };
  }
}

/** Opponent rejects. Refunds the creator's deposit if one was taken. */
export async function rejectBattle(battle, uid) {
  if (!battle?.id || battle.opponentUid !== uid) return { ok: false, reason: 'not_invitee' };
  if (battle.status !== BATTLE_STATUS.PENDING) return { ok: false, reason: 'not_pending' };
  try {
    const arena = await apiDeclineBattleArena(battle.id);
    await battleRef(battle.id).update({
      status: BATTLE_STATUS.REJECTED,
      serverState: arena.state,
      serverVersion: arena.version,
      updatedAt: Date.now(),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write_failed' };
  }
}

/** Either participant cancels before it goes live. Refunds any deposits taken. */
export async function cancelBattle(battle, uid) {
  if (!battle?.id || !battleSideFor(battle, uid)) return { ok: false, reason: 'not_participant' };
  if (![BATTLE_STATUS.PENDING, BATTLE_STATUS.SCHEDULED].includes(battle.status)) {
    return { ok: false, reason: 'too_late' };
  }
  try {
    const arena = await apiCancelBattleArena(battle.id);
    await battleRef(battle.id).update({
      status: BATTLE_STATUS.CANCELLED,
      serverState: arena.state,
      serverVersion: arena.version,
      updatedAt: Date.now(),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write_failed' };
  }
}

// ---------------------------------------------------------------------------
// Live lifecycle (mirrors the authoritative live-service attendance)
// ---------------------------------------------------------------------------

/** Confirm the attendance recorded by the battle stage endpoint. */
export async function markJoined(battle, uid, { liveStreamId, stageArn } = {}) {
  const side = battleSideFor(battle, uid);
  if (!side) return { ok: false, reason: 'not_participant' };
  try {
    const arena = await apiGetBattleArena(battle.id);
    const joined = side === 'creator' ? arena.sideA.joined : arena.sideB.joined;
    return { ok: joined, reason: joined ? undefined : 'attendance_pending', battle: arena };
  } catch (e) {
    return { ok: false, reason: e?.code || 'unavailable' };
  }
}

/** Held gifts are delivered server-side when the battle enters LIVE. */
export async function deliverBattleGiftPledges(battle) {
  if (!battle?.id) return { ok: false, reason: 'missing' };
  try {
    const arena = await apiGetBattleArena(battle.id);
    return { ok: true, battle: arena };
  } catch (e) {
    return { ok: false, reason: e?.code || 'unavailable' };
  }
}

/** The server starts countdown/live when both fixed-side publishers are present. */
export async function startMatch(battle, uid) {
  const side = battleSideFor(battle, uid);
  if (!side || !battle?.id) return { ok: false, reason: 'not_participant' };
  try {
    const arena = await apiGetBattleArena(battle.id);
    const started = ['COUNTDOWN', 'LIVE', 'FINALIZING', 'ENDED'].includes(arena.state);
    return { ok: started, reason: started ? undefined : 'waiting_for_opponent', battle: arena };
  } catch (e) {
    return { ok: false, reason: e?.code || 'unavailable' };
  }
}

/** Ask the server to finalize score and escrow. */
export async function endBattle(battle, uid) {
  if (!battle?.id) return { ok: false, reason: 'missing' };
  try {
    const arena = await apiEndBattleArena(battle.id);
    const winnerUid = arena.winnerSide === 'A'
      ? arena.sideA.userId
      : arena.winnerSide === 'B'
        ? arena.sideB.userId
        : null;
    return { ok: true, winnerUid, settlement: arena.settlement, battle: arena };
  } catch (e) {
    return { ok: false, reason: e?.code || 'end_failed' };
  }
}

// ---------------------------------------------------------------------------
// Scoring (votes + gift weight)
// ---------------------------------------------------------------------------

/** A viewer votes once; uniqueness and score update are server-enforced. */
export async function voteBattle(battleId, voterUid, side) {
  if (!battleId || !voterUid) return { ok: false, reason: 'unavailable' };
  if (side !== 'creator' && side !== 'opponent') return { ok: false, reason: 'bad_side' };
  try {
    const result = await apiVoteBattleArena(battleId, side === 'creator' ? 'A' : 'B');
    return { ok: result.applied, reason: result.applied ? undefined : 'already_voted', battle: result.battle };
  } catch (e) {
    return { ok: false, reason: e?.code || 'failed' };
  }
}

/** @deprecated Battle gift score is committed in the send-gift transaction. */
export async function addGiftScore(battleId, side, coinValue) {
  return false;
}

/**
 * Record a viewer's gift contribution for top-gifter avatars on the MatchBar.
 * Best-effort; never blocks scoring.
 */
export async function recordBattleGifterContribution(battleId, side, gifter, coinValue) {
  if (!firebaseEnabled || !battleId || !gifter?.uid) return;
  if (side !== 'creator' && side !== 'opponent') return;
  const amount = Math.max(1, Math.round(Number(coinValue) || 0));
  try {
    await battleRef(battleId).collection('contributors').doc(String(gifter.uid)).set({
      uid: String(gifter.uid),
      side,
      coins: increment(amount),
      name: gifter.name || gifter.displayName || gifter.handle || 'Fan',
      photoURL: gifter.photoURL || gifter.avatarUrl || gifter.photo || '',
      updatedAt: Date.now(),
    }, { merge: true });
  } catch {
    /* ignore */
  }
}

/** Subscribe to battle gift contributors (for top 1–3 avatars per side). */
export function subscribeBattleContributors(battleId, cb) {
  if (!firebaseEnabled || !battleId) {
    cb([]);
    return () => {};
  }
  try {
    return battleRef(battleId)
      .collection('contributors')
      .limit(40)
      .onSnapshot(
        (snap) => {
          const rows = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
          cb(rows);
        },
        () => cb([])
      );
  } catch {
    cb([]);
    return () => {};
  }
}

/** Top N contributors for a side, sorted by coins desc. */
export function topGiftersForSide(contributors, side, limit = 3) {
  return (contributors || [])
    .filter((c) => c && c.side === side && Number(c.coins) > 0)
    .sort((a, b) => Number(b.coins || 0) - Number(a.coins || 0))
    .slice(0, limit)
    .map((c) => ({
      uid: c.uid || c.id,
      name: c.name || 'Fan',
      photoURL: c.photoURL || '',
      coins: Number(c.coins) || 0,
    }));
}

/**
 * Host challenges an on-stage guest mid-live: creates (or adopts) a free battle
 * already in LIVE status with both sides joined. Match clock stays off until
 * Start match. No stake / no pending invite.
 */
export async function challengeGuestInLive(host, guest, opts = {}) {
  if (!firebaseEnabled || !db?.collection) return { ok: false, reason: 'unavailable' };
  if (!host?.id || !guest?.id) return { ok: false, reason: 'missing_participants' };
  if (host.id === guest.id) return { ok: false, reason: 'self' };

  const liveStreamId = opts.liveStreamId || null;
  const now = Date.now();
  const durationSec = Math.max(60, Math.round(Number(opts.durationSec) || DEFAULT_DURATION_SEC));

  // Adopt an existing open battle between these two on this stream, if any.
  if (liveStreamId) {
    try {
      const snap = await db
        .collection(BATTLES)
        .where('liveStreamId', '==', liveStreamId)
        .limit(12)
        .get();
      const open = (snap?.docs || [])
        .map((d) => ({ id: d.id, ...d.data() }))
        .find((b) => {
          if (![BATTLE_STATUS.PENDING, BATTLE_STATUS.SCHEDULED, BATTLE_STATUS.LIVE].includes(b.status)) {
            return false;
          }
          if (b.liveStartedAt && b.status === BATTLE_STATUS.LIVE) return false;
          const pair = new Set([b.creatorUid, b.opponentUid]);
          return pair.has(host.id) && pair.has(guest.id);
        });
      if (open) {
        await battleRef(open.id).update({
          status: BATTLE_STATUS.LIVE,
          creatorJoined: true,
          opponentJoined: true,
          liveStreamId,
          durationSec: open.durationSec || durationSec,
          updatedAt: now,
          instantChallenge: true,
        });
        return { ok: true, id: open.id, battle: { ...open, status: BATTLE_STATUS.LIVE, liveStreamId }, adopted: true };
      }
    } catch {
      /* fall through to create */
    }
  }

  const id = newBattleId();
  const hostName = host.displayName || host.username || host.name || 'Host';
  const guestName = guest.displayName || guest.username || guest.name || 'Guest';
  const battle = {
    creatorUid: host.id,
    creatorName: hostName,
    creatorUsername: host.username || '',
    creatorPhoto: host.photoURL || '',
    opponentUid: guest.id,
    opponentName: guestName,
    opponentUsername: guest.username || '',
    opponentPhoto: guest.photoURL || '',
    participantsUids: [host.id, guest.id],
    status: BATTLE_STATUS.LIVE,
    title: String(opts.title || '').trim() || `${hostName} vs ${guestName}`,
    scheduledStartAt: now,
    durationSec,
    depositMode: 'free',
    stakeCoins: 0,
    creatorPaid: false,
    opponentPaid: false,
    notifySupporters: false,
    liveStreamId,
    stageArn: opts.stageArn || null,
    creatorJoined: true,
    opponentJoined: true,
    score: { creator: 0, opponent: 0 },
    winnerUid: null,
    settlement: null,
    instantChallenge: true,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await battleRef(id).set(battle);
    return { ok: true, id, battle: { id, ...battle } };
  } catch (e) {
    console.warn('[battleService] challengeGuestInLive failed', e?.code || e?.message || e);
    return { ok: false, reason: 'write_failed' };
  }
}

/**
 * Rematch after a completed battle: new free LIVE record on the same stream,
 * scores reset, clock not started until Start match.
 */
export async function rematchBattle(prevBattle, uid, opts = {}) {
  if (!prevBattle?.id) return { ok: false, reason: 'missing' };
  if (!battleSideFor(prevBattle, uid)) return { ok: false, reason: 'not_participant' };
  if (prevBattle.status !== BATTLE_STATUS.COMPLETED) return { ok: false, reason: 'not_completed' };

  const host = {
    id: prevBattle.creatorUid,
    displayName: prevBattle.creatorName,
    username: prevBattle.creatorUsername,
    photoURL: prevBattle.creatorPhoto,
  };
  const guest = {
    id: prevBattle.opponentUid,
    displayName: prevBattle.opponentName,
    username: prevBattle.opponentUsername,
    photoURL: prevBattle.opponentPhoto,
  };
  // Keep creator/opponent roles stable across rematches.
  const res = await challengeGuestInLive(host, guest, {
    liveStreamId: opts.liveStreamId || prevBattle.liveStreamId || null,
    stageArn: opts.stageArn || prevBattle.stageArn || null,
    durationSec: opts.durationSec || prevBattle.durationSec || DEFAULT_DURATION_SEC,
    title: prevBattle.title || `${host.displayName} vs ${guest.displayName}`,
  });
  if (res.ok) {
    try {
      await battleRef(prevBattle.id).update({
        rematchBattleId: res.id,
        updatedAt: Date.now(),
      });
    } catch {
      /* ignore */
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// Reminders — a viewer asks to be reminded before a battle starts.
// We schedule a local notification immediately (instant, offline) AND write an
// opt-in doc the backend turns into a reliable server push via sendAfter.
// ---------------------------------------------------------------------------

/** Set a "remind me before this battle" for a viewer. leadMinutes before start. */
export async function setBattleReminder(battle, uid, leadMinutes = 10) {
  if (!battle?.id || !uid) return { ok: false, reason: 'missing' };
  const lead = Math.max(0, Math.round(Number(leadMinutes) || 0));

  // 1) Local notification — works offline, fires on this device.
  try {
    await createReminder(uid, {
      task: `Battle: ${battle.title || 'Live battle'}`,
      event: new Date(Number(battle.scheduledStartAt) || Date.now()),
      leadMinutes: lead,
    });
  } catch {
    /* ignore — server reminder below is the reliable path */
  }

  // 2) Server opt-in — a Cloud Function turns this into a scheduled push.
  if (firebaseEnabled && db?.collection) {
    try {
      await battleRef(battle.id).collection('reminders').doc(uid).set({
        uid,
        leadMinutes: lead,
        scheduledStartAt: Number(battle.scheduledStartAt) || Date.now(),
        createdAt: Date.now(),
      });
    } catch {
      /* ignore */
    }
  }
  return { ok: true, leadMinutes: lead };
}

export async function removeBattleReminder(battleId, uid) {
  if (!firebaseEnabled || !battleId || !uid) return;
  try {
    await battleRef(battleId).collection('reminders').doc(uid).delete();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Reads / subscriptions
// ---------------------------------------------------------------------------

export async function getBattle(id) {
  if (!firebaseEnabled || !id) return null;
  try {
    const snap = await battleRef(id).get();
    const data = typeof snap?.data === 'function' ? snap.data() : null;
    if (!data) return null;
    return { id, ...data };
  } catch {
    return null;
  }
}

export function subscribeBattle(id, cb) {
  if (!firebaseEnabled || !id) return () => {};
  try {
    return battleRef(id).onSnapshot((snap) => {
      const data = typeof snap?.data === 'function' ? snap.data() : null;
      cb(data ? { id, ...data } : null);
    });
  } catch {
    return () => {};
  }
}

/** Fetch and reconcile the authoritative server lifecycle. */
export async function refreshBattleArena(id) {
  if (!id) return { ok: false, reason: 'missing' };
  try {
    const battle = await apiGetBattleArena(id);
    return { ok: true, battle };
  } catch (e) {
    return { ok: false, reason: e?.code || 'unavailable' };
  }
}

const PUBLIC_STATUSES = [BATTLE_STATUS.SCHEDULED, BATTLE_STATUS.LIVE];

/**
 * Subscribe to the public upcoming + live battles list (for the Battles tab).
 * Queries a recent time window and filters status client-side to avoid a
 * composite index.
 */
export function subscribeUpcomingBattles(cb, { windowMs = 6 * 60 * 60 * 1000, limit = 60 } = {}) {
  if (!firebaseEnabled || !db?.collection) {
    cb([]);
    return () => {};
  }
  try {
    const cutoff = Date.now() - windowMs;
    return db
      .collection(BATTLES)
      .where('scheduledStartAt', '>=', cutoff)
      .orderBy('scheduledStartAt', 'asc')
      .limit(limit)
      .onSnapshot(
        (snap) => {
          const rows = (snap?.docs || [])
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((b) => PUBLIC_STATUSES.includes(b.status));
          cb(rows);
        },
        () => cb([])
      );
  } catch {
    cb([]);
    return () => {};
  }
}

/** Subscribe to battle invites where I'm the opponent and it's still pending. */
export function subscribePendingInvites(uid, cb) {
  if (!firebaseEnabled || !db?.collection || !uid) {
    cb([]);
    return () => {};
  }
  try {
    return db
      .collection(BATTLES)
      .where('opponentUid', '==', uid)
      .limit(30)
      .onSnapshot(
        (snap) => {
          const rows = (snap?.docs || [])
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((b) => b.status === BATTLE_STATUS.PENDING)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          cb(rows);
        },
        () => cb([])
      );
  } catch {
    cb([]);
    return () => {};
  }
}

/**
 * Subscribe to every battle this user is a participant in (creator OR opponent),
 * across all statuses — the data source for the Battle Diary (history + planner).
 * Uses a single array-contains filter on `participantsUids` and sorts client-side
 * to avoid a composite index, matching the socialImportService pattern.
 */
export function subscribeMyBattles(uid, cb) {
  const safeCb = typeof cb === 'function' ? cb : () => {};
  if (!firebaseEnabled || !db?.collection || !uid || typeof uid !== 'string') {
    safeCb([]);
    return () => {};
  }
  try {
    return db
      .collection(BATTLES)
      .where('participantsUids', 'array-contains', uid)
      .limit(200)
      .onSnapshot(
        (snap) => {
          const rows = (snap?.docs || [])
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.scheduledStartAt || b.createdAt || 0) - (a.scheduledStartAt || a.createdAt || 0));
          safeCb(rows);
        },
        () => safeCb([])
      );
  } catch {
    safeCb([]);
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// Deposit helper (live-service)
// ---------------------------------------------------------------------------

async function depositForBattle(battleId, role, stakeCoins, creatorUid, opponentUid) {
  try {
    await apiBattleDeposit({
      battleId,
      role,
      stakeCoins,
      creatorUid,
      opponentUid,
      idempotencyKey: makeIdempotencyKey(`btldep:${battleId}:${role}`),
    });
    return { ok: true };
  } catch (e) {
    const code = e?.code;
    if (code === 'INSUFFICIENT_FUNDS') return { ok: false, reason: 'insufficient_funds' };
    return { ok: false, reason: 'deposit_failed' };
  }
}

export default {
  BATTLE_STATUS,
  STAKE_PRESETS,
  DEFAULT_DURATION_SEC,
  JOIN_GRACE_MS,
  isStaked,
  battleSideFor,
  searchUsers,
  getUserProfile,
  createBattle,
  acceptBattle,
  rejectBattle,
  cancelBattle,
  markJoined,
  startMatch,
  deliverBattleGiftPledges,
  endBattle,
  voteBattle,
  addGiftScore,
  recordBattleGifterContribution,
  subscribeBattleContributors,
  topGiftersForSide,
  challengeGuestInLive,
  rematchBattle,
  setBattleReminder,
  removeBattleReminder,
  getBattle,
  subscribeBattle,
  subscribeUpcomingBattles,
  subscribePendingInvites,
  subscribeMyBattles,
};
