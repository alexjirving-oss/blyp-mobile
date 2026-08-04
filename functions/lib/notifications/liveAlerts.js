"use strict";
/**
 * Live alerts — the spine's first real payload.
 *
 * When a stream transitions into `live`, fan a "someone you follow is live" push
 * out to the host's followers. This is the lowest-stakes, highest-intent trigger
 * (the data already exists) and proves the pipe under real load before anything
 * appointment-critical rides on it.
 *
 * Safety:
 *  - Fires at most once per stream (guarded by a transactional `liveAlertSentAt`
 *    stamp on the stream doc).
 *  - Each recipient enqueue is idempotent via dedupeKey `live:<streamId>:<uid>`,
 *    so even a retried trigger can't double-notify.
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
exports.onLiveStreamGoLive = exports.onLiveStreamCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("./outbox");
const MAX_FOLLOWERS_FANOUT = 5000;
const ENQUEUE_CHUNK = 50;
async function resolveHostName(hostUid) {
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const u = await db.collection('users').doc(hostUid).get();
        const d = u.data() || {};
        const name = d.displayName || d.username || d.name;
        if (name)
            return String(name);
    }
    catch (_a) {
        // fall through
    }
    try {
        const p = await db.collection('userProfiles').doc(hostUid).get();
        const d = p.data() || {};
        const name = d.displayName || d.username || d.name;
        if (name)
            return String(name);
    }
    catch (_b) {
        // fall through
    }
    return 'Someone you follow';
}
async function claimLiveAlert(streamId) {
    const db = firebaseAdmin_1.admin.firestore();
    const ref = db.collection('liveStreams').doc(streamId);
    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                return false;
            const d = snap.data();
            if (d.liveAlertSentAt)
                return false; // already fanned out
            tx.update(ref, { liveAlertSentAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp() });
            return true;
        });
    }
    catch (_a) {
        return false;
    }
}
/**
 * Per-user opt-in: anyone who asked "notify me when <host> is next live" via the
 * blyp bar. These are one-shot — we notify, then deactivate the watch so it
 * doesn't fire on the host's next stream.
 */
async function notifyLiveWatchers(hostUid, streamId, title, body) {
    const db = firebaseAdmin_1.admin.firestore();
    let snap;
    try {
        snap = await db.collection('userWatches').where('key', '==', `${hostUid}__live`).get();
    }
    catch (e) {
        console.warn('[liveAlerts] watch query failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return;
    }
    const watches = snap.docs.filter((d) => { var _a; return ((_a = d.data()) === null || _a === void 0 ? void 0 : _a.active) !== false; });
    if (watches.length === 0)
        return;
    let enqueued = 0;
    for (let i = 0; i < watches.length; i += ENQUEUE_CHUNK) {
        const chunk = watches.slice(i, i + ENQUEUE_CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(chunk.map((doc) => {
            const w = doc.data();
            const watcherUid = String((w === null || w === void 0 ? void 0 : w.watcherUid) || '').trim();
            if (!watcherUid)
                return Promise.resolve(false);
            return (0, outbox_1.enqueueNotification)({
                userId: watcherUid,
                type: 'live',
                title,
                body,
                dedupeKey: `livewatch:${streamId}:${watcherUid}`,
                collapseKey: `livewatch:${streamId}`,
                data: { type: 'live', streamId, hostId: hostUid },
            }).catch(() => false);
        }));
        enqueued += results.filter(Boolean).length;
        // Deactivate this chunk's watches (one-shot).
        // eslint-disable-next-line no-await-in-loop
        const batch = db.batch();
        chunk.forEach((doc) => batch.update(doc.ref, { active: false, firedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp() }));
        // eslint-disable-next-line no-await-in-loop
        await batch.commit().catch(() => { });
    }
    console.log(`[liveAlerts] stream ${streamId}: notified ${enqueued} live-watchers`);
}
async function fanOutLiveAlert(streamId, stream) {
    const hostUid = String((stream === null || stream === void 0 ? void 0 : stream.userId) || '').trim();
    if (!hostUid)
        return;
    // One-shot guard.
    const shouldFire = await claimLiveAlert(streamId);
    if (!shouldFire)
        return;
    const db = firebaseAdmin_1.admin.firestore();
    const hostName = await resolveHostName(hostUid);
    const title = `${hostName} is live`;
    const body = String((stream === null || stream === void 0 ? void 0 : stream.title) || '').trim() || 'Tap to watch now';
    // Opt-in watchers first — they asked specifically for this host, and should be
    // notified even if the host has no followers.
    await notifyLiveWatchers(hostUid, streamId, title, body);
    const followersSnap = await db
        .collection('users')
        .doc(hostUid)
        .collection('followers')
        .limit(MAX_FOLLOWERS_FANOUT)
        .get();
    const followerIds = followersSnap.docs.map((d) => d.id).filter((id) => id && id !== hostUid);
    if (followerIds.length === 0) {
        console.log(`[liveAlerts] stream ${streamId}: host has no followers`);
        return;
    }
    let enqueued = 0;
    for (let i = 0; i < followerIds.length; i += ENQUEUE_CHUNK) {
        const chunk = followerIds.slice(i, i + ENQUEUE_CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(chunk.map((uid) => (0, outbox_1.enqueueNotification)({
            userId: uid,
            type: 'live',
            title,
            body,
            dedupeKey: `live:${streamId}:${uid}`,
            collapseKey: `live:${streamId}`,
            data: { type: 'live', streamId, hostId: hostUid },
        }).catch(() => false)));
        enqueued += results.filter(Boolean).length;
    }
    console.log(`[liveAlerts] stream ${streamId}: enqueued ${enqueued}/${followerIds.length} alerts`);
}
exports.onLiveStreamCreate = functions.firestore
    .document('liveStreams/{streamId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const stream = snap.data();
    if ((stream === null || stream === void 0 ? void 0 : stream.status) === 'live') {
        await fanOutLiveAlert(context.params.streamId, stream);
    }
    return null;
});
exports.onLiveStreamGoLive = functions.firestore
    .document('liveStreams/{streamId}')
    .onUpdate(async (change, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const before = change.before.data();
    const after = change.after.data();
    if ((before === null || before === void 0 ? void 0 : before.status) !== 'live' && (after === null || after === void 0 ? void 0 : after.status) === 'live') {
        await fanOutLiveAlert(context.params.streamId, after);
    }
    return null;
});
//# sourceMappingURL=liveAlerts.js.map