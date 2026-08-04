// placesService.js
//
// Keyless place/business lookup for Blyp "search a shop/place" intent. Backed by
// OpenStreetMap Nominatim (free, no API key). Returns a real address + coords,
// and a phone/website when OSM has them — we never fabricate contact details.
//
// Action URLs (maps / directions) are built from real coords so they always
// point at the right location. Degrades gracefully to null on any failure.

import { stripNearMePhrases } from './locationService';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 7000;
const NEAR_RADIUS_DEG = 0.08; // ~5–9 km bias box around the user

function pickName(r) {
  const tags = r.extratags || {};
  return (
    tags.brand ||
    tags.name ||
    (r.namedetails && (r.namedetails.name || r.namedetails['name:en'])) ||
    String(r.display_name || '').split(',')[0]
  );
}

/**
 * Look up a place/business by free-text query.
 * @returns {Promise<null | {
 *   name:string, address:string, lat:string, lon:string,
 *   phone?:string, website?:string, openingHours?:string,
 *   mapUrl:string, directionsUrl:string
 * }>}
 */
/**
 * @param {string} query
 * @param {{ lat?: number, lon?: number } | null} [geo] When set, biases results near the user.
 */
export async function searchPlace(query, geo) {
  let q = String(query || '').trim();
  if (!q) return null;
  if (geo?.lat != null && geo?.lon != null) {
    q = stripNearMePhrases(q) || q;
  }

  let url =
    `${NOMINATIM}?q=${encodeURIComponent(q)}` +
    `&format=jsonv2&addressdetails=1&extratags=1&namedetails=1&limit=5`;
  if (geo?.lat != null && geo?.lon != null) {
    const lat = Number(geo.lat);
    const lon = Number(geo.lon);
    url += `&lat=${lat}&lon=${lon}`;
    const d = NEAR_RADIUS_DEG;
    url += `&viewbox=${lon - d},${lat + d},${lon + d},${lat - d}&bounded=1`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Nominatim usage policy requires an identifying UA.
        'User-Agent': 'BlypApp/1.0 (in-app place lookup)',
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const arr = await res.json();
    const rows = Array.isArray(arr) ? arr.filter((row) => row?.lat && row?.lon) : [];
    const r = rows[0] || null;
    if (!r) return null;

    const tags = r.extratags || {};
    const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '';
    const website = tags.website || tags['contact:website'] || tags.url || '';
    const openingHours = tags.opening_hours || '';

    const latlon = `${r.lat},${r.lon}`;
    return {
      name: pickName(r),
      address: r.display_name || '',
      lat: r.lat,
      lon: r.lon,
      phone: phone || undefined,
      website: website || undefined,
      openingHours: openingHours || undefined,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(latlon)}`,
      directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(latlon)}`,
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export default { searchPlace };
