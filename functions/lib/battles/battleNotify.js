"use strict";
/**
 * Battle notifications — invites, accept/reject/cancel, supporter broadcast, and
 * viewer reminders. All delivery rides the shared outbox + dispatcher + FCM spine
 * (idempotent via dedupeKey, durable, retried), so it works with the app closed.
 *
 *  - onBattleCreate     : push the invite to the opponent.
 *  - onBattleStatusChange: accept/reject/cancel notices + one-shot supporter fan-out.
 *  - onBattleReminderCreate: turn a viewer's "remind me" into a scheduled push.
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
exports.onBattleReminderCreate = exports.onBattleStatusChange = exports.onBattleCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("../notifications/outbox");
const ENQUEUE_CHUNK = 50;
const MAX_FOLLOWERS_FANOUT = 5000;
async function resolveName(uid) {
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
    return 'Someone';
}
function whenLabel(ms) {
    try {
        const d = new Date(ms);
        return d.toLocaleString('en-GB', {
            weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
        });
    }
    catch (_a) {
        return 'soon';
    }
}
/** Fan a notice out to a host's followers, chunked and idempotent per recipient. */
async function fanOutToFollowers(hostUid, battleId, title, body) {
    const db = firebaseAdmin_1.admin.firestore();
    let snap;
    try {
        snap = await db.collection('users').doc(hostUid).collection('followers').limit(MAX_FOLLOWERS_FANOUT).get();
    }
    catch (_a) {
        return 0;
    }
    const ids = snap.docs.map((d) => d.id).filter((id) => id && id !== hostUid);
    let enqueued = 0;
    for (let i = 0; i < ids.length; i += ENQUEUE_CHUNK) {
        const chunk = ids.slice(i, i + ENQUEUE_CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(chunk.map((uid) => (0, outbox_1.enqueueNotification)({
            userId: uid,
            type: 'battle',
            title,
            body,
            dedupeKey: `battle_scheduled:${battleId}:${uid}`,
            collapseKey: `battle_scheduled:${battleId}`,
            data: { type: 'battle_scheduled', battleId },
        }).catch(() => false)));
        enqueued += results.filter(Boolean).length;
    }
    return enqueued;
}
/** Fan battle-live notices to users who opted in via eventWatches. */
async function fanOutToBattleWatchers(battleId, title, body, excludeUids = []) {
    const db = firebaseAdmin_1.admin.firestore();
    let snap;
    try {
        snap = await db
            .collection('eventWatches')
            .where('type', '==', 'battle')
            .limit(MAX_FOLLOWERS_FANOUT)
            .get();
    }
    catch (_a) {
        return 0;
    }
    const exclude = new Set(excludeUids.filter(Boolean));
    const ids = snap.docs
        .map((d) => { var _a, _b; return ({ uid: String(((_a = d.data()) === null || _a === void 0 ? void 0 : _a.watcherUid) || ''), active: (_b = d.data()) === null || _b === void 0 ? void 0 : _b.active }); })
        .filter((row) => row.uid && row.active !== false && !exclude.has(row.uid))
        .map((row) => row.uid);
    let enqueued = 0;
    for (let i = 0; i < ids.length; i += ENQUEUE_CHUNK) {
        const chunk = ids.slice(i, i + ENQUEUE_CHUNK);
        // eslint-disable-next-line no-await-in-loop
        const results = await Promise.all(chunk.map((uid) => (0, outbox_1.enqueueNotification)({
            userId: uid,
            type: 'battle',
            title,
            body,
            dedupeKey: `battle_live_watch:${battleId}:${uid}`,
            collapseKey: `battle_live:${battleId}`,
            data: { type: 'battle_live', battleId },
        }).catch(() => false)));
        enqueued += results.filter(Boolean).length;
    }
    return enqueued;
}
/** One-shot guard so supporter fan-out can't fire twice for the same battle. */
async function claimSupporterFanout(battleId) {
    const db = firebaseAdmin_1.admin.firestore();
    const ref = db.collection('battles').doc(battleId);
    try {
        return await db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (!snap.exists)
                return false;
            const d = snap.data();
            if (d.supportersNotifiedAt)
                return false;
            tx.update(ref, { supportersNotifiedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp() });
            return true;
        });
    }
    catch (_a) {
        return false;
    }
}
exports.onBattleCreate = functions.firestore
    .document('battles/{battleId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const b = snap.data();
    if (!b || b.status !== 'pending' || !b.opponentUid)
        return null;
    const creatorName = b.creatorName || (await resolveName(b.creatorUid));
    const stakeNote = Number(b.stakeCoins) > 0 ? ` (${b.stakeCoins} coin battle)` : '';
    await (0, outbox_1.enqueueNotification)({
        userId: b.opponentUid,
        type: 'battle',
        title: `${creatorName} challenged you to a battle`,
        body: `Tap to accept or decline${stakeNote}`,
        dedupeKey: `battle_invite:${context.params.battleId}`,
        collapseKey: `battle_invite:${context.params.battleId}`,
        data: { type: 'battle_invite', battleId: context.params.battleId },
    });
    return null;
});
exports.onBattleStatusChange = functions.firestore
    .document('battles/{battleId}')
    .onUpdate(async (change, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const battleId = context.params.battleId;
    if (before.status === after.status)
        return null;
    // Accepted -> notify creator + (optionally) fan out to both fanbases.
    if (before.status === 'pending' && after.status === 'scheduled') {
        const opponentName = after.opponentName || (await resolveName(after.opponentUid));
        await (0, outbox_1.enqueueNotification)({
            userId: after.creatorUid,
            type: 'battle',
            title: `${opponentName} accepted your battle`,
            body: `Battle ${whenLabel(Number(after.scheduledStartAt))} UTC`,
            dedupeKey: `battle_accepted:${battleId}`,
            collapseKey: `battle:${battleId}`,
            data: { type: 'battle', battleId },
        });
        if (after.notifySupporters !== false) {
            const claimed = await claimSupporterFanout(battleId);
            if (claimed) {
                const title = `${after.creatorName} vs ${after.opponentName}`;
                const body = `Battle ${whenLabel(Number(after.scheduledStartAt))} UTC — tap to set a reminder`;
                await fanOutToFollowers(after.creatorUid, battleId, title, body);
                await fanOutToFollowers(after.opponentUid, battleId, title, body);
            }
        }
        return null;
    }
    // Declined -> notify creator.
    if (before.status === 'pending' && after.status === 'rejected') {
        const opponentName = after.opponentName || (await resolveName(after.opponentUid));
        await (0, outbox_1.enqueueNotification)({
            userId: after.creatorUid,
            type: 'battle',
            title: `${opponentName} declined your battle`,
            body: 'Try challenging someone else.',
            dedupeKey: `battle_rejected:${battleId}`,
            collapseKey: `battle:${battleId}`,
            data: { type: 'battle', battleId },
        });
        return null;
    }
    // Cancelled -> notify the other participant.
    if ((before.status === 'pending' || before.status === 'scheduled') && after.status === 'cancelled') {
        // Notify both participants; idempotent dedupe keys keep it clean.
        const title = 'Battle cancelled';
        const body = `${after.creatorName} vs ${after.opponentName} was called off.`;
        await Promise.all([
            (0, outbox_1.enqueueNotification)({
                userId: after.creatorUid, type: 'battle', title, body,
                dedupeKey: `battle_cancelled:${battleId}:${after.creatorUid}`,
                collapseKey: `battle:${battleId}`, data: { type: 'battle', battleId },
            }).catch(() => false),
            (0, outbox_1.enqueueNotification)({
                userId: after.opponentUid, type: 'battle', title, body,
                dedupeKey: `battle_cancelled:${battleId}:${after.opponentUid}`,
                collapseKey: `battle:${battleId}`, data: { type: 'battle', battleId },
            }).catch(() => false),
        ]);
        return null;
    }
    // Went live -> nudge both participants (viewers are covered by their reminders).
    if (before.status !== 'live' && after.status === 'live') {
        const title = 'Your battle is live';
        const body = `${after.creatorName} vs ${after.opponentName}`;
        await Promise.all([
            (0, outbox_1.enqueueNotification)({
                userId: after.creatorUid, type: 'battle', title, body,
                dedupeKey: `battle_live:${battleId}:${after.creatorUid}`,
                collapseKey: `battle_live:${battleId}`, data: { type: 'battle', battleId },
            }).catch(() => false),
            (0, outbox_1.enqueueNotification)({
                userId: after.opponentUid, type: 'battle', title, body,
                dedupeKey: `battle_live:${battleId}:${after.opponentUid}`,
                collapseKey: `battle_live:${battleId}`, data: { type: 'battle', battleId },
            }).catch(() => false),
        ]);
        await fanOutToBattleWatchers(battleId, 'A battle is live on Blyp', body, [after.creatorUid, after.opponentUid]);
        return null;
    }
    return null;
});
/**
 * A viewer opted into a reminder: schedule a push for `leadMinutes` before the
 * battle starts using the outbox's future-delivery (sendAfter). Idempotent.
 */
