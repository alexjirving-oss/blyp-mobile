// spoilerStore.js
//
// Tracks which results a user has chosen to reveal, so scores/podiums stay
// hidden by default (spoiler-safe) but don't keep re-hiding once the user has
// deliberately tapped "Show". Persisted to AsyncStorage and mirrored in memory
// for synchronous reads after the first load.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@blyp/revealedResults';

let revealed = null; // Set<string> once loaded
let loading = null;

async function ensureLoaded() {
  if (revealed) return revealed;
  if (loading) return loading;
  loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      revealed = new Set(Array.isArray(arr) ? arr.map(String) : []);
    } catch {
      revealed = new Set();
    }
    loading = null;
    return revealed;
  })();
  return loading;
}

/** Load the full set of revealed result ids (call once on mount). */
export async function loadRevealed() {
  const set = await ensureLoaded();
  return new Set(set);
}

/** Synchronous check; only accurate after loadRevealed() has resolved. */
export function isRevealedSync(id) {
  return !!revealed && revealed.has(String(id));
}

/** Mark a result revealed and persist. */
export async function reveal(id) {
  const set = await ensureLoaded();
  set.add(String(id));
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // best-effort
  }
  return new Set(set);
}

export default { loadRevealed, isRevealedSync, reveal };
