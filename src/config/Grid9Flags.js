/**
 * Grid 9 client flag. Default OFF until Phase 4 ships and live-service
 * LIVE_GRID9_ENABLED is on. Same extra/env read pattern as LiveGamesFlags.
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
    // Dynamic lookup — do not write process.env.EXPO_PUBLIC_* literally.
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

/** Grid 9 — default OFF until Phase 4 and live-service LIVE_GRID9_ENABLED. */
export function isGrid9Enabled() {
  return readPublicFlag('EXPO_PUBLIC_LIVE_GRID9_ENABLED', { defaultOn: false });
}
