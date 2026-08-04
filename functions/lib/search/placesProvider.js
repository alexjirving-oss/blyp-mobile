"use strict";
/**
 * Place/business provider via OpenStreetMap Nominatim (keyless, free, no lock-in).
 *
 * Charter rule: we NEVER fabricate contact details. A field is present only if the
 * source actually returned it. `precise` is true only when we resolved a single,
 * contactable location - the orchestrator uses that to decide on the hero card.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.placesProvider = void 0;
const net_1 = require("./net");
function mapUrl(lat, lon) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`;
}
function directionsUrl(lat, lon) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}
async function placesProvider(query, country, geohash5) {
    const params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        addressdetails: '1',
        extratags: '1',
        namedetails: '1',
        limit: '5',
    });
    if (country)
        params.set('countrycodes', country.toLowerCase());
    const data = await (0, net_1.fetchJson)(`https://nominatim.openstreetmap.org/search?${params.toString()}`, { timeoutMs: 7000 });
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
    // bias note: geohash5 currently informs nothing beyond country; kept for future
    // distance ranking once we store place geohashes.
    void geohash5;
    return { provider: 'osm', results, costMicros: 0 };
}
exports.placesProvider = placesProvider;
//# sourceMappingURL=placesProvider.js.map