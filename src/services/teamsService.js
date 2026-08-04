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
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  increment,
  arrayRemove,
} from 'firebase/firestore';
import { snapExists, snapData } from '../utils/firestoreSnap';

export const TEAM_ROLE = { LEADER: 'leader', MEMBER: 'member' };
export const JOIN_STATUS = { PENDING: 'pending', ACCEPTED: 'accepted', REJECTED: 'rejected' };

const normPhoto = (u) =>
  (u && (u.photoURL || u.avatar || u.userPhotoURL || u.photo)) || null;

/** Live list of all teams, ordered by member count then name. */
export function subscribeTeams(callback) {
  try {
    const q = query(collection(db, 'teams'), orderBy('memberCount', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        const teams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        callback(teams);
      },
      (err) => {
        console.warn('[teamsService] subscribeTeams error', err?.message || err);
        // Fallback without orderBy if the index/field is missing.
        try {
          return onSnapshot(collection(db, 'teams'), (snap) => {
            callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
          });
        } catch {
          callback([]);
        }
      }
    );
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
  return onSnapshot(
    doc(db, 'teams', teamId),
    (snap) => callback(snapExists(snap) ? { id: snap.id, ...snapData(snap) } : null),
    (err) => {
      console.warn('[teamsService] subscribeTeam error', err?.message || err);
      callback(null);
    }
  );
}

/** Live member list for a team. */
export function subscribeTeamMembers(teamId, callback) {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, 'teams', teamId, 'members'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn('[teamsService] subscribeTeamMembers error', err?.message || err);
      callback([]);
    }
  );
}

/** Live join requests for a team (leader view). */
export function subscribeJoinRequests(teamId, callback) {
  if (!teamId) {
    callback([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, 'teams', teamId, 'joinRequests'),
    (snap) => {
      const reqs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.status === JOIN_STATUS.PENDING);
      callback(reqs);
    },
    (err) => {
      console.warn('[teamsService] subscribeJoinRequests error', err?.message || err);
      callback([]);
    }
  );
}

/** Get the membership doc for a user across all teams (single-team assumption). */
export async function getMyMembership(uid) {
  if (!uid) return null;
  try {
    const snap = await getDocs(
      query(collection(db, 'teams'), where('memberIds', 'array-contains', uid))
    );
    if (snap.empty) return null;
    const teamDoc = snap.docs[0];
    const memberSnap = await getDoc(doc(db, 'teams', teamDoc.id, 'members', uid));
    return {
      teamId: teamDoc.id,
      team: { id: teamDoc.id, ...teamDoc.data() },
      member: snapExists(memberSnap) ? { id: memberSnap.id, ...snapData(memberSnap) } : null,
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
    return snapExists(snap) ? { id: snap.id, ...snapData(snap) } : null;
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
  const ref = doc(db, 'teams', teamId, 'joinRequests', uid);
  await setDoc(
    ref,
    {
      uid,
      displayName:
        user?.displayName ||
        user?.attributes?.name ||
        user?.attributes?.preferred_username ||
        user?.username ||
        'Member',
      photoURL: normPhoto(user) || user?.attributes?.picture || user?.photoURL || null,
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
  const memberRef = doc(db, 'teams', teamId, 'members', request.uid);
  await setDoc(
    memberRef,
    {
      uid: request.uid,
      displayName: request.displayName || 'Member',
      photoURL: request.photoURL || null,
      role: TEAM_ROLE.MEMBER,
      hoursLive: 0,
      joinedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await updateDoc(doc(db, 'teams', teamId), {
    memberCount: increment(1),
    memberIds: arrayUnionSafe(request.uid),
    updatedAt: serverTimestamp(),
  }).catch(async () => {
    // memberIds may not exist yet; set it explicitly.
    await updateDoc(doc(db, 'teams', teamId), {
      memberCount: increment(1),
      updatedAt: serverTimestamp(),
    });
  });
  await updateDoc(doc(db, 'teams', teamId, 'joinRequests', request.uid), {
    status: JOIN_STATUS.ACCEPTED,
    decidedAt: serverTimestamp(),
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

/** Member leaves a team (leaders must transfer leadership via admin first). */
export async function leaveTeam(teamId, uid) {
  if (!teamId || !uid) throw new Error('Missing team or user');
  const teamRef = doc(db, 'teams', teamId);
  const teamSnap = await getDoc(teamRef);
  if (!snapExists(teamSnap)) throw new Error('Team not found');
  const team = snapData(teamSnap);
  if (team?.leaderId === uid) {
    throw new Error('Team leaders cannot leave. Contact support to transfer leadership.');
  }
  await deleteDoc(doc(db, 'teams', teamId, 'members', uid));
  await updateDoc(teamRef, {
    memberCount: increment(-1),
    memberIds: arrayRemove(uid),
    updatedAt: serverTimestamp(),
  });
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
  const displayName =
    user?.displayName ||
    user?.attributes?.name ||
    user?.attributes?.preferred_username ||
    user?.username ||
    (typeof user?.getUsername === 'function' ? user.getUsername() : null) ||
    'Creator';
  await setDoc(
    doc(db, 'teamApplications', uid),
    {
      uid,
      displayName: String(displayName),
      photoURL: normPhoto(user) || user?.attributes?.picture || user?.photoURL || null,
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

/**
 * Leader sends a group message to all members. Writes one teamMessage doc; a
 * Cloud Function fans it out as notifications to every member.
 */
export async function sendTeamGroupMessage(teamId, sender, text) {
  if (!teamId || !String(text || '').trim()) throw new Error('Message required');
  await addDoc(collection(db, 'teams', teamId, 'messages'), {
    senderId: sender?.uid || null,
    senderName: sender?.displayName || 'Team leader',
    text: String(text).slice(0, 1000),
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

// arrayUnion without importing it at top-level repeatedly (kept local + lazy so
// a missing export can't break module load).
function arrayUnionSafe(value) {
  // eslint-disable-next-line global-require
  const { arrayUnion } = require('firebase/firestore');
  return arrayUnion(value);
}
