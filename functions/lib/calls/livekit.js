"use strict";
/**
 * LiveKit audio-call token mint + incoming-call push.
 *
 * Env (Functions):
 *   LIVEKIT_URL          e.g. wss://xxx.livekit.cloud
 *   LIVEKIT_API_KEY
 *   LIVEKIT_API_SECRET
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
exports.onCallCreate = exports.mintLiveKitToken = void 0;
const functions = __importStar(require("firebase-functions"));
const livekit_server_sdk_1 = require("livekit-server-sdk");
const firebaseAdmin_1 = require("../firebaseAdmin");
const cors_1 = require("../http/cors");
const outbox_1 = require("../notifications/outbox");
const sender_1 = require("../notifications/sender");
(0, firebaseAdmin_1.initFirebaseAdmin)();
function livekitConfig() {
    var _a, _b, _c, _d, _e, _f;
    const url = String(process.env.LIVEKIT_URL || ((_b = (_a = functions.config()) === null || _a === void 0 ? void 0 : _a.livekit) === null || _b === void 0 ? void 0 : _b.url) || '').trim();
    const apiKey = String(process.env.LIVEKIT_API_KEY || ((_d = (_c = functions.config()) === null || _c === void 0 ? void 0 : _c.livekit) === null || _d === void 0 ? void 0 : _d.api_key) || '').trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || ((_f = (_e = functions.config()) === null || _e === void 0 ? void 0 : _e.livekit) === null || _f === void 0 ? void 0 : _f.api_secret) || '').trim();
    return { url, apiKey, apiSecret };
}
async function verifyBearerUid(req) {
    const authHeader = String(req.get('Authorization') || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    if (!idToken)
        return null;
    try {
        const decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(idToken);
        return String((decoded === null || decoded === void 0 ? void 0 : decoded.uid) || '').trim() || null;
    }
    catch (_a) {
        return null;
    }
}
/**
 * POST /mintLiveKitToken
 * body: { callId }
 * auth: Bearer Firebase ID token
 */
exports.mintLiveKitToken = functions.https.onRequest(async (req, res) => {
    var _a;
    (0, cors_1.applyCors)(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, reason: 'method-not-allowed' });
        return;
    }
    const uid = await verifyBearerUid(req);
    if (!uid) {
        res.status(401).json({ ok: false, reason: 'unauthenticated' });
        return;
    }
    const { url, apiKey, apiSecret } = livekitConfig();
    if (!url || !apiKey || !apiSecret) {
        res.status(503).json({ ok: false, reason: 'livekit-not-configured' });
        return;
    }
    const callId = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.callId) || '').trim();
    if (!callId) {
        res.status(400).json({ ok: false, reason: 'missing-callId' });
        return;
    }
    try {
        const snap = await firebaseAdmin_1.admin.firestore().collection('calls').doc(callId).get();
        if (!snap.exists) {
            res.status(404).json({ ok: false, reason: 'call-not-found' });
            return;
        }
        const call = snap.data() || {};
        const participants = Array.isArray(call.participants)
            ? call.participants.map((p) => String(p))
            : [];
        if (!participants.includes(uid)) {
            res.status(403).json({ ok: false, reason: 'not-participant' });
            return;
        }
        const status = String(call.status || '');
        if (status === 'ended' || status === 'declined' || status === 'missed') {
            res.status(409).json({ ok: false, reason: 'call-closed' });
            return;
        }
        const roomName = String(call.livekitRoom || callId);
        const at = new livekit_server_sdk_1.AccessToken(apiKey, apiSecret, {
            identity: uid,
            ttl: '2h',
            name: uid,
        });
        at.addGrant({
            roomJoin: true,
            room: roomName,
            canPublish: true,
            canSubscribe: true,
            canPublishData: true,
        });
        const token = await at.toJwt();
        res.status(200).json({
            ok: true,
            token,
            url,
            room: roomName,
            identity: uid,
        });
    }
    catch (e) {
        console.error('[mintLiveKitToken]', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        res.status(500).json({ ok: false, reason: 'mint-failed' });
    }
});
/**
 * When a call doc is created with status=ringing, push the callee.
 */
exports.onCallCreate = functions.firestore
    .document('calls/{callId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const call = snap.data() || {};
    const callId = String(context.params.callId || snap.id || '');
    const status = String(call.status || '');
    if (status !== 'ringing')
        return null;
    const callerId = String(call.callerId || '').trim();
    const calleeId = String(call.calleeId || '').trim();
    if (!callId || !callerId || !calleeId || callerId === calleeId)
        return null;
    const callerName = String(call.callerName || '').trim() || 'Someone';
    const payload = {
        title: 'Incoming call',
        body: `${callerName} is calling…`,
        collapseKey: `call:${callId}`,
        data: {
            type: 'incoming_call',
            callId,
            callerId,
            callerName,
            conversationId: String(call.conversationId || ''),
        },
    };
    try {
        // Latency-critical: send FCM directly. Outbox is for chat/marketing.
        const sent = await (0, sender_1.sendToUser)(calleeId, payload);
        if (sent.deviceCount === 0 || sent.successCount === 0) {
            // Fallback enqueue so a later dispatcher retry can still wake the device.
            await (0, outbox_1.enqueueNotification)({
                userId: calleeId,
                type: 'call',
                title: payload.title,
                body: payload.body,
                dedupeKey: `call:${callId}:${calleeId}`,
                collapseKey: payload.collapseKey,
                data: payload.data,
            });
        }
    }
    catch (e) {
        console.warn('[onCallCreate] direct FCM failed; enqueue fallback', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        try {
            await (0, outbox_1.enqueueNotification)({
                userId: calleeId,
                type: 'call',
                title: payload.title,
                body: payload.body,
                dedupeKey: `call:${callId}:${calleeId}`,
                collapseKey: payload.collapseKey,
                data: payload.data,
            });
        }
        catch (e2) {
            console.warn('[onCallCreate] enqueue failed', (e2 === null || e2 === void 0 ? void 0 : e2.message) || String(e2));
        }
    }
    return null;
});
//# sourceMappingURL=livekit.js.map