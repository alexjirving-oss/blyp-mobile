"use strict";
/**
 * Dispatcher — the heartbeat of the notification spine.
 *
 * Two paths share one core (`claimAndSend`):
 *   1. notificationOnCreate — a Firestore onCreate trigger that fires the instant
 *      an outbox doc is written and sends immediately (this is what makes pushes
 *      feel near-instant instead of waiting up to a minute).
 *   2. notificationDispatch — a scheduled safety net (every minute) that retries
 *      backed-off docs, recovers claims stuck in `sending`, and reports what it
 *      still owes via a heartbeat.
 *
 * For each due notification the core:
 *   1. claims the doc transactionally (queued -> sending) so neither path nor two
 *      concurrent runs can ever double-send the same record;
 *   2. sends via FCM;
 *   3. finalizes to sent / queued+backoff / dead / no_device — every outcome is
 *      written back, nothing is dropped silently.
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
exports.notificationDispatch = exports.notificationOnCreate = void 0;
exports.claimAndSend = claimAndSend;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const sender_1 = require("./sender");
const topicPreferences_1 = require("./topicPreferences");
const types_1 = require("./types");
const MAX_PER_RUN = 200;
const OVERDUE_MS = 120000; // a queued doc this far past its sendAfter is "owed and unmet"
const STALE_SENDING_MS = 120000; // a doc stuck in `sending` this long is presumed abandoned
const DISPATCH_CONCURRENCY = 15; // bounded parallelism per scheduled run
/**
 * Claim a single notification and attempt delivery. Safe to call from both the
 * onCreate trigger and the scheduled sweep — the transactional claim guarantees
 * exactly one caller ever owns a given doc.
 */
async function claimAndSend(db, ref) {
    var _a, _b;
    let claimed = null;
    try {
        claimed = await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists)
                return null;
            const d = fresh.data();
            if (d.status !== 'queued' || d.sendAfter > Date.now())
                return null;
            tx.update(ref, {
                status: 'sending',
                attempts: (d.attempts || 0) + 1,
                sendingSince: Date.now(),
            });
            return Object.assign(Object.assign({}, d), { attempts: (d.attempts || 0) + 1 });
        });
    }
    catch (e) {
        // Contention or transient — leave it queued for the next run.
        return 'skipped';
    }
    if (!claimed)
        return 'skipped';
    try {
        // Re-check topic/global preferences immediately before FCM. The event fan-out
        // checks too, but this closes the opt-out race for delayed/retried sends.
        if (claimed.type === 'topic' || ((_a = claimed.data) === null || _a === void 0 ? void 0 : _a.type) === 'topic_event') {
            const decision = await (0, topicPreferences_1.getTopicNotificationDecision)(db, claimed.userId, String(((_b = claimed.data) === null || _b === void 0 ? void 0 : _b.topicId) || ''));
            if (!decision.allowed) {
                await ref.update({
                    status: 'suppressed',
                    lastError: `notification_preference_${decision.reason}`,
                    sendingSince: firebaseAdmin_1.admin.firestore.FieldValue.delete(),
                });
                return 'suppressed';
            }
        }
        const result = await (0, sender_1.sendToUser)(claimed.userId, {
            title: claimed.title,
            body: claimed.body,
            data: claimed.data,
            collapseKey: claimed.collapseKey,
        });
        if (result.deviceCount === 0) {
            // No device yet — keep it as a durable inbox/catch-up item, don't burn retries.
            await ref.update({
                status: 'no_device',
                lastError: 'no_registered_device',
                sendingSince: firebaseAdmin_1.admin.firestore.FieldValue.delete(),
            });
            return 'no_device';
        }
        if (result.successCount > 0) {
            await ref.update({
                status: 'sent',
                sentAt: Date.now(),
                deliveredDeviceCount: result.successCount,
                lastError: firebaseAdmin_1.admin.firestore.FieldValue.delete(),
                sendingSince: firebaseAdmin_1.admin.firestore.FieldValue.delete(),
            });
            return 'sent';
        }
        // All sends failed.
        await finalizeFailure(ref, claimed, 'all_devices_failed', result.retriable);
        return claimed.attempts >= claimed.maxAttempts || !result.retriable ? 'dead' : 'retried';
    }
    catch (e) {
        await finalizeFailure(ref, claimed, (e === null || e === void 0 ? void 0 : e.message) || String(e), true);
        return claimed.attempts >= claimed.maxAttempts ? 'dead' : 'retried';
    }
}
/**
 * Immediate path: send the moment the outbox doc is created. minInstances keeps
 * one instance warm so there's no cold start on the critical path.
 */
