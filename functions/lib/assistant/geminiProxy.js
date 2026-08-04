"use strict";
/**
 * geminiProxy — authenticated AI relay for the mobile client (P7.4).
 *
 * Keeps provider API keys server-side. Client still posts Gemini-shaped
 * generateContent bodies; responses stay Gemini-shaped so parsers are unchanged.
 *
 * Primary: OpenAI (OPENAI_API_KEY / BLYP_OPENAI_API_KEY)
 * Backup:  Gemini when OpenAI is missing or fails
 *
 * POST (Bearer Firebase ID token)
 *   ?model=<allowlisted gemini model>  (used only for Gemini backup path)
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
    var _a;
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
    catch (_b) {
        res.status(401).json({ error: { message: 'unauthenticated' } });
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
    // --- Primary: OpenAI ---
    if ((0, openaiFallback_1.hasOpenAiFallback)()) {
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
            const backup = await callGemini(body, model, geminiKey);
            if (backup.status >= 200 && backup.status < 300) {
                send(backup.status, backup.body, 'gemini');
                return;
            }
            // Prefer returning OpenAI's error (billing/quota) when both fail.
            send(primary.status || backup.status, primary.body || backup.body, 'openai');
            return;
        }
        send(primary.status, primary.body, 'openai');
        return;
    }
    // --- No OpenAI key: Gemini only ---
    if (!geminiKey) {
        res.status(503).json({ error: { message: 'ai_unavailable' } });
        return;
    }
    const gemini = await callGemini(body, model, geminiKey);
    send(gemini.status, gemini.body, 'gemini');
});
//# sourceMappingURL=geminiProxy.js.map