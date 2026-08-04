import AsyncStorage from '@react-native-async-storage/async-storage';
import { hydrateCognitoStorageCache, removeFromCognitoStorageCache } from '../lib/auth/cognitoStorage';

// Proactively sanitize any malformed Cognito tokens that could crash
// amazon-cognito-identity-js with `this.jwtToken.split is not a function`.
// IMPORTANT: This must be awaited during app bootstrap to avoid racing with login.
export async function runPreAuthCleanup() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cognitoKeys = keys.filter((k) => k.includes('CognitoIdentityServiceProvider'));
    const pairs = cognitoKeys.length ? await AsyncStorage.multiGet(cognitoKeys) : [];

    // Strict JWT shape a.b.c (entire string).
    const isJwtLike = (value) => {
      if (typeof value !== 'string') return false;
      const t = value.trim();
      return /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(t);
    };
    const looksLikeObjectString = (value) => {
      const t = String(value || '').trim();
      return t.startsWith('{') || t.startsWith('[') || t.includes('[object Object]');
    };

    const isBadPair = ([k, v]) => {
      if (typeof v !== 'string') return true;

      const key = String(k || '');
      const keyLower = key.toLowerCase();
      const value = v.trim();
      const valueLower = value.toLowerCase();

      if (!value) return true;
      if (valueLower === 'null' || valueLower === 'undefined') return true;
      if (looksLikeObjectString(value)) return true;

      const isIdTokenKey = keyLower.endsWith('.idtoken') || keyLower.includes('.idtoken.');
      const isAccessTokenKey = keyLower.endsWith('.accesstoken') || keyLower.includes('.accesstoken.');
      const isRefreshTokenKey = keyLower.endsWith('.refreshtoken') || keyLower.includes('.refreshtoken.');
      const isTokenScopesKey = keyLower.endsWith('.tokenscopesstring') || keyLower.includes('.tokenscopesstring.');
      if (isIdTokenKey || isAccessTokenKey) return !isJwtLike(value);
      if (isRefreshTokenKey) return value.length < 10;
      if (isTokenScopesKey) return value.length < 3;

      return false;
    };

    const keysToRemove = pairs.filter(isBadPair).map(([k]) => k).filter(Boolean);
    if (keysToRemove.length) {
      await AsyncStorage.multiRemove(keysToRemove);
      removeFromCognitoStorageCache(keysToRemove);
      // eslint-disable-next-line no-console
      console.log('🧹 Removed malformed Cognito keys from AsyncStorage', { count: keysToRemove.length });
    }
  } catch {}

  // Keep the sync storage mirror up-to-date for Cognito session reads.
  try {
    await hydrateCognitoStorageCache({ force: true });
  } catch {}
}

export default runPreAuthCleanup;
