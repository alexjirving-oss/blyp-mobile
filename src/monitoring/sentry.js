// Safe, lazy Sentry initialization. Default: off until analytics consent is granted.
let Sentry = null;
let initialized = false;
let enabled = false;

function getDsn() {
  try {
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
  if (!enabled) {
    return;
  }
  initSentryIfPossible();
}

export function initSentryIfPossible() {
  if (initialized) return;
  if (!enabled) return; // consent-gated
  const dsn = getDsn();
  if (!dsn || dsn.trim() === '') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sentry = require('sentry-expo');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const Constants = require('expo-constants').default || require('expo-constants');
    const release = `${Constants.expoConfig?.slug || 'app'}@${Constants.expoConfig?.version || '0.0.0'}`;
    const dist = Constants.expoConfig?.extra?.gitSha || undefined;
    Sentry.init({
      dsn,
      enableInExpoDevelopment: false,
      debug: false,
      // Keep sampling low even when consented.
      tracesSampleRate: 0.05,
      sampleRate: 0.2,
      release,
      dist,
    });
    initialized = true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[sentry] Disabled (module unavailable):', e?.message || e);
  }
}

// Do not auto-init on import. Consent must enable telemetry first.
try {
  // Warm consent cache asynchronously; still defaults to disabled.
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { ensureConsentLoaded, hasAnalyticsConsentSync } = require('../services/PrivacyConsent');
  ensureConsentLoaded()
    .then((consent) => {
      if (consent || hasAnalyticsConsentSync()) {
        setSentryEnabled(true);
      }
    })
    .catch(() => {});
} catch {}

export { Sentry };
