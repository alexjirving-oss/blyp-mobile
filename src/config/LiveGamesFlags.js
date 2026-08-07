/**
 * Live overlay game flags (Marble Race, Artillery).
 *
 * Production Hermes builds often leave `process.env.EXPO_PUBLIC_*` empty unless
 * Babel inlined them. Prefer Constants.expoConfig.extra (populated by app.config.js)
 * with process.env as a fallback — same pattern as StreamingFeatureFlag.
 *
 * Important: read env via dynamic key (`process.env[key]`) so babel-preset-expo
 * does not freeze a build-time literal into this helper.
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

/** Marble Race (Guest Grand Prix) — production default ON (shippable; backend LIVE_MARBLE_RACE_ENABLED=1). */
export function isMarbleRaceEnabled() {
  return readPublicFlag('EXPO_PUBLIC_LIVE_MARBLE_RACE_ENABLED', { defaultOn: true });
}

/** Artillery battle mini-game — opt-in via env/extra (backend LIVE_ARTILLERY_ENABLED may still gate). */
export function isArtilleryEnabled() {
  return readPublicFlag('EXPO_PUBLIC_LIVE_ARTILLERY_ENABLED', { defaultOn: false });
}

/** Frenemies live party game — ON by default (backend LIVE_FRENEMIES_ENABLED defaults on). */
export function isFrenemiesEnabled() {
  return readPublicFlag('EXPO_PUBLIC_LIVE_FRENEMIES_ENABLED', { defaultOn: true });
}

/** Reaction Duel paid skill game — ON by default for demo/live Games picker. */
export function isReactionDuelEnabled() {
  return readPublicFlag('EXPO_PUBLIC_LIVE_REACTION_DUEL_ENABLED', { defaultOn: true });
}
