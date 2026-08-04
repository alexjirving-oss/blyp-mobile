// Safe, lazy Sentry initialization to avoid requiring native modules when absent
let Sentry = null;
let initialized = false;
let enabled = false;

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

export function setSentryEnabled(next) {
  enabled = !!next;
  if (enabled) {
    initSentryIfPossible();
  }
}

function initSentryIfPossible() {
  if (initialized) return;
  if (!enabled) return;
  const dsn = getDsn();
  if (!dsn || dsn.trim() === '') return; // no-op when DSN not provided
  try {
    // Require only when needed; if native bits are missing, fail gracefully
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sentry = require('@sentry/react-native');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Constants = require('expo-constants').default || require('expo-constants');
    const release = `${Constants.expoConfig?.slug || 'app'}@${Constants.expoConfig?.version || '0.0.0'}`;
    const dist = Constants.expoConfig?.extra?.gitSha || undefined;
    Sentry.init({
      dsn,
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

/**
 * Report an exception to Sentry if it is initialized. No-ops safely when no DSN
 * is configured or the native module is unavailable, so callers can wire this
 * everywhere without guarding. `context` is attached as extra data.
 */
export function captureException(error, context) {
  try {
    if (!initialized || !Sentry || !enabled) return false;
    const capture = Sentry?.captureException || Sentry?.Native?.captureException;
    if (typeof capture !== 'function') return false;
    capture(error instanceof Error ? error : new Error(String(error?.message || error)), {
      extra: context || undefined,
    });
    return true;
  } catch {
    return false;
  }
}

export { Sentry, initSentryIfPossible };
