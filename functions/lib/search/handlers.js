"use strict";
/**
 * HTTPS entry points for Blyp search.
 *
 *  - blypSearch      : run a blended, cached search (anonymous allowed; the Charter
 *                      says anyone can search). Hides all supplier keys server-side.
 *  - blypSearchEvent : the app reports clicks + in-app page snapshots, which feed
 *                      the corpus that becomes Blyp's own index.
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blypSearchEvent = exports.blypSearch = void 0;
const functions = __importStar(require("firebase-functions"));
const cors_1 = require("../http/cors");
const orchestrator_1 = require("./orchestrator");
const substrate_1 = require("../platform/substrate");
const util_1 = require("../platform/util");
const rateLimit_1 = require("../platform/rateLimit");
/** Best-effort client IP behind the Cloud Functions proxy. */
function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length)
        return fwd.split(',')[0].trim();
    if (Array.isArray(fwd) && fwd.length)
        return String(fwd[0]).trim();
    return req.ip || undefined;
}
exports.blypSearch = functions
    .runWith({ memory: '512MB', timeoutSeconds: 30 })
    .https.onRequest(async (req, res) => {
    (0, cors_1.applyCors)(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const body = req.body || {};
        const query = String(body.query || '').trim();
        if (!query) {
            res.status(400).json({ error: 'query is required' });
            return;
        }
        // Abuse guard (not a product cap): generous burst limit per caller.
        const rl = await (0, rateLimit_1.checkRateLimit)((0, rateLimit_1.callerKey)(clientIp(req), body.session), rateLimit_1.SEARCH_RATE_LIMIT);
        if (!rl.allowed) {
            res.set('Retry-After', String(rl.retryAfterSec));
            res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfterSec });
            return;
        }
        const geo = body.geo && typeof body.geo === 'object' ? body.geo : undefined;
        const response = await (0, orchestrator_1.runBlypSearch)({ query, session: body.session, geo });
        res.status(200).json(response);
    }
    catch (e) {
        console.error('[blypSearch] error', e === null || e === void 0 ? void 0 : e.message);
        res.status(500).json({ error: 'search_failed' });
    }
});
exports.blypSearchEvent = functions.https.onRequest(async (req, res) => {
    (0, cors_1.applyCors)(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const body = req.body || {};
        // Abuse guard: events are even more bursty than searches, so allow a wider window.
        const rl = await (0, rateLimit_1.checkRateLimit)((0, rateLimit_1.callerKey)(clientIp(req), body.session), { windowMs: 10000, max: 120 });
        if (!rl.allowed) {
            res.set('Retry-After', String(rl.retryAfterSec));
            res.status(429).json({ error: 'rate_limited', retryAfter: rl.retryAfterSec });
            return;
        }
        const type = body.type === 'snapshot' ? 'snapshot' : 'click';
        const sessionHash = (0, util_1.hashSession)(body.session || 'anon');
        const country = body.country ? String(body.country) : undefined;
        const qh = body.query ? (0, util_1.queryHash)(String(body.query), country) : undefined;
        if (type === 'click') {
            await (0, substrate_1.logSearchEvent)({
                type: 'click',
                queryHash: qh,
                sessionHash,
                url: body.url ? (0, util_1.canonicalUrl)(String(body.url)) : undefined,
                position: typeof body.position === 'number' ? body.position : undefined,
                provider: body.provider ? String(body.provider) : undefined,
            });
        }
        else {
            const url = (0, util_1.canonicalUrl)(String(body.url || ''));
            const excerpt = String(body.excerpt || '').slice(0, 1200); // visible-text excerpt only
            await (0, substrate_1.logSearchEvent)({
                type: 'snapshot',
                queryHash: qh,
                sessionHash,
                url,
                snapshot: {
                    url,
                    canonicalUrl: url,
                    title: body.title ? String(body.title).slice(0, 300) : undefined,
                    description: body.description ? String(body.description).slice(0, 600) : undefined,
                    excerpt,
                    contentHash: (0, util_1.sha256)(`${body.title || ''}\n${excerpt}`),
                    fingerprint: (0, util_1.fingerprint)(`${body.title || ''} ${excerpt}`),
                },
            });
        }
        res.status(200).json({ ok: true });
    }
    catch (e) {
        console.error('[blypSearchEvent] error', e === null || e === void 0 ? void 0 : e.message);
        res.status(500).json({ error: 'event_failed' });
    }
});
//# sourceMappingURL=handlers.js.map