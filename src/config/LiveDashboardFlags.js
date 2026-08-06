/**
 * Stage Desk (Live Dashboard) feature flags.
 *
 * EXPO_PUBLIC_LIVE_DASHBOARD_PRO — when on, unlocks Plus widget catalog
 * even without Blyp Plus / trial (dev + staged rollouts).
 */
import Constants from 'expo-constants';

function readExtra(key) {
  try {
    return (
      Constants?.expoConfig?.extra?.[key] ??
      Constants?.manifest?.extra?.[key] ??
      Constants?.manifest2?.extra?.expoClient?.extra?.[key] ??
      Constants?.manifest2?.extra?.[key] ??
      ''
    );
  } catch {
    return '';
  }
}

function readEnv(key) {
  try {
    return String((process.env && process.env[key]) || '').trim();
  } catch {
    return '';
  }
}

function readPublicFlag(key, { defaultOn = false } = {}) {
  const fromEnv = readEnv(key);
  const fromExtra = String(readExtra(key) ?? '').trim();
  const raw = (fromEnv || fromExtra).toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  return !!defaultOn;
}

/** Force-unlock Stage Desk Pro catalog (bypass Plus entitlement). */
export function isLiveDashboardProFlagOn() {
  return readPublicFlag('EXPO_PUBLIC_LIVE_DASHBOARD_PRO', { defaultOn: false });
}
