// locationService.js
//
// Foreground location for Blyp place searches ("takeaways near me"). Requests
// permission on demand and can deep-link into system settings when denied.

import { Linking } from 'react-native';

const NEAR_ME =
  /\b(near\s*me|nearby|around\s*me|close\s*to\s*me|in\s*my\s*area|closest\s+to\s+me)\b/i;

/** True when the query needs the user's coordinates to answer well. */
export function needsLocationForQuery(query) {
  return NEAR_ME.test(String(query || ''));
}

/** Strip proximity phrases so Nominatim gets a cleaner business-type query. */
export function stripNearMePhrases(query) {
  return String(query || '')
    .replace(
      /\b(near\s*me|nearby|around\s*me|close\s*to\s*me|in\s*my\s*area|closest\s+to\s+me)\b/gi,
      ' '
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function openLocationSettings() {
  return Linking.openSettings();
}

function getLocationModule() {
  try {
    // eslint-disable-next-line global-require
    return require('expo-location');
  } catch {
    return null;
  }
}

/**
 * Request foreground location (if needed) and return coords.
 * @returns {Promise<{ ok: true, geo: { lat: number, lon: number } } | { ok: false, reason: 'denied'|'unavailable'|'error' }>}
 */
export async function getCurrentGeo() {
  const Location = getLocationModule();
  if (!Location?.requestForegroundPermissionsAsync) {
    return { ok: false, reason: 'unavailable' };
  }
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    let status = existing?.status;
    if (status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      status = req?.status;
    }
    if (status !== 'granted') {
      return { ok: false, reason: 'denied' };
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy?.Balanced,
    });
    const lat = pos?.coords?.latitude;
    const lon = pos?.coords?.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return { ok: false, reason: 'error' };
    }
    return { ok: true, geo: { lat, lon } };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export default {
  needsLocationForQuery,
  stripNearMePhrases,
  openLocationSettings,
  getCurrentGeo,
};
