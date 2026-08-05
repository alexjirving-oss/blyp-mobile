"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyCors = applyCors;
function parseAllowedOrigins(raw) {
    const set = new Set();
    const s = String(raw || '').trim();
    if (!s)
        return set;
    for (const part of s.split(',')) {
        const origin = part.trim();
        if (!origin)
            continue;
        if (origin === '*')
            continue; // explicit deny: no wildcard for authenticated endpoints
        set.add(origin);
    }
    return set;
}
function applyCors(req, res, opts) {
    const origin = String(req.headers.origin || '').trim();
    const allowed = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
    // Only set Access-Control-Allow-Origin when Origin is explicitly allowlisted.
    if (origin && allowed.has(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Methods', opts.methods);
    res.set('Access-Control-Allow-Headers', opts.allowHeaders || 'Content-Type, Authorization');
}
//# sourceMappingURL=cors.js.map