import AsyncStorage from '@react-native-async-storage/async-storage';

const CONSENT_KEY = 'blyp.privacy.analyticsConsent.v1';

let cachedConsent = null;
const listeners = new Set();

function notify(value) {
  listeners.forEach((listener) => {
    try {
      listener(value);
    } catch {}
  });
}

export async function getAnalyticsConsent() {
  if (cachedConsent !== null) return cachedConsent;
  try {
    const raw = await AsyncStorage.getItem(CONSENT_KEY);
    cachedConsent = raw === '1' || raw === 'true';
  } catch {
    cachedConsent = false;
  }
  return cachedConsent;
}

export async function setAnalyticsConsent(enabled) {
  const next = !!enabled;
  cachedConsent = next;
  try {
    await AsyncStorage.setItem(CONSENT_KEY, next ? '1' : '0');
  } catch {}
  notify(next);
  return next;
}

export function subscribeAnalyticsConsent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Synchronous best-effort read for hot paths after first async load. Defaults false. */
export function hasAnalyticsConsentSync() {
  return cachedConsent === true;
}

export async function ensureConsentLoaded() {
  return getAnalyticsConsent();
}
