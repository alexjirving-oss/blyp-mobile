// Safe, lazy Sentry initialization to avoid requiring native modules when absent
let Sentry = null;
let initialized = false;

function getDsn() {
  try {
    // Prefer Expo extra if available in Dev Client / builds
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Constants = require('expo-constants').default || require('expo-constants');
    const extra = Constants?.expoConfig?.extra || Constants?.manifest?.extra || {};
    if (extra.EXPO_PUBLIC_SENTRY_DSN) return String(extra.EXPO_PUBLIC_SENTRY_DSN);
  } catch {}
  try {
    if (process?.env?.EXPO_PUBLIC_SENTRY_DSN) return String(process.env.EXPO_PUBLIC_SENTRY_DSN);
  } catch {}
  return '';
}

function initSentryIfPossible() {
  if (initialized) return;
  const dsn = getDsn();
  if (!dsn || dsn.trim() === '') return; // no-op when DSN not provided
  try {
    // Require only when needed; if native bits are missing, fail gracefully
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sentry = require('sentry-expo');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Constants = require('expo-constants').default || require('expo-constants');
    const release = `${Constants.expoConfig?.slug || 'app'}@${Constants.expoConfig?.version || '0.0.0'}`;
    const dist = Constants.expoConfig?.extra?.gitSha || undefined;
    Sentry.init({
      dsn,
      enableInExpoDevelopment: true,
      debug: false,
      tracesSampleRate: 1.0,
      release,
      dist,
    });
    initialized = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[sentry] Disabled (module unavailable):', e?.message || e);
  }
}

// Perform best-effort init on import without throwing
try { initSentryIfPossible(); } catch {}

// Re-export a minimal API for callers that may reference Sentry
export { Sentry, initSentryIfPossible };
