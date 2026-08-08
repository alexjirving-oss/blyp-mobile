// teamPreferencesService.js
//
// Stores the teams a user follows for their "Your Page" surface.
//
// Source of truth for the UI is an in-memory store, persisted to AsyncStorage so
// Your Page renders instantly and keeps working for guests / offline. Firestore
// (users/{uid}/followedTeams/{teamId}) is used as a best-effort cross-device
// sync layer: we merge server teams in once on subscribe and mirror writes there,
// but we never let a Firestore snapshot wipe a local add/remove. This keeps the
// feature reliable even when the Firebase auth bridge is temporarily unavailable.

import { collection, doc, setDoc, deleteDoc, getDocs } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firestore as db } from '../config/firebase';

const GUEST_KEY = '@blyp/followedTeams/guest';
const cacheKey = (uid) => (uid ? `@blyp/followedTeams/${uid}` : GUEST_KEY);
const storeKey = (uid) => uid || '__guest__';

// uid -> { teams: Team[], listeners: Set<fn>, hydrated: boolean, hydrating: Promise|null }
const stores = new Map();

function getStore(uid) {
  const key = storeKey(uid);
  let s = stores.get(key);
  if (!s) {
    s = { teams: [], listeners: new Set(), hydrated: false, hydrating: null };
    stores.set(key, s);
  }
  return s;
}

function emit(store) {
  const snapshot = store.teams.slice();
  store.listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // a misbehaving listener shouldn't break the others
    }
  });
}

// Keep only the fields we need so the cache/doc stays small.
function compactTeam(team) {
  if (!team || !team.id) return null;
  const out = {
    id: String(team.id),
    name: team.name || '',
    shortName: team.shortName || '',
    badge: team.badge || null,
    league: team.league || '',
    stadium: team.stadium || '',
    website: team.website || '',
    sport: team.sport || 'Soccer',
  };
  if (team.leagueId) out.leagueId = String(team.leagueId);
  if (team.country) out.country = String(team.country);
  if (team.clubCatalogId) out.clubCatalogId = String(team.clubCatalogId);
  return out;
}

async function readCache(uid) {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(compactTeam).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function writeCache(uid, teams) {
  try {
    await AsyncStorage.setItem(cacheKey(uid), JSON.stringify(teams || []));
  } catch {
    // Non-fatal: cache is best-effort.
  }
}

// Append any teams not already present (by id), preserving existing local order.
function mergeAppend(existing, incoming) {
  const seen = new Set(existing.map((t) => t.id));
  const merged = existing.slice();
  incoming.forEach((t) => {
    const c = compactTeam(t);
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      merged.push(c);
    }
  });
  return merged;
}

async function hydrate(uid, store) {
  if (store.hydrated) return;
  if (store.hydrating) return store.hydrating;

  store.hydrating = (async () => {
    // 1) Local cache first (fast, always available).
    const cached = await readCache(uid);
    if (cached.length) {
      store.teams = mergeAppend(store.teams, cached);
      emit(store);
    }

    // 2) Best-effort one-time merge from Firestore for cross-device sync.
    if (uid) {
      try {
        const snap = await getDocs(collection(db, 'users', uid, 'followedTeams'));
        const server = snap.docs.map((d) => compactTeam({ id: d.id, ...d.data() })).filter(Boolean);
        if (server.length) {
          const before = store.teams.length;
          store.teams = mergeAppend(store.teams, server);
          if (store.teams.length !== before) {
            emit(store);
            writeCache(uid, store.teams);
          }
        }
      } catch (error) {
        // Auth/permission/offline — ignore, local store remains authoritative.
        console.warn('followedTeams server merge skipped:', error?.message || error);
      }
    }

    store.hydrated = true;
    store.hydrating = null;
  })();

  return store.hydrating;
}

/**
 * Subscribe to the user's followed teams.
 * Immediately invokes `callback` with the current (possibly cached) list and
 * then again whenever it changes. Returns an unsubscribe function.
 */
export function subscribeFollowedTeams(uid, callback) {
  const store = getStore(uid);
  store.listeners.add(callback);

  // Emit whatever we already have synchronously-ish.
  callback(store.teams.slice());

  // Kick off hydration (cache + best-effort server merge).
  hydrate(uid, store);

  return () => {
    store.listeners.delete(callback);
  };
}

/** Add a team to the user's followed list. */
export async function addFollowedTeam(uid, team) {
  const compact = compactTeam(team);
  if (!compact) return { success: false, error: 'Invalid team' };

  const store = getStore(uid);
  if (!store.teams.some((t) => t.id === compact.id)) {
    store.teams = [compact, ...store.teams];
    emit(store);
    writeCache(uid, store.teams);
  }

  if (!uid) return { success: true };

  try {
    await setDoc(doc(db, 'users', uid, 'followedTeams', compact.id), {
      ...compact,
      addedAt: new Date(),
    });
    return { success: true };
  } catch (error) {
    // Local store already updated; Firestore sync is best-effort.
    console.warn('addFollowedTeam (firestore) skipped:', error?.message || error);
    return { success: true, synced: false };
  }
}

/** Remove a team from the user's followed list. */
export async function removeFollowedTeam(uid, teamId) {
  const id = String(teamId);

  const store = getStore(uid);
  const next = store.teams.filter((t) => t.id !== id);
  if (next.length !== store.teams.length) {
    store.teams = next;
    emit(store);
    writeCache(uid, store.teams);
  }

  if (!uid) return { success: true };

  try {
    await deleteDoc(doc(db, 'users', uid, 'followedTeams', id));
    return { success: true };
  } catch (error) {
    console.warn('removeFollowedTeam (firestore) skipped:', error?.message || error);
    return { success: true, synced: false };
  }
}

/** One-shot read (used rarely; subscribe is preferred). */
export async function getFollowedTeamsOnce(uid) {
  const store = getStore(uid);
  if (store.hydrated || store.teams.length) return store.teams.slice();
  return readCache(uid);
}

export default {
  subscribeFollowedTeams,
  addFollowedTeam,
  removeFollowedTeam,
  getFollowedTeamsOnce,
};