exports.onBattleReminderCreate = functions.firestore
    .document('battles/{battleId}/reminders/{reminderUid}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const r = snap.data() || {};
    const battleId = context.params.battleId;
    const uid = context.params.reminderUid;
    const db = firebaseAdmin_1.admin.firestore();
    const battleSnap = await db.collection('battles').doc(battleId).get();
    const b = battleSnap.data() || {};
    const startAt = Number(b.scheduledStartAt || r.scheduledStartAt || 0);
    if (!startAt)
        return null;
    const lead = Math.max(0, Math.round(Number(r.leadMinutes) || 0));
    const sendAfter = startAt - lead * 60 * 1000;
    const label = b.title || `${b.creatorName || 'A creator'} vs ${b.opponentName || 'an opponent'}`;
    await (0, outbox_1.enqueueNotification)({
        userId: uid,
        type: 'battle',
        title: lead > 0 ? `Battle starts soon` : `Battle starting now`,
        body: `${label} — tap to watch`,
        dedupeKey: `battle_remind:${battleId}:${uid}:${lead}`,
        collapseKey: `battle_remind:${battleId}`,
        sendAfter: Math.max(sendAfter, Date.now()),
        data: { type: 'battle_start', battleId },
    });
    return null;
});
//# sourceMappingURL=battleNotify.js.map