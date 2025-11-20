import AsyncStorage from '@react-native-async-storage/async-storage';

// On module load, proactively sanitize any malformed Cognito tokens that could crash
// amazon-cognito-identity-js with `this.jwtToken.split is not a function`.
// We only remove keys if tokens fail a basic JWT shape check.
(async () => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cognitoKeys = keys.filter((k) => k.includes('CognitoIdentityServiceProvider'));
    if (!cognitoKeys.length) return;

    const pairs = await AsyncStorage.multiGet(cognitoKeys);
    const isBad = pairs.some(([k, v]) => {
      if (!v || typeof v !== 'string') return true;
      // JWT-like tokens appear in values stored for idToken / accessToken
      // If any token-shaped value is clearly not a JWT, consider storage corrupted.
      const looksJwt = /\b[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/.test(v);
      const looksObject = v.trim().startsWith('{') || v.includes('[object Object]');
      return looksObject || (!looksJwt && v.toLowerCase().includes('token'));
    });

    if (isBad) {
      await AsyncStorage.multiRemove(cognitoKeys);
      // eslint-disable-next-line no-console
      console.log('🧹 Cleared malformed Cognito session tokens from AsyncStorage');
    }
  } catch {}
})();
