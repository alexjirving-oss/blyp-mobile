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
    const rows = [];
    const seen = new Set();
    const collect = (snap) => {
        for (const d of snap.docs) {
            const data = d.data();
            const token = String((data === null || data === void 0 ? void 0 : data.pushToken) || (data === null || data === void 0 ? void 0 : data.token) || '').trim();
            if (!token || (data === null || data === void 0 ? void 0 : data.disabled) === true)
                continue;
            if (seen.has(token))
                continue;
            seen.add(token);
            rows.push({ ref: d.ref, token });
        }
    };
    // Primary: users/{uid}/devices (PushService)
    const devicesSnap = await db
        .collection('users')
        .doc(userId)
        .collection(types_1.NOTIF_COLLECTIONS.devicesSub)
        .get();
    collect(devicesSnap);
    // Fallback: legacy deviceTokens collection (older rules / clients)
    if (rows.length === 0) {
        const legacySnap = await db
            .collection('users')
            .doc(userId)
            .collection('deviceTokens')
            .get();
        collect(legacySnap);
    }
    return rows;
}
async function sendToUser(userId, payload) {
    var _a;
    const devices = await loadDevices(userId);
    if (devices.length === 0) {
        return { deviceCount: 0, successCount: 0, failureCount: 0, prunedTokens: 0, retriable: false };
    }
    const tokens = devices.map((d) => d.token);
    const dataType = String(((_a = payload.data) === null || _a === void 0 ? void 0 : _a.type) || '').toLowerCase();
    const isCall = dataType === 'incoming_call' || dataType === 'call';
    // Incoming calls: data-first + dedicated MAX channel so lock-screen / pocket
    // still rings loudly. Title/body also go in data so our native handler can
    // build a full-screen call notification when the process is awake.
    const data = Object.assign(Object.assign({}, (payload.data || {})), { title: payload.title, body: payload.body });
    const message = isCall
        ? {
            // DATA-ONLY + high priority so Android wakes our MessagingService when
            // the app is backgrounded/killed. A `notification` block would be
            // displayed by the OS without running native code (no full-screen ring).
            tokens,
            data,
            android: {
                priority: 'high',
                ttl: 60 * 1000,
                collapseKey: payload.collapseKey,
            },
            apns: {
                headers: Object.assign({ 'apns-priority': '10', 'apns-push-type': 'alert' }, (payload.collapseKey ? { 'apns-collapse-id': payload.collapseKey } : {})),
                payload: Object.assign({ aps: {
                        alert: { title: payload.title, body: payload.body },
                        sound: 'blyp_notify.wav',
                        'interruption-level': 'time-sensitive',
                        contentAvailable: true,
                    } }, data),
            },
        }
        : {
            tokens,
            notification: { title: payload.title, body: payload.body },
            data,
            android: {
                priority: 'high',
                collapseKey: payload.collapseKey,
                notification: {
                    channelId: 'blyp',
                    sound: 'blyp_notify',
                },
            },
            apns: {
                headers: Object.assign({ 'apns-priority': '10', 'apns-push-type': 'alert' }, (payload.collapseKey ? { 'apns-collapse-id': payload.collapseKey } : {})),
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