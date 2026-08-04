"use strict";
/**
 * HTTPS entry point for post interaction signals (the fuel for earn-your-reach).
 *
 *  - blypPostEvent : the app reports batched impressions/likes/shares/saves/watch
 *                    events. These are aggregated by the scheduled blypReachSweep
 *                    into each post's transparent Blyp Score and wave. PII firewall:
 *                    we store a hashed session, never the raw user id.
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
exports.blypPostEvent = void 0;
const functions = __importStar(require("firebase-functions"));
const cors_1 = require("../http/cors");
const substrate_1 = require("../platform/substrate");
const util_1 = require("../platform/util");
const VALID_TYPES = new Set([
    'impression',
    'like',
    'comment',
    'share',
    'save',
    'watch',
]);
const MAX_EVENTS = 100;
exports.blypPostEvent = functions.https.onRequest(async (req, res) => {
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
        const sessionHash = (0, util_1.hashSession)(body.session || 'anon');
        const raw = Array.isArray(body.events) ? body.events : [];
        const events = raw
            .slice(0, MAX_EVENTS)
            .map((e) => {
            const type = VALID_TYPES.has(e === null || e === void 0 ? void 0 : e.type) ? e.type : null;
            const postId = (e === null || e === void 0 ? void 0 : e.postId) ? String(e.postId) : '';
            if (!type || !postId)
                return null;
            const out = {
                type,
                postId,
                sessionHash,
                ownerId: (e === null || e === void 0 ? void 0 : e.ownerId) ? String(e.ownerId) : undefined,
                dwellMs: typeof (e === null || e === void 0 ? void 0 : e.dwellMs) === 'number' && e.dwellMs > 0 ? Math.min(e.dwellMs, 3600000) : undefined,
                completion: typeof (e === null || e === void 0 ? void 0 : e.completion) === 'number' ? Math.max(0, Math.min(1, e.completion)) : undefined,
            };
            return out;
        })
            .filter(Boolean);
        await (0, substrate_1.logPostEvents)(events);
        res.status(200).json({ ok: true, accepted: events.length });
    }
    catch (e) {
        console.error('[blypPostEvent] error', e === null || e === void 0 ? void 0 : e.message);
        res.status(500).json({ error: 'event_failed' });
    }
});
//# sourceMappingURL=handlers.js.map