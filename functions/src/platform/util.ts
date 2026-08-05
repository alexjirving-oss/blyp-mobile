/**
 * Platform substrate utilities: privacy-preserving hashing, canonicalisation,
 * near-duplicate fingerprints, geo bucketing and unit-economics helpers.
 *
 * Nothing here is supplier-specific; it is the plumbing the Charter relies on
 * (PII firewall, provenance, dedup, cost ledger).
 */

import * as crypto from 'crypto';

const SECRET_SALT = process.env.BLYP_HASH_SALT || 'blyp-default-salt';

/** Stable sha256 hex of an input (optionally salted for PII). */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Hash a session identifier behind a server-side salt so the stored value can
 * never be reversed back to the raw id/device. This is the PII firewall.
 */
export function hashSession(rawSessionOrUser: string): string {
  return sha256(`${SECRET_SALT}:${String(rawSessionOrUser || 'anon')}`).slice(0, 32);
}

/** Normalise a query for caching/dedup: lowercase, collapse whitespace. */
export function normalizeQuery(q: string): string {
  return String(q || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Cache/dedup key for a query, scoped by coarse geo so local results differ. */
export function queryHash(q: string, country?: string, geohash5?: string): string {
  return sha256(
    `${normalizeQuery(q)}|${(country || 'XX').toUpperCase()}|${geohash5 || ''}`
  ).slice(0, 24);
}

/** Canonicalise a URL for dedup + provenance (strip tracking params, fragments). */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(String(url));
    u.hash = '';
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];
    drop.forEach((p) => u.searchParams.delete(p));
    let s = u.toString();
    s = s.replace(/\/$/, '');
    return s;
  } catch {
    return String(url || '');
  }
}

/** Host of a URL without scheme/www, for display + ownership. */
export function hostOf(url: string): string {
  try {
    return String(url || '')
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * Lightweight 64-bit simhash (hex) for near-duplicate detection. Good enough to
 * collapse near-identical snippets/pages in the corpus without a heavy dep.
 */
export function fingerprint(text: string): string {
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const bits = new Array<number>(64).fill(0);
  for (const tok of tokens) {
    const h = sha256(tok);
    // use first 16 hex chars => 64 bits
    for (let i = 0; i < 64; i += 1) {
      const nibble = parseInt(h[Math.floor(i / 4)] || '0', 16);
      const bit = (nibble >> (3 - (i % 4))) & 1;
      bits[i] += bit ? 1 : -1;
    }
  }
  let out = '';
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j += 1) nibble = (nibble << 1) | (bits[i + j] > 0 ? 1 : 0);
    out += nibble.toString(16);
  }
  return out;
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/** Encode lat/lon to a geohash of the given precision (default 5 ~ 5km cell). */
export function geohash(lat: number, lon: number, precision = 5): string {
  let idx = 0;
  let bit = 0;
  let evenBit = true;
  let hash = '';
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lonMin + lonMax) / 2;
      if (lon >= mid) {
        idx = (idx << 1) + 1;
        lonMin = mid;
      } else {
        idx <<= 1;
        lonMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = (idx << 1) + 1;
        latMin = mid;
      } else {
        idx <<= 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    bit += 1;
    if (bit === 5) {
      hash += BASE32[idx];
      bit = 0;
      idx = 0;
    }
  }
  return hash;
}

/** Decode a geohash into a bounding box + center (for Nominatim viewbox bias). */
export function geohashBounds(hash: string): {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  lat: number;
  lon: number;
} | null {
  const h = String(hash || '').toLowerCase().trim();
  if (!h || !/^[0-9bcdefghjkmnpqrstuvwxyz]+$/.test(h)) return null;
  let evenBit = true;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  for (const ch of h) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) return null;
    for (let n = 4; n >= 0; n -= 1) {
      const bit = (idx >> n) & 1;
      if (evenBit) {
        const mid = (lonMin + lonMax) / 2;
        if (bit) lonMin = mid;
        else lonMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bit) latMin = mid;
        else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return {
    latMin,
    latMax,
    lonMin,
    lonMax,
    lat: (latMin + latMax) / 2,
    lon: (lonMin + lonMax) / 2,
  };
}

/** Convert a USD amount to integer micro-USD (1 USD = 1_000_000) for the ledger. */
export function usdToMicros(usd: number): number {
  return Math.round((usd || 0) * 1_000_000);
}
