"use strict";
/**
 * blypAssistantCompose — the "Blyp it" endpoint.
 *
 * POST { command? , recipient?, gist?, tone? }  (Bearer Firebase ID token)
 *   -> 200 { ok, draftId, recipientName, messages[], imageUrl, channels[], tone }
 *
 * Order of operations is deliberate (cheapest gate first, never auto-send):
 *   1. authenticate (Firebase ID token; uid == Cognito sub)
 *   2. premium gate (server-side entitlements/{uid}; fails CLOSED)
 *   3. rate limit (cost control)
 *   4. draft text + moderate (refuse unsafe)
 *   5. generate image (best-effort; text-only fallback)
 *   6. persist a durable DRAFT and return it for in-app preview/confirm
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
exports.blypAssistantCompose = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const cors_1 = require("../http/cors");
const entitlement_1 = require("./entitlement");
const gemini_1 = require("./gemini");
const imageGen_1 = require("./imageGen");
const types_1 = require("./types");
(0, firebaseAdmin_1.initFirebaseAdmin)();
async function checkRateLimit(uid) {
    const db = firebaseAdmin_1.admin.firestore();
    const ref = db.collection(types_1.ASSISTANT_COLLECTIONS.usage).doc(uid);
    const now = Date.now();
    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const d = snap.data() || {};
            const windowStart = Number(d.windowStart || 0);
            const count = Number(d.count || 0);
            if (now - windowStart > types_1.RATE_LIMIT_WINDOW_MS) {
                tx.set(ref, { windowStart: now, count: 1 }, { merge: true });
                return true;
            }
            if (count >= types_1.RATE_LIMIT_MAX)
                return false;
            tx.set(ref, { count: count + 1 }, { merge: true });
            return true;
        });
    }
    catch (_a) {
        return true; // never block a paying user on a counter hiccup
    }
}
exports.blypAssistantCompose = functions
    .runWith({ memory: '512MB', timeoutSeconds: 60 })
    .https.onRequest(async (req, res) => {
    (0, cors_1.applyCors)(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, reason: 'method' });
        return;
    }
    // 1) Auth
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    let uid = '';
    try {
        if (!idToken)
            throw new Error('missing-token');
        const decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
    }
    catch (_a) {
        res.status(401).json({ ok: false, reason: 'unauthenticated' });
        return;
    }
    // Premium gate (server-authoritative). Missing entitlement docs get a
    // once-per-account trial bootstrap — never renewed on reinstall/login.
    let sub = await (0, entitlement_1.getSubscriptionState)(uid);
    if (!sub.active) {
        sub = await (0, entitlement_1.ensureTrialIfMissing)(uid, 'compose_bootstrap');
    }
    if (!sub.active) {
        res.status(402).json({ ok: false, reason: 'subscription_required' });
        return;
    }
    // 3) Rate limit
    const allowed = await checkRateLimit(uid);
    if (!allowed) {
        res.status(429).json({ ok: false, reason: 'rate_limited' });
        return;
    }
    // 4) Draft + moderate
    const body = req.body || {};
    const input = {
        command: typeof body.command === 'string' ? body.command : undefined,
        recipient: typeof body.recipient === 'string' ? body.recipient : undefined,
        gist: typeof body.gist === 'string' ? body.gist : undefined,
        tone: typeof body.tone === 'string' ? body.tone : undefined,
    };
    if (!input.command && !input.gist) {
        res.status(400).json({ ok: false, reason: 'empty_request' });
        return;
    }
    const draft = await (0, gemini_1.draftMessage)(input);
    if (!draft) {
        res.status(503).json({ ok: false, reason: 'ai_unavailable' });
        return;
    }
    if (!draft.safe) {
        res.status(422).json({ ok: false, reason: 'unsafe', detail: draft.refusalReason || 'Request declined.' });
        return;
    }
    if (draft.messages.length === 0) {
        res.status(503).json({ ok: false, reason: 'no_draft' });
        return;
    }
    // 5+6) Persist draft, then attach best-effort image.
    const db = firebaseAdmin_1.admin.firestore();
    const now = Date.now();
    const ref = db.collection(types_1.ASSISTANT_COLLECTIONS.drafts).doc();
    const docData = {
        uid,
        recipientHint: draft.recipientName || input.recipient || '',
        messages: draft.messages,
        imagePrompt: draft.imagePrompt,
        imageUrl: null,
        channels: ['dm', 'share'],
        tone: input.tone || 'friendly',
        status: 'draft',
        createdAt: now,
        expiresAt: now + types_1.DRAFT_TTL_MS,
    };
    await ref.set(docData);
    let imageUrl = null;
    if (draft.imagePrompt) {
        imageUrl = await (0, imageGen_1.generateAndStoreImage)(uid, ref.id, draft.imagePrompt);
        if (imageUrl)
            await ref.update({ imageUrl });
    }
    res.status(200).json({
        ok: true,
        draftId: ref.id,
        recipientName: docData.recipientHint,
        messages: docData.messages,
        imageUrl,
        channels: docData.channels,
        tone: docData.tone,
    });
});
//# sourceMappingURL=compose.js.map