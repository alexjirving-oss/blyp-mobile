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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCallCreate = exports.mintLiveKitToken = void 0;
const functions = __importStar(require("firebase-functions"));
const livekit_server_sdk_1 = require("livekit-server-sdk");
const firebaseAdmin_1 = require("../firebaseAdmin");
const cors_1 = require("../http/cors");
const outbox_1 = require("../notifications/outbox");
const sender_1 = require("../notifications/sender");
const userNotificationPreferences_1 = require("../notifications/userNotificationPreferences");
(0, firebaseAdmin_1.initFirebaseAdmin)();
function livekitConfig() {
    var _a, _b, _c, _d, _e, _f;
    const url = String(process.env.LIVEKIT_URL || ((_b = (_a = functions.config()) === null || _a === void 0 ? void 0 : _a.livekit) === null || _b === void 0 ? void 0 : _b.url) || '').trim();
    const apiKey = String(process.env.LIVEKIT_API_KEY || ((_d = (_c = functions.config()) === null || _c === void 0 ? void 0 : _c.livekit) === null || _d === void 0 ? void 0 : _d.api_key) || '').trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || ((_f = (_e = functions.config()) === null || _e === void 0 ? void 0 : _e.livekit) === null || _f === void 0 ? void 0 : _f.api_secret) || '').trim();
    return { url, apiKey, apiSecret };
}
async function mintForIdentity(identity, roomName) {
    const { url, apiKey, apiSecret } = livekitConfig();
    if (!url || !apiKey || !apiSecret)
        return null;
    const at = new livekit_server_sdk_1.AccessToken(apiKey, apiSecret, {
        identity,
        ttl: '2h',
        name: identity,
    });
    at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });
    return { token: await at.toJwt(), url, room: roomName };
}
async function pushIncomingCall(opts) {
    const payload = {
        title: 'Incoming call',
        body: `${opts.callerName} is calling…`,
        collapseKey: `call:${opts.callId}`,
        data: Object.assign(Object.assign({ type: 'incoming_call', callId: opts.callId, callerId: opts.callerId, callerName: opts.callerName, conversationId: String(opts.conversationId || '') }, (opts.livekitUrl ? { livekitUrl: opts.livekitUrl } : {})), (opts.livekitToken ? { livekitToken: opts.livekitToken } : {})),
    };
    // Direct FCM must honor the same prefs as the outbox dispatcher (master /
    // category / per-person). Do not enqueue when prefs deny — retries must not
    // resurrect a muted call alert.
    try {
        const db = firebaseAdmin_1.admin.firestore();
        const decision = await (0, userNotificationPreferences_1.getPushNotificationDecision)(db, {
            userId: opts.calleeId,
            type: 'call',
            data: payload.data,
        });
        if (!decision.allowed) {
            console.info('[calls] incoming call suppressed', decision.reason, opts.calleeId.slice(0, 8));
            return;
        }
    }
    catch (prefErr) {
        console.warn('[calls] preference check failed; refusing call push', (prefErr === null || prefErr === void 0 ? void 0 : prefErr.message) || String(prefErr));
        return;
    }
    try {
        const sent = await (0, sender_1.sendToUser)(opts.calleeId, payload);
        if (sent.deviceCount === 0 || sent.successCount === 0) {
            await (0, outbox_1.enqueueNotification)({
                userId: opts.calleeId,
                type: 'call',
                title: payload.title,
                body: payload.body,
                dedupeKey: `call:${opts.callId}:${opts.calleeId}`,
                collapseKey: payload.collapseKey,
                data: payload.data,
            });
        }
    }
    catch (e) {
        console.warn('[calls] FCM failed; enqueue fallback', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        try {
            await (0, outbox_1.enqueueNotification)({
                userId: opts.calleeId,
                type: 'call',
                title: payload.title,
                body: payload.body,
                dedupeKey: `call:${opts.callId}:${opts.calleeId}`,
                collapseKey: payload.collapseKey,
                data: payload.data,
            });
        }
        catch (e2) {
            console.warn('[calls] enqueue failed', (e2 === null || e2 === void 0 ? void 0 : e2.message) || String(e2));
        }
    }
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
    var _a, _b;
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
        console.error('[mintLiveKitToken] LIVEKIT_* missing', {
            hasUrl: Boolean(url),
            hasKey: Boolean(apiKey),
            hasSecret: Boolean(apiSecret),
        });
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
        const minted = await mintForIdentity(uid, roomName);
        if (!minted) {
            res.status(503).json({ ok: false, reason: 'livekit-not-configured' });
            return;
        }
        const notifyCallee = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.notifyCallee) === true;
        if (notifyCallee) {
            const calleeId = String(call.calleeId || '').trim();
            if (calleeId && calleeId !== uid) {
                const calleeMint = await mintForIdentity(calleeId, roomName);
                void pushIncomingCall({
                    calleeId,
                    callId,
                    callerId: String(call.callerId || uid),
                    callerName: String(call.callerName || '').trim() || 'Someone',
                    conversationId: String(call.conversationId || ''),
                    livekitUrl: calleeMint === null || calleeMint === void 0 ? void 0 : calleeMint.url,
                    livekitToken: calleeMint === null || calleeMint === void 0 ? void 0 : calleeMint.token,
                });
            }
        }
        res.status(200).json({
            ok: true,
            token: minted.token,
            url: minted.url,
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
    const roomName = String(call.livekitRoom || callId);
    const calleeMint = await mintForIdentity(calleeId, roomName);
    await pushIncomingCall({
        calleeId,
        callId,
        callerId,
        callerName,
        conversationId: String(call.conversationId || ''),
        livekitUrl: calleeMint === null || calleeMint === void 0 ? void 0 : calleeMint.url,
        livekitToken: calleeMint === null || calleeMint === void 0 ? void 0 : calleeMint.token,
    });
    return null;
});
//# sourceMappingURL=livekit.js.map