exports.notificationOnCreate = functions
    .runWith({ memory: '256MB', timeoutSeconds: 60, minInstances: 1 })
    .firestore.document(`${types_1.NOTIF_COLLECTIONS.notifications}/{notificationId}`)
    .onCreate(async (snap) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const d = snap.data();
    if (!d || d.status !== 'queued')
        return null;
    // Scheduled-for-later notifications (sendAfter in the future) are left for the
    // cron sweep so they don't fire early.
    if ((d.sendAfter || 0) > Date.now())
        return null;
    const db = firebaseAdmin_1.admin.firestore();
    try {
        await claimAndSend(db, snap.ref);
    }
    catch (e) {
        console.error('[notificationOnCreate] send failed', e);
    }
    return null;
});
exports.notificationDispatch = functions
    .runWith({ memory: '256MB', timeoutSeconds: 120 })
    .pubsub.schedule('every 1 minutes')
    .onRun(async () => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const col = db.collection(types_1.NOTIF_COLLECTIONS.notifications);
    const now = Date.now();
    // 0) Recover claims abandoned mid-flight (e.g. a crash between claim and
    //    finalize). Without this they'd be stuck in `sending` forever.
    const recovered = await recoverStuckSending(db, col);
    const dueSnap = await col
        .where('status', '==', 'queued')
        .where('sendAfter', '<=', now)
        .orderBy('sendAfter', 'asc')
        .limit(MAX_PER_RUN)
        .get();
    const tally = {
        sent: 0,
        no_device: 0,
        suppressed: 0,
        retried: 0,
        dead: 0,
        skipped: 0,
    };
    // Process with bounded concurrency rather than one-at-a-time, so a backlog
    // drains within a single run instead of bleeding into the next minute.
    const refs = dueSnap.docs.map((d) => d.ref);
    for (let i = 0; i < refs.length; i += DISPATCH_CONCURRENCY) {
        const batch = refs.slice(i, i + DISPATCH_CONCURRENCY);
        const outcomes = await Promise.all(batch.map((ref) => claimAndSend(db, ref)));
        for (const o of outcomes)
            tally[o] += 1;
    }
    const processed = tally.sent + tally.no_device + tally.suppressed + tally.retried + tally.dead;
    // 4) Heartbeat + "owed and unmet" awareness.
    let overdue = 0;
    try {
        const overdueAgg = await col
            .where('status', '==', 'queued')
            .where('sendAfter', '<=', now - OVERDUE_MS)
            .count()
            .get();
        overdue = Number(overdueAgg.data().count || 0);
    }
    catch (_a) {
        overdue = -1; // unknown — still recorded, never pretended-zero
    }
    await db
        .collection(types_1.NOTIF_COLLECTIONS.platformState)
        .doc(types_1.DISPATCH_HEARTBEAT_DOC)
        .set({
        lastRunAt: now,
        processed,
        sent: tally.sent,
        retried: tally.retried,
        dead: tally.dead,
        noDevice: tally.no_device,
        suppressed: tally.suppressed,
        recovered,
        overdue,
        candidates: dueSnap.size,
    }, { merge: true });
    console.log(`[notificationDispatch] processed=${processed} sent=${tally.sent} retried=${tally.retried} dead=${tally.dead} noDevice=${tally.no_device} suppressed=${tally.suppressed} recovered=${recovered} overdue=${overdue}`);
    return null;
});
/**
 * Reset notifications stuck in `sending` past STALE_SENDING_MS back to `queued`
 * so they get another delivery attempt. Uses a single-field `status` query (no
 * composite index needed) and filters the timestamp in code.
 */
async function recoverStuckSending(db, col) {
    let recovered = 0;
    try {
        const stuckSnap = await col.where('status', '==', 'sending').limit(MAX_PER_RUN).get();
        const cutoff = Date.now() - STALE_SENDING_MS;
        for (const ds of stuckSnap.docs) {
            const d = ds.data();
            if ((d.sendingSince || 0) > cutoff)
                continue; // recently claimed; still in flight
            try {
                await db.runTransaction(async (tx) => {
                    const fresh = await tx.get(ds.ref);
                    if (!fresh.exists)
                        return;
                    const f = fresh.data();
                    if (f.status !== 'sending')
                        return;
                    if ((f.sendingSince || 0) > Date.now() - STALE_SENDING_MS)
                        return;
                    tx.update(ds.ref, {
                        status: 'queued',
                        sendAfter: Date.now(),
                        sendingSince: firebaseAdmin_1.admin.firestore.FieldValue.delete(),
                    });
                });
                recovered += 1;
            }
            catch (_a) {
                // contention — next run will catch it
            }
        }
    }
    catch (e) {
        console.warn('[notificationDispatch] recoverStuckSending failed', e);
    }
    return recovered;
}
async function finalizeFailure(ref, claimed, error, retriable) {
    const exhausted = claimed.attempts >= claimed.maxAttempts || !retriable;
    if (exhausted) {
        await ref.update({
            status: 'dead',
            lastError: error,
            sendingSince: firebaseAdmin_1.admin.firestore.FieldValue.delete(),
        });
        return;
    }
    const next = Date.now() + (0, types_1.backoffMs)(claimed.attempts);
    await ref.update({
        status: 'queued',
        sendAfter: next,
        nextAttemptAt: next,
        lastError: error,
        sendingSince: firebaseAdmin_1.admin.firestore.FieldValue.delete(),
    });
}
//# sourceMappingURL=dispatcher.js.map