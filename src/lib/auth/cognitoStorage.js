import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = 'CognitoIdentityServiceProvider';

/**
 * @aws-amplify/react-native (loaded at boot by src/config/amplify.js) registers
 * a platform storage that prefixes every key written by amazon-cognito-identity-js
 * with "@MemoryStorage:".  As of aws-amplify v6 + amazon-cognito-identity-js v6,
 * the library ignores the custom `Storage` passed to CognitoUserPool and uses the
 * Amplify-registered adapter instead.
 *
 * Because of this, tokens land in AsyncStorage under keys like:
 *   @MemoryStorage:CognitoIdentityServiceProvider.<clientId>.LastAuthUser
 *
 * But CognitoUserPool.getCurrentUser() asks for bare keys (no prefix) via
 * this.storage.getItem().  This adapter normalizes both directions:
 *   • hydration strips the prefix so bare-key reads succeed
 *   • writes persist both bare AND prefixed keys so both Amplify and our adapter stay in sync
 */
const AMPLIFY_STORAGE_PREFIX = '@MemoryStorage:';

/**
 * Strip the @MemoryStorage: prefix if present, returning the bare key that
 * amazon-cognito-identity-js's CognitoUserPool.getCurrentUser() expects.
 */
function stripAmplifyPrefix(key) {
  if (typeof key !== 'string') return key;
  return key.startsWith(AMPLIFY_STORAGE_PREFIX)
    ? key.slice(AMPLIFY_STORAGE_PREFIX.length)
    : key;
}

/**
 * amazon-cognito-identity-js expects a synchronous, localStorage-like adapter.
 * React Native AsyncStorage is async; using it directly can yield corrupted sessions
 * and runtime crashes like `this.jwtToken.split is not a function`.
 *
 * This adapter keeps an in-memory mirror for sync reads, while persisting writes
 * to AsyncStorage in the background.
 */
const memory = new Map();
let hydratePromise = null;
const pendingWrites = new Set();

function trackWrite(promise) {
  try {
    if (!promise || typeof promise.finally !== 'function') return;
    pendingWrites.add(promise);
    promise.finally(() => {
      try {
        pendingWrites.delete(promise);
      } catch { }
    });
  } catch { }
}

export async function flushCognitoStorageWrites(options = {}) {
  const timeoutMs = typeof options?.timeoutMs === 'number' ? options.timeoutMs : 5000;
  try {
    const writes = Array.from(pendingWrites);
    if (!writes.length) return;

    let timeoutId;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(resolve, timeoutMs);
    });

    await Promise.race([Promise.allSettled(writes), timeout]);
    try {
      clearTimeout(timeoutId);
    } catch { }
  } catch {
    // Best-effort only.
  }
}

export async function hydrateCognitoStorageCache(options = {}) {
  const force = options?.force === true;
  if (!force && hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cognitoKeys = keys.filter((k) => String(k || '').includes(CACHE_PREFIX));
      if (!cognitoKeys.length) {
        memory.clear();
        return;
      }
      const pairs = await AsyncStorage.multiGet(cognitoKeys);
      memory.clear();
      for (const [k, v] of pairs) {
        if (typeof k !== 'string') continue;
        if (typeof v !== 'string') continue;
        // Store under the BARE key (prefix stripped) so CognitoUserPool.getCurrentUser()
        // can find the value with its unprefixed lookup key.
        const bareKey = stripAmplifyPrefix(k);
        memory.set(bareKey, v);
        // Also keep the prefixed version so getItem works for either form.
        if (bareKey !== k) {
          memory.set(k, v);
        }
      }
    } catch {
      // Best-effort only: if hydration fails, Cognito will behave as logged-out.
    }
  })();

  return hydratePromise;
}

export function removeFromCognitoStorageCache(keys) {
  try {
    for (const k of keys || []) {
      if (typeof k === 'string') {
        memory.delete(k);
        // Also remove the other form (prefixed ↔ bare).
        const bare = stripAmplifyPrefix(k);
        if (bare !== k) memory.delete(bare);
        else memory.delete(AMPLIFY_STORAGE_PREFIX + k);
      }
    }
  } catch { }
}

export function clearCognitoStorageCache() {
  try {
    memory.clear();
  } catch { }
}

export const cognitoStorage = {
  getItem(key) {
    try {
      const k = String(key || '');
      // Try bare key first (normal path), then prefixed (Amplify-written tokens).
      const v = memory.get(k) ?? memory.get(AMPLIFY_STORAGE_PREFIX + k);
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      const k = String(key || '');
      const v = typeof value === 'string' ? value : String(value);
      // Mirror to both bare and prefixed forms in memory.
      memory.set(k, v);
      memory.set(AMPLIFY_STORAGE_PREFIX + k, v);
      // Persist both forms to AsyncStorage so tokens survive across app restarts
      // regardless of which key format the reader expects.
      trackWrite(AsyncStorage.setItem(k, v).catch(() => { }));
      trackWrite(AsyncStorage.setItem(AMPLIFY_STORAGE_PREFIX + k, v).catch(() => { }));
    } catch { }
  },
  removeItem(key) {
    try {
      const k = String(key || '');
      memory.delete(k);
      memory.delete(AMPLIFY_STORAGE_PREFIX + k);
      trackWrite(AsyncStorage.removeItem(k).catch(() => { }));
      trackWrite(AsyncStorage.removeItem(AMPLIFY_STORAGE_PREFIX + k).catch(() => { }));
    } catch { }
  },
};

// Fire-and-forget hydration so a dev-client reload or Fast Refresh doesn't
// start from an empty in-memory cache.
try {
  hydrateCognitoStorageCache().catch(() => { });
} catch { }
