"use strict";
/**
 * Global + per-person notification preferences.
 *
 * Precedence (first match wins):
 *   1. Master push off (new settings or legacy profile flags) → deny
 *   2. Per-person override for the notification actor:
 *        mode "everything" → allow (topics still need topic opt-in)
 *        mode "nothing"    → deny
 *        mode "custom"     → explicit category bool if set, else fall through
 *   3. Global category toggle (defaults below when unset)
 *   4. Topic events additionally require users/{uid}/topicNotifications/{topicId}
 *
 * Per-person beats global wherever an override is set. Missing docs = defaults
 * (non-spammy: core chat/live/calls on; streak/social/dating off).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPushNotificationDecision = exports.decidePushNotification = exports.resolveNotificationCategory = exports.extractActorUid = exports.normalizeOverrideMode = exports.isNotificationCategory = exports.DEFAULT_CATEGORY_ENABLED = exports.NOTIFICATION_CATEGORIES = exports.NOTIFICATION_OVERRIDES_SUBCOLLECTION = exports.NOTIFICATION_SETTINGS_SUBCOLLECTION = exports.NOTIFICATION_SETTINGS_DOC = void 0;
const topicPreferences_1 = require("./topicPreferences");
exports.NOTIFICATION_SETTINGS_DOC = 'global';
exports.NOTIFICATION_SETTINGS_SUBCOLLECTION = 'notificationSettings';
exports.NOTIFICATION_OVERRIDES_SUBCOLLECTION = 'notificationOverrides';
exports.NOTIFICATION_CATEGORIES = [
    'live',
    'message',
    'battle',
    'team',
    'call',
    'gift',
    'presence',
    'streak',
    'system',
    'topic',
    'follow',
    'social',
    'dating',
];
/** Non-spammy defaults: important social on, marketing-ish / future off. */
exports.DEFAULT_CATEGORY_ENABLED = {
    live: true,
    message: true,
    battle: true,
    team: true,
    call: true,
    gift: true,
    presence: true,
    streak: false,
    system: true,
    topic: true,
    follow: false,
    social: false,
    dating: false,
};
const ACTOR_DATA_KEYS = [
    'actorId',
    'actorUid',
    'hostId',
    'senderId',
    'callerId',
    'fromUid',
    'requesterId',
    'gifterId',
];
function isNotificationCategory(value) {
    return typeof value === 'string' && exports.NOTIFICATION_CATEGORIES.includes(value);
}
exports.isNotificationCategory = isNotificationCategory;
function normalizeOverrideMode(value) {
    if (value === 'everything' || value === 'nothing' || value === 'custom')
        return value;
    return 'custom';
}
exports.normalizeOverrideMode = normalizeOverrideMode;
function extractActorUid(data) {
    if (!data || typeof data !== 'object')
        return null;
    for (const key of ACTOR_DATA_KEYS) {
        const raw = String(data[key] || '').trim();
        if (raw && !raw.includes('/'))
            return raw;
    }
    return null;
}
exports.extractActorUid = extractActorUid;
/**
 * Map outbox type + data.type / kind onto a preference category.
 */
function resolveNotificationCategory(type, data) {
    const dataType = String((data === null || data === void 0 ? void 0 : data.type) || '').trim().toLowerCase();
    const kind = String((data === null || data === void 0 ? void 0 : data.kind) || '').trim().toLowerCase();
    const combined = `${dataType}|${kind}`;
    if (dataType === 'incoming_call' ||
        type === 'call' ||
        dataType === 'call') {
        return 'call';
    }
    if (dataType === 'post_gift' ||
        combined.includes('gift') ||
        dataType === 'gift') {
        return 'gift';
    }
    if (dataType === 'presence' || kind === 'presence') {
        return 'presence';
    }
    if (type === 'streak' || dataType === 'streak') {
        return 'streak';
    }
    if (type === 'topic' ||
        dataType === 'topic_event' ||
        dataType === 'topic') {
        return 'topic';
    }
    if (type === 'system' ||
        dataType === 'admin' ||
        dataType === 'tour' ||
        dataType === 'system') {
        return 'system';
    }
    if (type === 'message' || dataType === 'message' || dataType === 'dm') {
        return 'message';
    }
    if (type === 'battle' ||
        dataType.startsWith('battle') ||
        kind.startsWith('battle') ||
        kind === 'team_battle') {
        return 'battle';
    }
    if (type === 'team' ||
        dataType === 'team' ||
        dataType.startsWith('audition') ||
        kind.startsWith('audition') ||
        kind === 'join_request' ||
        kind === 'join_decision' ||
        kind === 'group_message' ||
        kind === 'team_warning') {
        return 'team';
    }
    if (type === 'live' ||
        dataType === 'live' ||
        dataType === 'guest_invite' ||
        dataType === 'live_start') {
        return 'live';
    }
    if (dataType === 'follow' || kind === 'follow') {
        return 'follow';
    }
    if (dataType === 'comment' ||
        dataType === 'like' ||
        dataType === 'social' ||
        kind === 'comment' ||
        kind === 'like') {
        return 'social';
    }
    if (dataType === 'dating' || kind === 'dating' || type === 'dating') {
        return 'dating';
    }
    if (type === 'activity') {
        return 'gift';
    }
    if (type === 'reminder') {
        return 'system';
    }
    return 'system';
}
exports.resolveNotificationCategory = resolveNotificationCategory;
function readExplicitBool(map, category) {
    if (!map || typeof map !== 'object')
        return undefined;
    const value = map[category];
    if (value === true)
        return true;
    if (value === false)
        return false;
    return undefined;
}
function isMasterPushDisabled(settings, ...profiles) {
    if (settings && settings.pushEnabled === false)
        return true;
    return (0, topicPreferences_1.isGlobalNotificationMuted)(...profiles);
}
/**
 * Pure decision given already-loaded docs. Used by the dispatcher and unit tests.
 */
