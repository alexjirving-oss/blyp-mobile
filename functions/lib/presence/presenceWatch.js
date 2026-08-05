"use strict";
/**
 * Presence watches — "notify me when <person> is next on the app".
 *
 * The client stamps users/{uid}.presence = { state: 'online'|'offline', lastSeenAt }
 * on foreground/background. We fire on the offline->online transition and notify
 * anyone who opted in via a `userWatches` doc (key = `<uid>__online`). Watches are
 * one-shot: notify, then deactivate.
 *
 * A scheduled sweep marks stale sessions offline (covers hard kills where the app
 * never wrote 'offline'), so a later open registers as a real transition.
 *
 * Delivery rides the same outbox + dispatcher + FCM spine as everything else.
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
exports.presenceOfflineSweep = exports.onUserPresenceOnline = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("../notifications/outbox");
const ENQUEUE_CHUNK = 50;
const STALE_MS = 5 * 60 * 1000; // a session quiet for 5+ minutes counts as offline
const SWEEP_LIMIT = 400;
async function resolveUserName(uid) {
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const u = await db.collection('users').doc(uid).get();
        const d = u.data() || {};
        const name = d.displayName || d.username || d.name;
        if (name)
            return String(name);
    }
    catch (_a) {
        // fall through
    }
    try {
        const p = await db.collection('userProfiles').doc(uid).get();
        const d = p.data() || {};
        const name = d.displayName || d.username || d.name;
        if (name)
            return String(name);
    }
    catch (_b) {
        // fall through
    }
    return 'Someone';
}
async function notifyOnlineWatchers(targetUid, transitionId) {
    const db = firebaseAdmin_1.admin.firestore();
    let snap;
    try {
        snap = await db.collection('userWatches').where('key', '==', `${targetUid}__online`).get();
    }
    catch (e) {
        console.warn('[presenceWatch] watch query failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return;
    }
    const watches = snap.docs.filter((d) => { var _a; return ((_a = d.data()) === null || _a === void 0 ? void 0 : _a.active) !== false; });
    if (watches.length === 0)
        return;
    const name = await resolveUserName(targetUid);
    const title = `${name} is on Blyp`;
    const body = 'Tap to open their profile';
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
                type: 'activity',
                title,
                body,
                // Deterministic per online transition so retries dedupe but a later
                // re-watch + new transition can fire again.
                dedupeKey: `presence:${targetUid}:${watcherUid}:${transitionId}`,
                collapseKey: `presence:${targetUid}`,
                data: { type: 'presence', targetId: targetUid, targetName: name },
            }).catch(() => false);
        }));
        enqueued += results.filter(Boolean).length;
        // eslint-disable-next-line no-await-in-loop
        const batch = db.batch();
        chunk.forEach((doc) => batch.update(doc.ref, { active: false, firedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp() }));
        // eslint-disable-next-line no-await-in-loop
        await batch.commit().catch(() => { });
    }
    console.log(`[presenceWatch] ${targetUid} online: notified ${enqueued} watchers`);
}
/** Fire when a user's presence flips offline -> online. */
exports.onUserPresenceOnline = functions.firestore
    .document('users/{uid}')
    .onUpdate(async (change, context) => {
    var _a, _b, _c;
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const wasOnline = ((_a = before === null || before === void 0 ? void 0 : before.presence) === null || _a === void 0 ? void 0 : _a.state) === 'online';
    const isOnline = ((_b = after === null || after === void 0 ? void 0 : after.presence) === null || _b === void 0 ? void 0 : _b.state) === 'online';
    if (wasOnline || !isOnline)
        return null; // only the offline->online edge
    const transitionId = ((_c = after === null || after === void 0 ? void 0 : after.presence) === null || _c === void 0 ? void 0 : _c.lastSeenAt) || Date.now();
    await notifyOnlineWatchers(context.params.uid, transitionId);
    return null;
});
/**
 * Mark stale 'online' sessions offline so the next foreground is a real
 * transition the trigger above can act on. Runs frequently and is cheap.
 */
exports.presenceOfflineSweep = functions.pubsub
    .schedule('every 5 minutes')
    .onRun(async () => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const cutoff = Date.now() - STALE_MS;
    try {
        const snap = await db
            .collection('users')
            .where('presence.lastSeenAt', '<', cutoff)
            .limit(SWEEP_LIMIT)
            .get();
        const stale = snap.docs.filter((d) => { var _a, _b; return ((_b = (_a = d.data()) === null || _a === void 0 ? void 0 : _a.presence) === null || _b === void 0 ? void 0 : _b.state) === 'online'; });
        if (stale.length === 0) {
            return null;
        }
        const batch = db.batch();
        stale.forEach((d) => batch.update(d.ref, { 'presence.state': 'offline' }));
        await batch.commit();
        console.log(`[presenceWatch] swept ${stale.length} stale sessions offline`);
    }
    catch (e) {
        console.warn('[presenceWatch] sweep failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    return null;
});
//# sourceMappingURL=presenceWatch.js.map