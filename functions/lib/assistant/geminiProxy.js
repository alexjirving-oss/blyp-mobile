"use strict";
/**
 * geminiProxy — authenticated AI relay for the mobile client (P7.4).
 *
 * Keeps provider API keys server-side. Client still posts Gemini-shaped
 * generateContent bodies; responses stay Gemini-shaped so parsers are unchanged.
 *
 * Primary: OpenAI for text/image (OPENAI_API_KEY / BLYP_OPENAI_API_KEY)
 * Audio/STT: Gemini first, then OpenAI Whisper on 429/quota/upstream failure
 * Backup: Gemini when OpenAI text/image path is missing or fails
 *
 * POST (Bearer Firebase ID token)
 *   ?model=<allowlisted gemini model>  (used only for Gemini path)
 *   body: { contents, generationConfig, ... }
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiProxy = void 0;
const functions = __importStar(require("firebase-functions"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const cors_1 = require("../http/cors");
const openaiFallback_1 = require("./openaiFallback");
const entitlement_1 = require("./entitlement");
(0, firebaseAdmin_1.initFirebaseAdmin)();
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const ALLOWED_MODELS = new Set([
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-pro-latest',
]);
const DEFAULT_MODEL = 'gemini-flash-latest';
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 120;
function resolveModel(raw) {
    const m = String(raw || '').replace(/^models\//, '').trim();
    return ALLOWED_MODELS.has(m) ? m : DEFAULT_MODEL;
}
async function checkRateLimit(uid) {
    const db = firebaseAdmin_1.admin.firestore();
    const ref = db.collection('geminiProxyUsage').doc(uid);
    const now = Date.now();
    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const d = snap.data() || {};
            const windowStart = Number(d.windowStart || 0);
            const count = Number(d.count || 0);
            if (now - windowStart > RATE_WINDOW_MS) {
                tx.set(ref, { windowStart: now, count: 1 }, { merge: true });
                return true;
            }
            if (count >= RATE_MAX)
                return false;
            tx.set(ref, { count: count + 1 }, { merge: true });
            return true;
        });
    }
    catch (_a) {
        return true;
    }
}
async function callGemini(body, model, geminiKey) {
    const url = `${GEMINI_BASE}/models/${model}:generateContent?key=${geminiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
        const upstream = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify(body),
        }).finally(() => clearTimeout(timer));
        const text = await upstream.text();
        return { status: upstream.status, body: text };
    }
    catch (e) {
        console.warn('[geminiProxy] Gemini request error', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return {
            status: 502,
            body: JSON.stringify({ error: { message: 'gemini_upstream_error' } }),
        };
    }
}
exports.geminiProxy = functions
    .runWith({
    memory: '512MB',
    timeoutSeconds: 60,
    // Injected from Secret Manager when set via `firebase functions:secrets:set`.
    secrets: ['OPENAI_API_KEY'],
})
    .https.onRequest(async (req, res) => {
    var _a, _b, _c, _d, _e;
    (0, cors_1.applyCors)(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: { message: 'method_not_allowed' } });
        return;
    }
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    let uid = '';
    try {
        if (!idToken)
            throw new Error('missing-token');
        const decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
    }
    catch (_f) {
        res.status(401).json({ error: { message: 'unauthenticated' } });
        return;
    }
    // Premium / active-trial gate (server-authoritative). Missing docs get the
    // same 30-day trial bootstrap the mobile client expects so AI doesn't look
    // "disappeared" for brand-new accounts.
    let sub = await (0, entitlement_1.getSubscriptionState)(uid);
    if (!sub.active) {
        sub = await (0, entitlement_1.ensureTrialIfMissing)(uid);
    }
    if (!sub.active) {
        res.status(402).json({ error: { message: 'subscription_required' } });
        return;
    }
    const allowed = await checkRateLimit(uid);
    if (!allowed) {
        res.status(429).json({ error: { message: 'rate_limited' } });
        return;
    }
    const geminiKey = process.env.GEMINI_API_KEY || process.env.BLYP_GEMINI_API_KEY || '';
    const body = (req.body && typeof req.body === 'object') ? Object.assign({}, req.body) : {};
    const model = resolveModel((_a = req.query.model) !== null && _a !== void 0 ? _a : body.model);
    delete body.model;
    if (!Array.isArray(body.contents) || body.contents.length === 0) {
        res.status(400).json({ error: { message: 'missing_contents' } });
        return;
    }
    const send = (status, payload, provider) => {
        res.status(status);
        res.set('Content-Type', 'application/json');
        res.set('X-Blyp-AI-Provider', provider);
        res.send(payload);
    };
    // OpenAI for text/image. Audio uses Gemini first, then Whisper on 429/quota
    // (chat.completions cannot consume Gemini audio parts — Whisper can).
    if ((0, openaiFallback_1.canUseOpenAiForBody)(body)) {
        const primary = await (0, openaiFallback_1.callOpenAiAsGemini)(body);
        if (primary.status >= 200 && primary.status < 300) {
            send(200, primary.body, 'openai');
            return;
        }
        console.warn('[geminiProxy] OpenAI primary failed; trying Gemini backup', {
            uid,
            status: primary.status,
            snippet: String(primary.body || '').slice(0, 160),
        });
        if (geminiKey) {
            // Prefer text-only backup when OpenAI emptied on vision — large inline
            // images often make Gemini fail the same way (or exceed free-tier limits).
            const primaryEmpty = String(primary.body || '').includes('openai_empty');
            const backupBodies = primaryEmpty
                ? [(0, openaiFallback_1.stripInlineMediaFromGeminiBody)(body), body]
                : [body];
            for (const backupBody of backupBodies) {
                const backup = await callGemini(backupBody, model, geminiKey);
                if (backup.status >= 200 && backup.status < 300) {
                    send(backup.status, backup.body, 'gemini');
                    return;
                }
                console.warn('[geminiProxy] Gemini backup failed', {
                    uid,
                    status: backup.status,
                    textOnly: !!((_e = (_d = (_c = (_b = backupBody === null || backupBody === void 0 ? void 0 : backupBody.contents) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d.every) === null || _e === void 0 ? void 0 : _e.call(_d, (p) => !((p === null || p === void 0 ? void 0 : p.inlineData) || (p === null || p === void 0 ? void 0 : p.inline_data)))),
                    snippet: String(backup.body || '').slice(0, 160),
                });
            }
            send(primary.status, primary.body, 'openai');
            return;
        }
        send(primary.status, primary.body, 'openai');
        return;
    }
    const isAudio = (0, openaiFallback_1.bodyContainsAudio)(body);
    if (isAudio) {
        console.log('[geminiProxy] audio payload — Gemini STT, Whisper on failure', {
            uid,
            model,
            hasGemini: !!geminiKey,
            hasOpenAi: (0, openaiFallback_1.hasOpenAiFallback)(),
        });
    }
    if (geminiKey) {
        const gemini = await callGemini(body, model, geminiKey);
        if (gemini.status >= 200 && gemini.status < 300) {
            send(gemini.status, gemini.body, 'gemini');
            return;
        }
        // Push-to-describe: Gemini free-tier often 429s on audio. Fall to Whisper.
        if (isAudio &&
            (0, openaiFallback_1.hasOpenAiFallback)() &&
            (0, openaiFallback_1.shouldUseOpenAiFallback)(gemini.status, gemini.body)) {
            console.warn('[geminiProxy] Gemini STT failed; trying OpenAI Whisper', {
                uid,
                status: gemini.status,
                snippet: String(gemini.body || '').slice(0, 160),
            });
            const whisper = await (0, openaiFallback_1.callOpenAiWhisperAsGemini)(body);
            if (whisper.status >= 200 && whisper.status < 300) {
                send(200, whisper.body, 'openai-whisper');
                return;
            }
            console.warn('[geminiProxy] Whisper STT also failed', {
                uid,
                status: whisper.status,
                snippet: String(whisper.body || '').slice(0, 160),
            });
        }
        send(gemini.status, gemini.body, 'gemini');
        return;
    }
    // No Gemini key — still try Whisper for voice describe.
    if (isAudio && (0, openaiFallback_1.hasOpenAiFallback)()) {
        const whisper = await (0, openaiFallback_1.callOpenAiWhisperAsGemini)(body);
        send(whisper.status, whisper.body, 'openai-whisper');
        return;
    }
    res.status(503).json({ error: { message: 'ai_unavailable' } });
});
//# sourceMappingURL=geminiProxy.js.map