// clubDiscoveryService.js
//
// Phase 2 club discovery — practical MVP membership index.
// Primary index: users.profileClubs (Firestore array-contains).
// Optional denorm: clubMemberships/{clubId}/members/{uid} for counts / future pages.
// Does not touch avatarFrame or entitlement caps.

import { db, firebaseEnabled } from '../config/firebase';
import {
  CLUB_CATALOG,
  getClubById,
  normalizeProfileClubs,
} from './profileIdentityCatalog';
import { filterBlocked, loadBlockedUsers } from './BlockService';

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

async function visibleUsers(users) {
  await loadBlockedUsers().catch(() => {});
  return filterBlocked(users || [], (u) => u?.id || u?.uid || u?.userId);
}

function mapUserDoc(d) {
  return { id: d.id, ...d.data() };
}

function hasDisplayIdentity(u) {
  return !!(u?.username || u?.displayName || u?.name || u?.handle);
}

export function searchClubs(query, limit = 8) {
  const q = String(query || '').trim().toLowerCase().replace(/^@/, '');
  if (!q || q.length < 1) return [];
  const scored = [];
  for (const club of CLUB_CATALOG) {
    const label = String(club.label || '').toLowerCase();
    const short = String(club.shortLabel || '').toLowerCase();
    const id = String(club.id || '').toLowerCase();
    let score = 0;
    if (label === q || short === q || id === q) score = 100;
    else if (label.startsWith(q) || short.startsWith(q)) score = 80;
    else if (label.includes(q) || short.includes(q) || id.includes(q)) score = 50;
    if (score > 0) scored.push({ score, club });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.club);
}

export function resolveClubIdFromQuery(query) {
  const hits = searchClubs(query, 1);
  return hits[0]?.id || null;
}

export async function getMembersByClubId(clubId, opts = {}) {
  const { limit = 24, excludeUid = null } = opts;
  if (!firebaseEnabled || !db?.collection) return [];
  const id = String(clubId || '').trim();
  if (!id || !getClubById(id)) return [];
  try {
    const snap = await db
      .collection('users')
      .where('profileClubs', 'array-contains', id)
      .limit(Math.min(80, Math.max(limit * 2, limit)))
      .get();
    const all = (snap?.docs || [])
      .map(mapUserDoc)
      .filter((u) => (excludeUid ? u.id !== excludeUid : true))
      .filter(hasDisplayIdentity)
      .filter((u) => {
        const tier = String(u.feedPriorityAccount || u.creatorFeedWeight || 'standard').toLowerCase();
        return tier !== 'suppress';
      })
      .sort((a, b) => num(b.followersCount) + num(b.followers) - (num(a.followersCount) + num(a.followers)));
    return (await visibleUsers(all)).slice(0, limit);
  } catch (e) {
    console.warn('[CLUB_DISCOVERY] members by club failed', e?.message || String(e));
    return [];
  }
}

export async function getPeopleInSharedClubs(myClubIds, opts = {}) {
  const { limit = 12, excludeUid = null } = opts;
  const clubs = normalizeProfileClubs(myClubIds);
  if (!clubs.length) return [];

  try {
    const batches = await Promise.all(
      clubs.slice(0, 8).map((clubId) => getMembersByClubId(clubId, { limit: 16, excludeUid }))
    );
    const byId = new Map();
    for (let i = 0; i < clubs.length; i++) {
      const clubId = clubs[i];
      for (const u of batches[i] || []) {
        const prev = byId.get(u.id);
        const shared = prev?.sharedClubIds || [];
        if (!shared.includes(clubId)) shared.push(clubId);
        byId.set(u.id, {
          ...u,
          sharedClubIds: shared,
          sharedClubCount: shared.length,
        });
      }
    }
    const ranked = Array.from(byId.values()).sort(
      (a, b) =>
        (b.sharedClubCount || 0) - (a.sharedClubCount || 0) ||
        num(b.followersCount) + num(b.followers) - (num(a.followersCount) + num(a.followers))
    );
    return ranked.slice(0, limit);
  } catch (e) {
    console.warn('[CLUB_DISCOVERY] people in shared clubs failed', e?.message || String(e));
    return [];
  }
}

export async function getMyProfileClubs(uid) {
  if (!firebaseEnabled || !db?.collection || !uid) return [];
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap?.exists) return [];
    return normalizeProfileClubs(snap.data()?.profileClubs);
  } catch (e) {
    console.warn('[CLUB_DISCOVERY] load my clubs failed', e?.message || String(e));
    return [];
  }
}

export async function syncClubMembershipIndex(uid, nextClubs, prevClubs = []) {
  if (!firebaseEnabled || !db?.collection || !uid) return { ok: false, skipped: true };
  const next = new Set(normalizeProfileClubs(nextClubs));
  const prev = new Set(normalizeProfileClubs(prevClubs));
  const toAdd = [...next].filter((id) => !prev.has(id));
  const toRemove = [...prev].filter((id) => !next.has(id));
  if (!toAdd.length && !toRemove.length) return { ok: true, added: 0, removed: 0 };

  const results = { ok: true, added: 0, removed: 0, errors: [] };
  await Promise.all([
    ...toAdd.map(async (clubId) => {
      try {
        await db
          .collection('clubMemberships')
          .doc(clubId)
          .collection('members')
          .doc(uid)
          .set({ uid, clubId, joinedAt: new Date() }, { merge: true });
        results.added += 1;
      } catch (e) {
        results.errors.push(e?.message || String(e));
      }
    }),
    ...toRemove.map(async (clubId) => {
      try {
        await db.collection('clubMemberships').doc(clubId).collection('members').doc(uid).delete();
        results.removed += 1;
      } catch (e) {
        results.errors.push(e?.message || String(e));
      }
    }),
  ]);
  if (results.errors.length) {
    console.warn('[CLUB_DISCOVERY] membership sync partial', results.errors.slice(0, 3));
  }
  return results;
}

export function userMatchesClubQuery(user, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  const ids = normalizeProfileClubs(user?.profileClubs);
  if (!ids.length) return false;
  for (const id of ids) {
    if (id.toLowerCase().includes(q)) return true;
    const club = getClubById(id);
    if (!club) continue;
    if (String(club.label || '').toLowerCase().includes(q)) return true;
    if (String(club.shortLabel || '').toLowerCase().includes(q)) return true;
  }
  return false;
}

export default {
  searchClubs,
  resolveClubIdFromQuery,
  getMembersByClubId,
  getPeopleInSharedClubs,
  getMyProfileClubs,
  syncClubMembershipIndex,
  userMatchesClubQuery,
};