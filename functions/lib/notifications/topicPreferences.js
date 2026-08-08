"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOPIC_NOTIFICATION_SUBCOLLECTION = void 0;
exports.isGlobalNotificationMuted = isGlobalNotificationMuted;
exports.getTopicNotificationDecision = getTopicNotificationDecision;
exports.TOPIC_NOTIFICATION_SUBCOLLECTION = 'topicNotifications';
function hasExplicitFalse(values) {
    return values.some((value) => value === false);
}
/**
 * Honor the current and legacy global preference shapes already written by
 * Blyp clients/services. Missing fields mean enabled; only an explicit false
 * mutes topic delivery.
 */
function isGlobalNotificationMuted(...profiles) {
    var _a, _b, _c;
    for (const profile of profiles) {
        if (!profile || typeof profile !== 'object')
            continue;
        const notificationPreferences = profile.notificationPreferences || {};
        const notificationPrefs = profile.notificationPrefs || {};
        const notifications = profile.notifications || {};
        const nested = ((_b = (_a = profile.blyp) === null || _a === void 0 ? void 0 : _a.prefs) === null || _b === void 0 ? void 0 : _b.notifications) || {};
        const preferences = ((_c = profile.preferences) === null || _c === void 0 ? void 0 : _c.notifications) || {};
        if (hasExplicitFalse([
            profile.notificationsEnabled,
            profile.pushNotificationsEnabled,
            profile.pushNotifications,
            notificationPreferences.enabled,
            notificationPreferences.push,
            notificationPreferences.topics,
            notificationPreferences.sports,
            notificationPrefs.enabled,
            notificationPrefs.push,
            notificationPrefs.topics,
            notificationPrefs.sports,
            notifications.enabled,
            notifications.push,
            notifications.topics,
            notifications.sports,
            nested.enabled,
            nested.push,
            nested.topics,
            nested.sports,
            preferences.enabled,
            preferences.push,
            preferences.topics,
            preferences.sports,
        ])) {
            return true;
        }
    }
    return false;
}
/**
 * Authoritative check immediately before FCM. This closes the race where a
 * user turns a topic off after an event was queued but before a retry sends.
 */
async function getTopicNotificationDecision(db, userIdValue, topicIdValue) {
    const userId = String(userIdValue || '').trim();
    const topicId = String(topicIdValue || '').trim().toLowerCase();
    if (!userId || userId.includes('/') || !/^[a-z0-9_-]{1,64}$/.test(topicId)) {
        return { allowed: false, reason: 'invalid' };
    }
    const userRef = db.collection('users').doc(userId);
    const preferenceRef = userRef.collection(exports.TOPIC_NOTIFICATION_SUBCOLLECTION).doc(topicId);
    const profileRef = db.collection('userProfiles').doc(userId);
    const [preferenceSnap, userSnap, profileSnap] = await db.getAll(preferenceRef, userRef, profileRef);
    const preference = preferenceSnap.data();
    if (!preferenceSnap.exists ||
        (preference === null || preference === void 0 ? void 0 : preference.enabled) !== true ||
        String((preference === null || preference === void 0 ? void 0 : preference.topicId) || '').toLowerCase() !== topicId ||
        String((preference === null || preference === void 0 ? void 0 : preference.userId) || '') !== userId) {
        return { allowed: false, reason: 'topic_disabled' };
    }
    if (isGlobalNotificationMuted(userSnap.data() || {}, profileSnap.data() || {})) {
        return { allowed: false, reason: 'global_muted' };
    }
    return { allowed: true, reason: 'allowed' };
}
//# sourceMappingURL=topicPreferences.js.map