function decidePushNotification(input) {
    var _a;
    const userId = String(input.userId || '').trim();
    if (!userId || userId.includes('/')) {
        return { allowed: false, reason: 'invalid', category: null, actorUid: null };
    }
    const category = resolveNotificationCategory(input.type, input.data);
    const actorUid = extractActorUid(input.data);
    if (isMasterPushDisabled(input.settings, ...(input.profiles || []))) {
        return { allowed: false, reason: 'master_muted', category, actorUid };
    }
    const override = input.override;
    if (override && actorUid && String(override.targetUid || actorUid) === actorUid) {
        const mode = normalizeOverrideMode(override.mode);
        if (mode === 'everything') {
            // Topic events still require an explicit topic opt-in.
            if (category === 'topic' && input.topicOptInEnabled !== true) {
                return { allowed: false, reason: 'topic_disabled', category, actorUid };
            }
            return { allowed: true, reason: 'allowed', category, actorUid };
        }
        if (mode === 'nothing') {
            return { allowed: false, reason: 'person_nothing', category, actorUid };
        }
        const personCat = readExplicitBool(override.categories, category);
        if (personCat === false) {
            return { allowed: false, reason: 'person_category_off', category, actorUid };
        }
        if (personCat === true) {
            if (category === 'topic' && input.topicOptInEnabled !== true) {
                return { allowed: false, reason: 'topic_disabled', category, actorUid };
            }
            return { allowed: true, reason: 'allowed', category, actorUid };
        }
        // custom with unset category → fall through to global
    }
    const globalCat = readExplicitBool((_a = input.settings) === null || _a === void 0 ? void 0 : _a.categories, category);
    const enabled = globalCat === undefined ? exports.DEFAULT_CATEGORY_ENABLED[category] === true : globalCat === true;
    if (!enabled) {
        return { allowed: false, reason: 'global_category_off', category, actorUid };
    }
    if (category === 'topic' && input.topicOptInEnabled !== true) {
        return { allowed: false, reason: 'topic_disabled', category, actorUid };
    }
    return { allowed: true, reason: 'allowed', category, actorUid };
}
exports.decidePushNotification = decidePushNotification;
async function loadTopicOptIn(db, userId, topicIdValue) {
    const topicId = String(topicIdValue || '').trim().toLowerCase();
    if (!topicId || !/^[a-z0-9_-]{1,64}$/.test(topicId))
        return false;
    const snap = await db
        .collection('users')
        .doc(userId)
        .collection('topicNotifications')
        .doc(topicId)
        .get();
    if (!snap.exists)
        return false;
    const data = snap.data();
    return ((data === null || data === void 0 ? void 0 : data.enabled) === true &&
        String((data === null || data === void 0 ? void 0 : data.topicId) || '').toLowerCase() === topicId &&
        String((data === null || data === void 0 ? void 0 : data.userId) || '') === userId);
}
/**
 * Authoritative check immediately before FCM (and for direct call sends).
 */
async function getPushNotificationDecision(db, input) {
    var _a;
    const userId = String(input.userId || '').trim();
    if (!userId || userId.includes('/')) {
        return { allowed: false, reason: 'invalid', category: null, actorUid: null };
    }
    const category = resolveNotificationCategory(input.type, input.data);
    const actorUid = extractActorUid(input.data);
    const userRef = db.collection('users').doc(userId);
    const settingsRef = userRef
        .collection(exports.NOTIFICATION_SETTINGS_SUBCOLLECTION)
        .doc(exports.NOTIFICATION_SETTINGS_DOC);
    const profileRef = db.collection('userProfiles').doc(userId);
    const refs = [settingsRef, userRef, profileRef];
    let overrideRef = null;
    if (actorUid && actorUid !== userId) {
        overrideRef = userRef.collection(exports.NOTIFICATION_OVERRIDES_SUBCOLLECTION).doc(actorUid);
        refs.push(overrideRef);
    }
    const snaps = await db.getAll(...refs);
    const settingsSnap = snaps[0];
    const userSnap = snaps[1];
    const profileSnap = snaps[2];
    const overrideSnap = overrideRef ? snaps[3] : null;
    const settings = settingsSnap.data() || null;
    const override = (overrideSnap === null || overrideSnap === void 0 ? void 0 : overrideSnap.exists)
        ? (overrideSnap.data() || null)
        : null;
    let topicOptInEnabled = null;
    if (category === 'topic') {
        topicOptInEnabled = await loadTopicOptIn(db, userId, String(((_a = input.data) === null || _a === void 0 ? void 0 : _a.topicId) || ''));
    }
    return decidePushNotification({
        userId,
        type: input.type,
        data: input.data,
        settings,
        override: override && actorUid
            ? Object.assign(Object.assign({}, override), { targetUid: String(override.targetUid || actorUid) }) : null,
        profiles: [
            userSnap.data() || {},
            profileSnap.data() || {},
        ],
        topicOptInEnabled,
    });
}
exports.getPushNotificationDecision = getPushNotificationDecision;
//# sourceMappingURL=userNotificationPreferences.js.map