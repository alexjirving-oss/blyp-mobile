// teamsService — TikTok-agency style "Teams".
//
// Data model (Firestore):
//   teams/{teamId}                         team profile + leader
//   teams/{teamId}/members/{uid}           one doc per member (role, stats)
//   teams/{teamId}/joinRequests/{uid}      pending requests to join a team
//   teamApplications/{uid}                 requests to RUN a new team
//   teamBattles/{battleId}                 leader-arranged battles between members
//
// Notifications (join requests accepted/declined, new battles, etc.) are fanned
// out by Cloud Functions that trigger on these collections, so the client only
// has to write the request and the recipient gets a push.

import { firestore as db } from '../config/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { snapExists, snapData } from '../utils/firestoreSnap';
import { resolveTeamIdentity, resolveTeamName } from '../utils/teamIdentity';

export const TEAM_ROLE = { LEADER: 'leader', MEMBER: 'member' };
export const JOIN_STATUS = { PENDING: 'pending', ACCEPTED: 'accepted', REJECTED: 'rejected' };

const normPhoto = (u) =>
  (u && (u.photoURL || u.avatar || u.userPhotoURL || u.photo)) || null;

const PROFILE_CACHE_MS = 5 * 60 * 1000;
const profileCache = new Map();

async function getPublicProfileSources(uid) {
  const id = String(uid || '').trim();
  if (!id) return [];

  const cached = profileCache.get(id);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) return cached.promise;

  const promise = Promise.all([
    getDoc(doc(db, 'users', id)).catch(() => null),
    getDoc(doc(db, 'userProfiles', id)).catch(() => null),
  ]).then((snaps) =>
    snaps
      .filter((snap) => snap && snapExists(snap))
      .map((snap) => snapData(snap) || {})
  );
  profileCache.set(id, { at: Date.now(), promise });
  return promise;
}

async function resolvePublicPerson(record, fallback = 'Member') {
  const row = record && typeof record === 'object' ? record : {};
  const uid = String(row.uid || row.id || '').trim();
  const profileSources = await getPublicProfileSources(uid);
  const identity = resolveTeamIdentity([...profileSources, row], uid, fallback);
  const profilePhoto = profileSources.map(normPhoto).find(Boolean);
  return {
    ...row,
    id: row.id || uid,
    uid,
    displayName: identity.displayName,
    username: identity.username,
    photoURL: row.photoURL || row.photo || profilePhoto || null,
  };
}

async function resolvePublicTeam(record) {
  const row = record && typeof record === 'object' ? record : {};
  const leaderId = String(row.leaderId || '').trim();
  const profileSources = await getPublicProfileSources(leaderId);
  const identity = resolveTeamIdentity(
    [
      ...profileSources,
      {
        displayName: row.leaderDisplayName || row.leaderName,
        username: row.leaderUsername,
      },
    ],
    leaderId,
    'Team owner'
  );
  const profilePhoto = profileSources.map(normPhoto).find(Boolean);
  return {
    ...row,
    name: resolveTeamName(row.name, identity.displayName, leaderId),
    leaderName: identity.displayName,
    leaderDisplayName: identity.displayName,
    leaderUsername: identity.username,
    leaderPhoto: row.leaderPhoto || profilePhoto || null,
  };
}

function asyncSnapshotEmitter(callback, mapper, fallback) {
  let active = true;
  let version = 0;
  return {
    emit(value) {
      const current = ++version;
      Promise.resolve(mapper(value))
        .then((resolved) => {
          if (active && current === version) callback(resolved);
        })
        .catch((err) => {
          console.warn('[teamsService] identity resolution failed', err?.message || err);
          if (active && current === version) callback(fallback);
        });
    },
    stop() {
      active = false;
      version += 1;
    },
  };
}

