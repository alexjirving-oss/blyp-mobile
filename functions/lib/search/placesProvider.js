"use strict";
/**
 * Place/business provider via OpenStreetMap Nominatim (keyless, free, no lock-in).
 *
 * Charter rule: we NEVER fabricate contact details. A field is present only if the
 * source actually returned it. `precise` is true only when we resolved a single,
 * contactable location - the orchestrator uses that to decide on the hero card.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.placesProvider = placesProvider;
const util_1 = require("../platform/util");
const net_1 = require("./net");
const NEAR_PHRASE = /\b(near\s*me|nearby|around\s*me|close\s*to\s*me|in\s*my\s*area|closest(?:\s+to\s+me)?|nearest)\b/gi;
function stripNearMe(query) {
    return String(query || '')
        .replace(NEAR_PHRASE, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
function mapUrl(lat, lon) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}
function directionsUrl(lat, lon) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
async function placesProvider(query, country, geohash5) {
    const cleaned = stripNearMe(query) || String(query || '').trim();
    if (!cleaned)
        return { provider: 'osm', results: [], costMicros: 0 };
    const params = new URLSearchParams({
        q: cleaned,
        format: 'jsonv2',
        addressdetails: '1',
        extratags: '1',
        namedetails: '1',
        limit: '5',
    });
    if (country)
        params.set('countrycodes', country.toLowerCase());
    // Bias toward the user's coarse geohash cell (~5km). Prefer nearby hits; if the
    // bounded search returns nothing, retry unbounded so we still surface a place.
    const bounds = geohash5 ? (0, util_1.geohashBounds)(geohash5) : null;
    if (bounds) {
        // Expand ~1 cell so dense urban areas still match.
        const padLat = Math.max(0.04, (bounds.latMax - bounds.latMin) * 1.5);
        const padLon = Math.max(0.04, (bounds.lonMax - bounds.lonMin) * 1.5);
        const lat = bounds.lat;
        const lon = bounds.lon;
        params.set('lat', String(lat));
        params.set('lon', String(lon));
        params.set('viewbox', `${lon - padLon},${lat + padLat},${lon + padLon},${lat - padLat}`);
        params.set('bounded', '1');
    }
    let data = await (0, net_1.fetchJson)(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        timeoutMs: 7000,
    });
    if ((!Array.isArray(data) || !data.length) && bounds) {
        params.delete('viewbox');
        params.delete('bounded');
        params.delete('lat');
        params.delete('lon');
        data = await (0, net_1.fetchJson)(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
            timeoutMs: 7000,
        });
    }
    if (!Array.isArray(data) || !data.length)
        return { provider: 'osm', results: [], costMicros: 0 };
    const results = data.slice(0, 5).map((d) => {
        var _a;
        const tags = d.extratags || {};
        const lat = String(d.lat);
        const lon = String(d.lon);
        const name = ((_a = d.namedetails) === null || _a === void 0 ? void 0 : _a.name) || d.name || String(d.display_name || '').split(',')[0];
        const phone = tags['contact:phone'] || tags.phone || undefined;
        const website = tags['contact:website'] || tags.website || undefined;
        const openingHours = tags.opening_hours || undefined;
        // "precise" when this is an actual point of interest with a name + a contact handle.
        const precise = Boolean(name) && (Boolean(phone) || Boolean(website) || d.addresstype !== 'city');
        return {
            kind: 'place',
            title: name,
            snippet: d.display_name,
            url: website,
            source: 'OpenStreetMap',
            place: {
                name,
                address: d.display_name,
                phone,
                website,
                openingHours,
                lat,
                lon,
                mapUrl: mapUrl(lat, lon),
                directionsUrl: directionsUrl(lat, lon),
                precise,
            },
            provenance: {
                provider: 'osm',
                providerVersion: '1',
                canonicalUrl: website,
                fetchedAt: Date.now(),
                ownerType: 'business',
                ownerId: d.osm_type && d.osm_id ? `${d.osm_type}/${d.osm_id}` : undefined,
            },
        };
    });
    return { provider: 'osm', results, costMicros: 0 };
}
//# sourceMappingURL=placesProvider.js.map