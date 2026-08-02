function readExtraLiveUrl() {
  try {
    // eslint-disable-next-line global-require
    const Constants = require('expo-constants').default || require('expo-constants');
    const extra = Constants?.expoConfig?.extra || Constants?.manifest?.extra || {};
    return (
      extra.EXPO_PUBLIC_LIVE_API_BASE_URL ||
      extra.EXPO_PUBLIC_LIVE_SERVICE_URL ||
      extra.EXPO_PUBLIC_API_BASE_URL ||
      ''
    );
  } catch {
    return '';
  }
}

/**
 * Canonical live-service base URL for economy + Cognito→Firebase federation.
 */
export function getLiveApiBaseUrl() {
  return String(
    process.env.EXPO_PUBLIC_LIVE_API_BASE_URL ||
      process.env.EXPO_PUBLIC_LIVE_SERVICE_URL ||
      process.env.EXPO_PUBLIC_API_BASE_URL ||
      readExtraLiveUrl() ||
      'https://blyp-live-service-innn3d7yqq-uc.a.run.app',
  )
    .trim()
    .replace(/\/+$/, '');
}

export function isLiveApiConfigured() {
  return getLiveApiBaseUrl().length > 0;
}