/** Live list of all teams, ordered by member count then name. */
export function subscribeTeams(callback) {
  const emitter = asyncSnapshotEmitter(
    callback,
    async (docs) => {
      const teams = await Promise.all(
        docs.map((d) => resolvePublicTeam({ id: d.id, ...d.data() }))
      );
      return teams.filter((team) => String(team.status || 'active') !== 'closed');
    },
    []
  );
  let fallbackUnsub = null;
  try {
    const q = query(collection(db, 'teams'), orderBy('memberCount', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => emitter.emit(snap.docs),
      (err) => {
        console.warn('[teamsService] subscribeTeams error', err?.message || err);
        // Fallback without orderBy if the index/field is missing.
        try {
          fallbackUnsub = onSnapshot(collection(db, 'teams'), (snap) => {
            emitter.emit(snap.docs);
          });
        } catch {
          callback([]);
        }
      }
    );
    return () => {
      emitter.stop();
      try { unsub && unsub(); } catch {}
      try { fallbackUnsub && fallbackUnsub(); } catch {}
    };
  } catch (e) {
    console.warn('[teamsService] subscribeTeams setup failed', e?.message || e);
    callback([]);
    return () => {};
  }
}

/** Live single team profile. */
export function subscribeTeam(teamId, callback) {
  if (!teamId) {
    callback(null);
    return () => {};
  }
  const emitter = asyncSnapshotEmitter(
    callback,
    async (snap) => {
      if (!snapExists(snap)) return null;
      const team = await resolvePublicTeam({ id: snap.id, ...snapData(snap) });
      return String(team.status || 'active') === 'closed' ? null : team;
    },
    null
  );
  const unsub = onSnapshot(
    doc(db, 'teams', teamId),
    (snap) => emitter.emit(snap),
    (err) => {
      console.warn('[teamsService] subscribeTeam error', err?.message || err);
      callback(null);
    }
  );
  return () => {
    emitter.stop();
    try { unsub && unsub(); } catch {}
  };
}

/** Live member list for a team. */
export function subscribeTeamMembers(teamId, callback) {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  const emitter = asyncSnapshotEmitter(
    callback,
    (docs) =>
      Promise.all(
        docs.map((d) => resolvePublicPerson({ id: d.id, ...d.data() }, 'Member'))
      ),
    []
  );
  const unsub = onSnapshot(
    collection(db, 'teams', teamId, 'members'),
    (snap) => emitter.emit(snap.docs),
    (err) => {
      console.warn('[teamsService] subscribeTeamMembers error', err?.message || err);
      callback([]);
    }
  );
  return () => {
    emitter.stop();
    try { unsub && unsub(); } catch {}
  };
}

/** Live join requests for a team (leader view). */
export function subscribeJoinRequests(teamId, callback) {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  const emitter = asyncSnapshotEmitter(
    callback,
    async (docs) => {
      const pending = docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((request) => request.status === JOIN_STATUS.PENDING);
      return Promise.all(pending.map((request) => resolvePublicPerson(request, 'Applicant')));
    },
    []
  );
  const unsub = onSnapshot(
    collection(db, 'teams', teamId, 'joinRequests'),
    (snap) => emitter.emit(snap.docs),
    (err) => {
      console.warn('[teamsService] subscribeJoinRequests error', err?.message || err);
      callback([]);
    }
  );
  return () => {
    emitter.stop();
    try { unsub && unsub(); } catch {}
  };
}

/** Get the membership doc for a user across all teams (single-team assumption). */
export async function getMyMembership(uid) {
  if (!uid) return null;
  try {
    const snap = await getDocs(
      query(collection(db, 'teams'), where('memberIds', 'array-contains', uid))
    );
    if (snap.empty) return null;
    const teamDoc =
      snap.docs.find((candidate) => String(candidate.data()?.status || 'active') !== 'closed') ||
      null;
    if (!teamDoc) return null;
    const memberSnap = await getDoc(doc(db, 'teams', teamDoc.id, 'members', uid));
    const [team, member] = await Promise.all([
      resolvePublicTeam({ id: teamDoc.id, ...teamDoc.data() }),
      snapExists(memberSnap)
        ? resolvePublicPerson({ id: memberSnap.id, ...snapData(memberSnap) }, 'Member')
        : null,
    ]);
    return {
      teamId: teamDoc.id,
      team,
      member,
    };
  } catch (e) {
    console.warn('[teamsService] getMyMembership failed', e?.message || e);
    return null;
  }
}

/** Has the user already requested to join this team? */
export async function getMyJoinRequest(teamId, uid) {
  if (!teamId || !uid) return null;
  try {
    const snap = await getDoc(doc(db, 'teams', teamId, 'joinRequests', uid));
    return snapExists(snap)
      ? resolvePublicPerson({ id: snap.id, ...snapData(snap) }, 'Applicant')
      : null;
  } catch {
    return null;
  }
}

/** User requests to join a team. Idempotent on (teamId, uid). */
export async function requestToJoinTeam(teamId, user, message = '') {
  if (!teamId) throw new Error('Missing team');
  const uid =
    (typeof user === 'string' && user) ||
    user?.uid ||
    user?.attributes?.sub ||
    user?.sub ||
    null;
  if (!uid) throw new Error('Please sign in to join a team.');
  const person = await resolvePublicPerson(
    {
      uid,
      displayName:
        user?.displayName ||
        user?.attributes?.name ||
        user?.attributes?.preferred_username,
      username:
        user?.username ||
        user?.attributes?.preferred_username ||
        (typeof user?.getUsername === 'function' ? user.getUsername() : null),
      photoURL: normPhoto(user) || user?.attributes?.picture || user?.photoURL || null,
    },
    'Member'
  );
  const ref = doc(db, 'teams', teamId, 'joinRequests', uid);
  await setDoc(
    ref,
    {
      uid,
      displayName: person.displayName,
      username: person.username,
      photoURL: person.photoURL,
      message: String(message || '').slice(0, 280),
      status: JOIN_STATUS.PENDING,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}

/** Leader accepts a join request → adds the member and marks the request accepted. */
export async function acceptJoinRequest(teamId, request) {
  if (!teamId || !request?.uid) throw new Error('Missing team or request');
  const person = await resolvePublicPerson(request, 'Member');
  const teamRef = doc(db, 'teams', teamId);
  const memberRef = doc(db, 'teams', teamId, 'members', request.uid);
  const requestRef = doc(db, 'teams', teamId, 'joinRequests', request.uid);
  await runTransaction(db, async (tx) => {
    const [teamSnap, memberSnap, requestSnap] = await Promise.all([
      tx.get(teamRef),
      tx.get(memberRef),
      tx.get(requestRef),
    ]);
    if (!teamSnap.exists()) throw new Error('Team not found');
    if (String(teamSnap.data()?.status || 'active') === 'closed') {
      throw new Error('This team is closed.');
    }
    if (!requestSnap.exists() || requestSnap.data()?.status !== JOIN_STATUS.PENDING) {
      throw new Error('This join request is no longer pending.');
    }

    tx.set(memberRef, {
      uid: request.uid,
      displayName: person.displayName,
      username: person.username,
      photoURL: person.photoURL,
      role: TEAM_ROLE.MEMBER,
      hoursLive: 0,
      joinedAt: memberSnap.exists() ? memberSnap.data()?.joinedAt || serverTimestamp() : serverTimestamp(),
    }, { merge: true });

    if (!memberSnap.exists()) {
      const currentIds = Array.isArray(teamSnap.data()?.memberIds)
        ? teamSnap.data().memberIds.map(String)
        : [];
      const memberIds = [...new Set([...currentIds, String(request.uid)])];
      tx.update(teamRef, {
        memberCount: memberIds.length,
        memberIds,
        updatedAt: serverTimestamp(),
      });
    }

    tx.update(requestRef, {
      status: JOIN_STATUS.ACCEPTED,
      decidedAt: serverTimestamp(),
    });
  });
  return true;
}

/** Leader declines a join request. */
export async function declineJoinRequest(teamId, request) {
  if (!teamId || !request?.uid) throw new Error('Missing team or request');
  await updateDoc(doc(db, 'teams', teamId, 'joinRequests', request.uid), {
    status: JOIN_STATUS.REJECTED,
    decidedAt: serverTimestamp(),
  });
  return true;
}

function nextMemberIds(team, uid) {
  const current = Array.isArray(team?.memberIds) ? team.memberIds.map(String) : [];
  return current.filter((memberId) => memberId !== String(uid));
}

/** Member leaves a team atomically (leaders close the team instead). */
export async function leaveTeam(teamId, uid) {
  if (!teamId || !uid) throw new Error('Missing team or user');
  const teamRef = doc(db, 'teams', teamId);
  const memberRef = doc(db, 'teams', teamId, 'members', uid);
  await runTransaction(db, async (tx) => {
    const [teamSnap, memberSnap] = await Promise.all([
      tx.get(teamRef),
      tx.get(memberRef),
    ]);
    if (!teamSnap.exists()) throw new Error('Team not found');
    const team = teamSnap.data() || {};
    if (team.leaderId === uid) {
      throw new Error('Team owners close the team instead of leaving it.');
    }
    if (!memberSnap.exists()) return;

    const memberIds = nextMemberIds(team, uid);
    tx.delete(memberRef);
    tx.update(teamRef, {
      memberCount: memberIds.length,
      memberIds,
      updatedAt: serverTimestamp(),
    });
  });
  return true;
}

/** Owner removes a non-owner member and repairs the denormalized roster atomically. */
export async function removeTeamMember(teamId, memberUid) {
  if (!teamId || !memberUid) throw new Error('Missing team or member');
  const teamRef = doc(db, 'teams', teamId);
  const memberRef = doc(db, 'teams', teamId, 'members', memberUid);
  await runTransaction(db, async (tx) => {
    const [teamSnap, memberSnap] = await Promise.all([
      tx.get(teamRef),
      tx.get(memberRef),
    ]);
    if (!teamSnap.exists()) throw new Error('Team not found');
    const team = teamSnap.data() || {};
    if (String(team.leaderId) === String(memberUid)) {
      throw new Error('The team owner cannot be removed.');
    }
    if (!memberSnap.exists()) return;

    const memberIds = nextMemberIds(team, memberUid);
    tx.delete(memberRef);
    tx.update(teamRef, {
      memberCount: memberIds.length,
      memberIds,
      updatedAt: serverTimestamp(),
    });
  });
  return true;
}

/** Owner closes a team without destroying its audit history. */
export async function closeTeam(teamId, ownerUid) {
  if (!teamId || !ownerUid) throw new Error('Missing team or owner');
  const teamRef = doc(db, 'teams', teamId);
  await runTransaction(db, async (tx) => {
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) throw new Error('Team not found');
    const team = teamSnap.data() || {};
    if (String(team.leaderId) !== String(ownerUid)) {
      throw new Error('Only the team owner can close this team.');
    }
    tx.update(teamRef, {
      status: 'closed',
      closedAt: serverTimestamp(),
      closedBy: ownerUid,
      memberCount: 0,
      memberIds: [],
      updatedAt: serverTimestamp(),
    });
  });
  return true;
}

/** Owner toggles whether a member may post in team chat. */
export async function setTeamMemberRestricted(teamId, ownerUid, memberUid, restricted) {
  if (!teamId || !ownerUid || !memberUid) throw new Error('Missing team or member');
  if (String(ownerUid) === String(memberUid)) {
    throw new Error('The team owner cannot be restricted.');
  }
  await updateDoc(doc(db, 'teams', teamId, 'members', memberUid), {
    restricted: !!restricted,
    restrictedAt: restricted ? serverTimestamp() : null,
    restrictedBy: restricted ? ownerUid : null,
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Owner records a warning and posts it into the team channel. */
export async function warnTeamMember(teamId, owner, member, text) {
  const ownerUid = owner?.uid || owner?.attributes?.sub || owner?.sub || null;
  const memberUid = member?.uid || member?.id || null;
  const body = String(text || '').trim().slice(0, 280);
  if (!teamId || !ownerUid || !memberUid) throw new Error('Missing team or member');
  if (!body) throw new Error('Write a warning first.');

  const [sender, target] = await Promise.all([
    resolvePublicPerson({ ...owner, uid: ownerUid }, 'Team owner'),
    resolvePublicPerson({ ...member, uid: memberUid }, 'Member'),
  ]);
  const batch = writeBatch(db);
  batch.update(doc(db, 'teams', teamId, 'members', memberUid), {
    warningCount: increment(1),
    lastWarning: body,
    lastWarnedAt: serverTimestamp(),
    lastWarnedBy: ownerUid,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, 'teams', teamId, 'messages')), {
    uid: ownerUid,
    senderId: ownerUid,
    senderName: sender.displayName,
    senderUsername: sender.username,
    targetUid: memberUid,
    targetName: target.displayName,
    kind: 'warning',
    text: body,
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return true;
}

// ---------------------------------------------------------------------------
// Auditions — "audition for the agency": applicants battle to earn a spot.
// ---------------------------------------------------------------------------

export const AUDITION_STATUS = {
  AWAITING: 'awaiting_opponent',
  MATCHED: 'matched',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
};

// Auditions run at a fixed nightly slot: 10pm UK time. Applicants lock into the
// next slot and can check in from 30 minutes before. If no human opponent has
// joined by check-in time, the server fills the slot (leader, then Alex).
const AUDITION_HOUR_UK = 22; // 10pm UK
export const AUDITION_CHECKIN_LEAD_MS = 30 * 60 * 1000;

// UK time = UTC in winter (GMT), UTC+1 in summer (BST). BST runs from 01:00 UTC
// on the last Sunday of March to 01:00 UTC on the last Sunday of October.
//
// This is computed deterministically from the calendar — NOT via
// Date.toLocaleString({ timeZone }) — because Hermes (React Native's engine)
// has historically ignored the timeZone option, which silently shifted the
// 10pm slot by hours (e.g. it showing as "1:00 am"). Pure arithmetic is correct
// and identical on every engine.
function lastSundayUtcDate(year, monthIndex) {
  // Last day of the month at 01:00 UTC, then walk back to Sunday.
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0, 1, 0, 0, 0));
  lastDay.setUTCDate(lastDay.getUTCDate() - lastDay.getUTCDay());
  return lastDay.getTime();
}

function isUkSummer(atMs) {
  const year = new Date(atMs).getUTCFullYear();
  const bstStart = lastSundayUtcDate(year, 2); // last Sun March, 01:00 UTC
  const bstEnd = lastSundayUtcDate(year, 9); // last Sun October, 01:00 UTC
  return atMs >= bstStart && atMs < bstEnd;
}

// Offset (ms) of Europe/London vs UTC at a given instant (DST-aware).
function ukOffsetMs(atMs) {
  return isUkSummer(atMs) ? 60 * 60 * 1000 : 0;
}

// Real epoch ms for `hour:00` UK wall-clock on a given UK calendar date.
function ukWallToUtc(year, monthIndex, day, hour) {
  // Treat the wall time as if it were UTC, then subtract the offset that applies
  // at that instant to land on the true UTC moment.
  const asIfUtc = Date.UTC(year, monthIndex, day, hour, 0, 0, 0);
  return asIfUtc - ukOffsetMs(asIfUtc);
}

/** Epoch ms of the next moment it is 10pm in the UK (today, else tomorrow). */
export function nextUkTenPm(fromMs = Date.now()) {
  // UK wall-clock "now": shift the instant by the UK offset so getUTC* reads UK time.
  const ukNow = new Date(fromMs + ukOffsetMs(fromMs));
  let target = ukWallToUtc(
    ukNow.getUTCFullYear(),
    ukNow.getUTCMonth(),
    ukNow.getUTCDate(),
    AUDITION_HOUR_UK
  );
  if (target <= fromMs) {
    // Past 10pm UK already → schedule tomorrow's UK date.
    const tomorrow = new Date(ukNow.getTime() + 24 * 60 * 60 * 1000);
    target = ukWallToUtc(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth(),
      tomorrow.getUTCDate(),
      AUDITION_HOUR_UK
    );
  }
  return target;
}

/**
 * Audition to join a team. If another applicant is already waiting for this team,
 * the two are matched (a Cloud Function then builds the live battle). Otherwise an
 * open audition is created with a 24h window — if no one else applies, the leader
 * (or fallback account) is auto-assigned as the opponent server-side.
 *
 * Returns { ok, status: 'matched'|'awaiting'|'existing', auditionId }.
 */
export async function requestAudition(teamId, user) {
  if (!teamId || !user?.uid) throw new Error('Missing team or user');
  const uid = user.uid;
  const displayName = user.displayName || user.username || 'Applicant';
  const photoURL = normPhoto(user);
  const now = Date.now();

  // Already have an active audition for this team? Return it instead of duplicating.
  try {
    const mineSnap = await getDocs(
      query(
        collection(db, 'auditions'),
        where('teamId', '==', teamId),
        where('aUid', '==', uid),
        where('status', 'in', [AUDITION_STATUS.AWAITING, AUDITION_STATUS.MATCHED, AUDITION_STATUS.COMPLETED])
      )
    );
    if (!mineSnap.empty) {
      return { ok: true, status: 'existing', auditionId: mineSnap.docs[0].id };
    }
  } catch (e) {
    // 'in' query needs a composite index in some projects; fall through to creating.
    console.warn('[teamsService] requestAudition existing-check failed', e?.message || e);
  }

  // Look for an open audition from someone else to match against.
  let openId = null;
  try {
    const openSnap = await getDocs(
      query(
        collection(db, 'auditions'),
        where('teamId', '==', teamId),
        where('status', '==', AUDITION_STATUS.AWAITING),
        limit(5)
      )
    );
    const candidate = openSnap.docs.find((d) => (d.data() || {}).aUid && d.data().aUid !== uid);
    if (candidate) openId = candidate.id;
  } catch (e) {
    console.warn('[teamsService] requestAudition open-search failed', e?.message || e);
  }

  if (openId) {
    // Atomically claim the open audition as the opponent. If someone else grabbed
    // it first, the transaction sees a non-awaiting status and we create our own.
    try {
      const claimed = await runTransaction(db, async (tx) => {
        const ref = doc(db, 'auditions', openId);
        const snap = await tx.get(ref);
        if (!snap.exists()) return false;
        const data = snap.data() || {};
        if (data.status !== AUDITION_STATUS.AWAITING || data.aUid === uid) return false;
        tx.update(ref, {
          bUid: uid,
          bName: displayName,
          bPhoto: photoURL,
          bIsFallback: false,
          status: AUDITION_STATUS.MATCHED,
          updatedAt: now,
        });
        return true;
      });
      if (claimed) return { ok: true, status: 'matched', auditionId: openId };
    } catch (e) {
      console.warn('[teamsService] requestAudition claim failed', e?.message || e);
    }
  }

  // No opponent yet — lock into the next 10pm UK slot. The opponent slot is held
  // open until 30 minutes before, when (if still empty) the server fills it.
  const scheduledAt = nextUkTenPm(now);
  const ref = await addDoc(collection(db, 'auditions'), {
    teamId,
    aUid: uid,
    aName: displayName,
    aPhoto: photoURL,
    bUid: null,
    bName: null,
    bPhoto: null,
    bIsFallback: false,
    fallbackRole: null,
    battleId: null,
    status: AUDITION_STATUS.AWAITING,
    scheduledAt,
    checkInOpensAt: scheduledAt - AUDITION_CHECKIN_LEAD_MS,
    // Fallback opponent is assigned at the check-in deadline if no one joined.
    windowExpiresAt: scheduledAt - AUDITION_CHECKIN_LEAD_MS,
    checkIns: {},
    results: null,
    decisions: {},
    createdAt: serverTimestamp(),
    updatedAt: now,
  });
  return { ok: true, status: 'awaiting', auditionId: ref.id, scheduledAt };
}

/**
 * Mark that a participant has shown up for their audition slot. Allowed from the
 * check-in window (30 min before) onward. Stores a timestamp under checkIns.{uid}.
 */
export async function checkInAudition(auditionId, uid) {
  if (!auditionId || !uid) throw new Error('Missing audition or user');
  await setDoc(
    doc(db, 'auditions', auditionId),
    { checkIns: { [uid]: Date.now() }, updatedAt: Date.now() },
    { merge: true }
  );
  return true;
}

/** The current user's most recent audition for a team (applicant view). */
export async function getMyAudition(teamId, uid) {
  if (!teamId || !uid) return null;
  try {
    const snap = await getDocs(
      query(collection(db, 'auditions'), where('teamId', '==', teamId), where('aUid', '==', uid))
    );
    if (snap.empty) return null;
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => (toMs(b.updatedAt) || b.updatedAt || 0) - (toMs(a.updatedAt) || a.updatedAt || 0));
    return list[0];
  } catch (e) {
    console.warn('[teamsService] getMyAudition failed', e?.message || e);
    return null;
  }
}

/** Live auditions for a team (leader dashboard). */
export function subscribeAuditions(teamId, callback) {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  try {
    const q = query(collection(db, 'auditions'), where('teamId', '==', teamId));
    return onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => (toMs(b.updatedAt) || b.updatedAt || 0) - (toMs(a.updatedAt) || a.updatedAt || 0));
        callback(items);
      },
      (err) => {
        console.warn('[teamsService] subscribeAuditions error', err?.message || err);
        callback([]);
      }
    );
  } catch {
    callback([]);
    return () => {};
  }
}

