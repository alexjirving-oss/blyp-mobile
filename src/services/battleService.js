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

import { db, firestore, firebaseEnabled } from '../config/firebase';
import { increment, runTransaction, doc as fsDoc } from 'firebase/firestore';
import { fixStorageUrl } from '../utils/urlUtils';
import {
  battleDeposit as apiBattleDeposit,
  battleCancelRefund as apiBattleCancelRefund,
  battleSettle as apiBattleSettle,
  makeIdempotencyKey,
} from '../api/economyLiveApi';
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
export const JOIN_GRACE_MS = 5 * 60 * 1000; // must go live within 5 min of start

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

  // Take the creator's deposit first for staked battles — if it fails we never
  // create a half-funded battle.
  let creatorPaid = false;
  if (depositMode === 'staked') {
    const dep = await depositForBattle(id, 'creator', stakeCoins, creator.id, opponent.id);
    if (!dep.ok) return { ok: false, reason: dep.reason || 'deposit_failed' };
    creatorPaid = true;
  }

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
    await battleRef(id).set(battle);
    return { ok: true, id, battle: { id, ...battle } };
  } catch (e) {
    // Roll back the creator's deposit so they're not charged for a phantom battle.
    if (creatorPaid) {
      await apiBattleCancelRefund({ battleId: id, idempotencyKey: makeIdempotencyKey('btlrefund') }).catch(() => {});
    }
    return { ok: false, reason: 'write_failed' };
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
    await battleRef(battle.id).update({
      status: BATTLE_STATUS.SCHEDULED,
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
  await refundIfStaked(battle);
  try {
    await battleRef(battle.id).update({ status: BATTLE_STATUS.REJECTED, updatedAt: Date.now() });
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
  await refundIfStaked(battle);
  try {
    await battleRef(battle.id).update({ status: BATTLE_STATUS.CANCELLED, updatedAt: Date.now() });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write_failed' };
  }
}

async function refundIfStaked(battle) {
  if (!isStaked(battle)) return;
  if (!battle.creatorPaid && !battle.opponentPaid) return;
  await apiBattleCancelRefund({ battleId: battle.id, idempotencyKey: makeIdempotencyKey('btlrefund') }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Live lifecycle (mirrors the authoritative live-service attendance)
// ---------------------------------------------------------------------------

/**
 * Mark this participant as having gone live on the shared stage.
 * Does NOT start the match clock — call startMatch when both sides are ready
 * (or when the host taps Start match).
 */
export async function markJoined(battle, uid, { liveStreamId, stageArn } = {}) {
  const side = battleSideFor(battle, uid);
  if (!side) return { ok: false, reason: 'not_participant' };
  const patch = { updatedAt: Date.now(), status: BATTLE_STATUS.LIVE };
  patch[side === 'creator' ? 'creatorJoined' : 'opponentJoined'] = true;
  if (liveStreamId) patch.liveStreamId = liveStreamId;
  if (stageArn) patch.stageArn = stageArn;
  try {
    await battleRef(battle.id).update(patch);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write_failed' };
  }
}

/** Start the timed match clock (gift/vote scoring window). Participant-only. */
export async function startMatch(battle, uid) {
  const side = battleSideFor(battle, uid);
  if (!side || !battle?.id) return { ok: false, reason: 'not_participant' };
  if (![BATTLE_STATUS.SCHEDULED, BATTLE_STATUS.LIVE].includes(battle.status)) {
    return { ok: false, reason: 'bad_status' };
  }
  if (battle.liveStartedAt) return { ok: true, already: true };
  try {
    await battleRef(battle.id).update({
      status: BATTLE_STATUS.LIVE,
      liveStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'write_failed' };
  }
}

/**
 * End the battle: declare the scoreboard winner (glory) and settle the coin
 * deposit from attendance. Settlement is server-authoritative — the live-service
 * decides the coin payout from its own recorded attendance, not from the client.
 */
export async function endBattle(battle) {
  if (!battle?.id) return { ok: false, reason: 'missing' };
  const score = battle.score || { creator: 0, opponent: 0 };
  let winnerUid = null;
  if (score.creator > score.opponent) winnerUid = battle.creatorUid;
  else if (score.opponent > score.creator) winnerUid = battle.opponentUid;

  let settlement = null;
  if (isStaked(battle)) {
    try {
      const res = await apiBattleSettle({ battleId: battle.id, idempotencyKey: makeIdempotencyKey('btlsettle') });
      settlement = res?.settlement || { outcome: res?.outcome || 'settled' };
    } catch (e) {
      settlement = { outcome: 'settle_failed', error: String(e?.message || e) };
    }
  }

  try {
    await battleRef(battle.id).update({
      status: BATTLE_STATUS.COMPLETED,
      winnerUid,
      settlement,
      endedAt: Date.now(),
      updatedAt: Date.now(),
    });
  } catch {
    /* ignore */
  }
  return { ok: true, winnerUid, settlement };
}

// ---------------------------------------------------------------------------
// Scoring (votes + gift weight)
// ---------------------------------------------------------------------------

/** A viewer votes for a side. One free vote per viewer, enforced atomically. */
export async function voteBattle(battleId, voterUid, side) {
  if (!firebaseEnabled || !battleId || !voterUid) return { ok: false, reason: 'unavailable' };
  if (side !== 'creator' && side !== 'opponent') return { ok: false, reason: 'bad_side' };
  try {
    await runTransaction(firestore, async (tx) => {
      const voteRef = fsDoc(firestore, `${BATTLES}/${battleId}/votes/${voterUid}`);
      const existing = await tx.get(voteRef);
      if (existing.exists()) throw new Error('already_voted');
      const bRef = fsDoc(firestore, `${BATTLES}/${battleId}`);
      tx.set(voteRef, { side, at: Date.now() });
      tx.update(bRef, { [`score.${side}`]: increment(1), updatedAt: Date.now() });
    });
    return { ok: true };
  } catch (e) {
    if (String(e?.message) === 'already_voted') return { ok: false, reason: 'already_voted' };
    return { ok: false, reason: 'failed' };
  }
}

/** Add gift-weighted score to a side (called after a successful gift in battle). */
export async function addGiftScore(battleId, side, coinValue) {
  if (!firebaseEnabled || !battleId) return;
  if (side !== 'creator' && side !== 'opponent') return;
  const amount = Math.max(1, Math.round(Number(coinValue) || 0));
  try {
    await battleRef(battleId).update({ [`score.${side}`]: increment(amount), updatedAt: Date.now() });
  } catch {
    /* ignore */
  }
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
  if (!firebaseEnabled || !db?.collection || !uid) {
    cb([]);
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
          cb(rows);
        },
        () => cb([])
      );
  } catch {
    cb([]);
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
  endBattle,
  voteBattle,
  addGiftScore,
  setBattleReminder,
  removeBattleReminder,
  getBattle,
  subscribeBattle,
  subscribeUpcomingBattles,
  subscribePendingInvites,
  subscribeMyBattles,
};
