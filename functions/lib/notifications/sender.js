"use strict";
/**
 * Sender — turns a notification into real device pushes via FCM.
 *
 * Reads the recipient's registered devices (users/{uid}/devices/*), sends a
 * multicast, and prunes tokens FCM reports as permanently invalid so the
 * registry self-heals. Returns a structured result so the dispatcher can decide
 * sent / retry / dead — it never swallows outcomes (the "never silent" rule).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendToUser = void 0;
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("./types");
const PERMANENT_TOKEN_ERRORS = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);
async function loadDevices(userId) {
    const db = firebaseAdmin_1.admin.firestore();
    const snap = await db
        .collection('users')
        .doc(userId)
        .collection(types_1.NOTIF_COLLECTIONS.devicesSub)
        .get();
    const rows = [];
    for (const d of snap.docs) {
        const data = d.data();
        const token = String((data === null || data === void 0 ? void 0 : data.pushToken) || (data === null || data === void 0 ? void 0 : data.token) || '').trim();
        if (token && (data === null || data === void 0 ? void 0 : data.disabled) !== true) {
            rows.push({ ref: d.ref, token });
        }
    }
    return rows;
}
async function sendToUser(userId, payload) {
    const devices = await loadDevices(userId);
    if (devices.length === 0) {
        return { deviceCount: 0, successCount: 0, failureCount: 0, prunedTokens: 0, retriable: false };
    }
    const tokens = devices.map((d) => d.token);
    const message = {
        tokens,
        notification: { title: payload.title, body: payload.body },
        data: payload.data || {},
        android: {
            priority: 'high',
            collapseKey: payload.collapseKey,
            notification: {
                channelId: 'blyp',
                // Resource in android/.../res/raw/blyp_notify.wav (filename, no extension).
                sound: 'blyp_notify',
            },
        },
        apns: {
            headers: Object.assign({ 
                // Priority 10 = deliver immediately as a user-visible alert (the
                // default of 5 lets iOS coalesce/delay for power, which reads as "slow").
                'apns-priority': '10', 'apns-push-type': 'alert' }, (payload.collapseKey ? { 'apns-collapse-id': payload.collapseKey } : {})),
            payload: { aps: { sound: 'blyp_notify.wav' } },
        },
    };
    const resp = await firebaseAdmin_1.admin.messaging().sendEachForMulticast(message);
    let pruned = 0;
    let transientFailures = 0;
    const prunePromises = [];
    resp.responses.forEach((r, i) => {
        var _a;
        if (r.success)
            return;
        const code = ((_a = r.error) === null || _a === void 0 ? void 0 : _a.code) || '';
        if (PERMANENT_TOKEN_ERRORS.has(code)) {
            pruned += 1;
            prunePromises.push(devices[i].ref.delete().catch(() => undefined));
        }
        else {
            transientFailures += 1;
        }
    });
    if (prunePromises.length)
        await Promise.all(prunePromises);
    return {
        deviceCount: tokens.length,
        successCount: resp.successCount,
        failureCount: resp.failureCount,
        prunedTokens: pruned,
        // Retriable only if nothing succeeded AND at least one failure was transient.
        retriable: resp.successCount === 0 && transientFailures > 0,
    };
}
exports.sendToUser = sendToUser;
//# sourceMappingURL=sender.js.map