"use strict";
/**
 * Platform substrate utilities: privacy-preserving hashing, canonicalisation,
 * near-duplicate fingerprints, geo bucketing and unit-economics helpers.
 *
 * Nothing here is supplier-specific; it is the plumbing the Charter relies on
 * (PII firewall, provenance, dedup, cost ledger).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256 = sha256;
exports.hashSession = hashSession;
exports.normalizeQuery = normalizeQuery;
exports.queryHash = queryHash;
exports.canonicalUrl = canonicalUrl;
exports.hostOf = hostOf;
exports.fingerprint = fingerprint;
exports.geohash = geohash;
exports.usdToMicros = usdToMicros;
const crypto = __importStar(require("crypto"));
const SECRET_SALT = process.env.BLYP_HASH_SALT || 'blyp-default-salt';
/** Stable sha256 hex of an input (optionally salted for PII). */
function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}
/**
 * Hash a session identifier behind a server-side salt so the stored value can
 * never be reversed back to the raw id/device. This is the PII firewall.
 */
function hashSession(rawSessionOrUser) {
    return sha256(`${SECRET_SALT}:${String(rawSessionOrUser || 'anon')}`).slice(0, 32);
}
/** Normalise a query for caching/dedup: lowercase, collapse whitespace. */
function normalizeQuery(q) {
    return String(q || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}
/** Cache/dedup key for a query, scoped by coarse country so local results differ. */
function queryHash(q, country) {
    return sha256(`${normalizeQuery(q)}|${(country || 'XX').toUpperCase()}`).slice(0, 24);
}
/** Canonicalise a URL for dedup + provenance (strip tracking params, fragments). */
function canonicalUrl(url) {
    try {
        const u = new URL(String(url));
        u.hash = '';
        const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];
        drop.forEach((p) => u.searchParams.delete(p));
        let s = u.toString();
        s = s.replace(/\/$/, '');
        return s;
    }
    catch (_a) {
        return String(url || '');
    }
}
/** Host of a URL without scheme/www, for display + ownership. */
function hostOf(url) {
    try {
        return String(url || '')
            .replace(/^https?:\/\//i, '')
            .split('/')[0]
            .replace(/^www\./i, '');
    }
    catch (_a) {
        return '';
    }
}
/**
 * Lightweight 64-bit simhash (hex) for near-duplicate detection. Good enough to
 * collapse near-identical snippets/pages in the corpus without a heavy dep.
 */
function fingerprint(text) {
    const tokens = String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const bits = new Array(64).fill(0);
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
        for (let j = 0; j < 4; j += 1)
            nibble = (nibble << 1) | (bits[i + j] > 0 ? 1 : 0);
        out += nibble.toString(16);
    }
    return out;
}
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
/** Encode lat/lon to a geohash of the given precision (default 5 ~ 5km cell). */
function geohash(lat, lon, precision = 5) {
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
            }
            else {
                idx <<= 1;
                lonMax = mid;
            }
        }
        else {
            const mid = (latMin + latMax) / 2;
            if (lat >= mid) {
                idx = (idx << 1) + 1;
                latMin = mid;
            }
            else {
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
/** Convert a USD amount to integer micro-USD (1 USD = 1_000_000) for the ledger. */
function usdToMicros(usd) {
    return Math.round((usd || 0) * 1000000);
}
//# sourceMappingURL=util.js.map