/**
 * Leader accepts or declines a candidate from an audition. Writes the per-candidate
 * decision; a Cloud Function adds an accepted candidate to the roster and notifies
 * them. `decision` is 'accepted' | 'declined'.
 */
export async function decideAudition(auditionId, candidateUid, decision) {
  if (!auditionId || !candidateUid) throw new Error('Missing audition or candidate');
  if (decision !== 'accepted' && decision !== 'declined') throw new Error('Bad decision');
  await setDoc(
    doc(db, 'auditions', auditionId),
    { decisions: { [candidateUid]: decision }, updatedAt: Date.now() },
    { merge: true }
  );
  return true;
}

/** User applies to run their own team. */
export async function applyToRunTeam(user, pitch) {
  // Cognito users often have `sub` / attributes.sub, not Firebase-style `.uid`.
  const uid =
    (typeof user === 'string' && user) ||
    user?.uid ||
    user?.attributes?.sub ||
    user?.sub ||
    null;
  if (!uid) throw new Error('Please sign in to apply to run a team.');
  try {
    const { ensureFirebaseAuthReady } = await import('../utils/firebaseAuthHelper');
    await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
  } catch (e) {
    // Still attempt the write — bridge may already be ready.
    console.warn('[teams] ensureFirebaseAuthReady:', e?.message || e);
  }
  const person = await resolvePublicPerson(
    {
      uid,
      displayName: user?.displayName || user?.attributes?.name,
      username:
        user?.username ||
        user?.attributes?.preferred_username ||
        (typeof user?.getUsername === 'function' ? user.getUsername() : null),
      photoURL: normPhoto(user) || user?.attributes?.picture || user?.photoURL || null,
    },
    'Creator'
  );
  await setDoc(
    doc(db, 'teamApplications', uid),
    {
      uid,
      displayName: person.displayName,
      username: person.username,
      photoURL: person.photoURL,
      pitch: String(pitch || '').slice(0, 1000),
      status: JOIN_STATUS.PENDING,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return true;
}

/**
 * Leader arranges a battle between two team members. Writes a teamBattles doc;
 * a Cloud Function notifies both members.
 */
export async function createTeamBattle(teamId, creator, memberA, memberB, opts = {}) {
  if (!teamId || !memberA?.uid || !memberB?.uid) throw new Error('Pick two members');
  if (memberA.uid === memberB.uid) throw new Error('Pick two different members');
  const payload = {
    teamId,
    creatorId: creator?.uid || null,
    aUid: memberA.uid,
    aName: memberA.displayName || 'Member A',
    bUid: memberB.uid,
    bName: memberB.displayName || 'Member B',
    scheduledAt: opts.scheduledAt || null,
    note: String(opts.note || '').slice(0, 280),
    status: 'scheduled',
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'teamBattles'), payload);
  return ref.id;
}

/** Live list of battles for a team. */
export function subscribeTeamBattles(teamId, callback) {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  try {
    const q = query(collection(db, 'teamBattles'), where('teamId', '==', teamId));
    return onSnapshot(
      q,
      (snap) => {
        const battles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        battles.sort((x, y) => (toMs(y.createdAt) - toMs(x.createdAt)));
        callback(battles);
      },
      (err) => {
        console.warn('[teamsService] subscribeTeamBattles error', err?.message || err);
        callback([]);
      }
    );
  } catch {
    callback([]);
    return () => {};
  }
}

/** Live team channel, oldest message first. */
export function subscribeTeamMessages(teamId, callback) {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  const emitter = asyncSnapshotEmitter(
    callback,
    async (docs) => {
      const rows = await Promise.all(
        docs.map(async (d) => {
          const message = { id: d.id, ...d.data() };
          const sender = await resolvePublicPerson(
            {
              uid: message.senderId || message.uid,
              displayName: message.senderName,
              username: message.senderUsername,
            },
            'Team member'
          );
          let targetName = message.targetName || '';
          if (message.targetUid) {
            const target = await resolvePublicPerson(
              { uid: message.targetUid, displayName: message.targetName },
              'Member'
            );
            targetName = target.displayName;
          }
          return {
            ...message,
            senderName: sender.displayName,
            senderUsername: sender.username,
            targetName,
          };
        })
      );
      return rows.reverse();
    },
    []
  );
  const messagesQuery = query(
    collection(db, 'teams', teamId, 'messages'),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  const unsub = onSnapshot(
    messagesQuery,
    (snap) => emitter.emit(snap.docs),
    (err) => {
      console.warn('[teamsService] subscribeTeamMessages error', err?.message || err);
      callback([]);
    }
  );
  return () => {
    emitter.stop();
    try { unsub && unsub(); } catch {}
  };
}

/**
 * Posts in the member channel. The owner may restrict a member from posting;
 * the Firestore rule remains authoritative and all members may still read.
 */
export async function sendTeamGroupMessage(teamId, sender, text) {
  const senderId = sender?.uid || sender?.attributes?.sub || sender?.sub || null;
  const body = String(text || '').trim().slice(0, 1000);
  if (!teamId || !senderId || !body) throw new Error('Message required');
  const person = await resolvePublicPerson({ ...sender, uid: senderId }, 'Team member');
  await addDoc(collection(db, 'teams', teamId, 'messages'), {
    uid: senderId,
    senderId,
    senderName: person.displayName,
    senderUsername: person.username,
    kind: 'message',
    text: body,
    createdAt: serverTimestamp(),
  });
  return true;
}

function toMs(ts) {
  try {
    if (!ts) return 0;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    return new Date(ts).getTime() || 0;
  } catch {
    return 0;
  }
}

const dash = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (v <= 0) return '—';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
};

/**
 * Honest team dashboard aggregates from real team/member/battle fields.
 * Missing data surfaces as "—" — never invented production metrics.
 */
export function computeTeamDashboardStats({ team, members, battles } = {}) {
  const memberList = Array.isArray(members) ? members : [];
  const battleList = Array.isArray(battles) ? battles : [];
  const memberCount = memberList.length || Number(team?.memberCount) || 0;

  const gemsFromTeam = Number(team?.teamTotalGems);
  const gemsFromMembers = memberList.reduce(
    (sum, m) => sum + Number(m?.gemsEarned || 0) + Number(m?.teamBonusGems || 0),
    0
  );
  const giftsTotal =
    Number.isFinite(gemsFromTeam) && gemsFromTeam > 0
      ? gemsFromTeam
      : gemsFromMembers > 0
        ? gemsFromMembers
        : null;

  const completed = battleList.filter((b) => {
    const st = String(b?.status || '').toLowerCase();
    return st === 'completed' || st === 'done' || st === 'finished';
  });
  let wins = 0;
  let winsTracked = false;
  completed.forEach((b) => {
    if (b?.winnerUid || b?.winnerSide || b?.winnerId) {
      winsTracked = true;
      wins += 1;
    }
  });

  const activeMembers = memberList.filter((m) => Number(m?.hoursLive || 0) > 0).length;
  const weeklyRaw = team?.weeklyActivity ?? team?.weekLiveHours ?? team?.weeklyHours;
  const weeklyNum = weeklyRaw == null ? null : Number(weeklyRaw);
  const tier = team?.tier || team?.rank || team?.rankLabel || null;

  return {
    memberCount,
    battlesCount: battleList.length,
    battlesLabel: battleList.length > 0 ? String(battleList.length) : '—',
    winsLabel: winsTracked ? String(wins) : '—',
    giftsLabel: giftsTotal != null ? dash(giftsTotal) : '—',
    giftsTotal: giftsTotal != null ? giftsTotal : 0,
    activeMembers,
    activeLabel: memberCount > 0 ? String(activeMembers) : '—',
    weeklyLabel:
      weeklyNum != null && Number.isFinite(weeklyNum) && weeklyNum > 0 ? dash(weeklyNum) : '—',
    tier: tier ? String(tier) : null,
  };
}

/**
 * Best-effort online map for team members via users/{uid}.presence.state.
 * Teams are small — one listener per member is fine.
 */
export function subscribeMembersPresence(uids, callback) {
  const ids = [...new Set((Array.isArray(uids) ? uids : []).filter(Boolean).map(String))];
  if (!ids.length) {
    callback({});
    return () => {};
  }
  const map = {};
  const unsubs = ids.map((uid) =>
    onSnapshot(
      doc(db, 'users', uid),
      (snap) => {
        const data = snapExists(snap) ? snapData(snap) : null;
        map[uid] = String(data?.presence?.state || '').toLowerCase() === 'online';
        callback({ ...map });
      },
      () => {
        map[uid] = false;
        callback({ ...map });
      }
    )
  );
  return () => {
    unsubs.forEach((u) => {
      try {
        u && u();
      } catch {
        /* ignore */
      }
    });
  };
}
