"use strict";
/**
 * Pure unit checks for notification preference precedence.
 * Run after build: node lib/notifications/userNotificationPreferences.test.js
 * Or: npx tsc && node lib/notifications/userNotificationPreferences.test.js
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const userNotificationPreferences_1 = require("./userNotificationPreferences");
function run() {
    assert_1.default.strictEqual((0, userNotificationPreferences_1.resolveNotificationCategory)('live', { type: 'live' }), 'live');
    assert_1.default.strictEqual((0, userNotificationPreferences_1.resolveNotificationCategory)('activity', { type: 'post_gift' }), 'gift');
    assert_1.default.strictEqual((0, userNotificationPreferences_1.resolveNotificationCategory)('call', { type: 'incoming_call', callerId: 'a' }), 'call');
    assert_1.default.strictEqual((0, userNotificationPreferences_1.extractActorUid)({ hostId: 'host1', senderId: 's1' }), 'host1');
    // Defaults allow live
    let d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'live',
        data: { type: 'live', hostId: 'them' },
    });
    assert_1.default.strictEqual(d.allowed, true);
    assert_1.default.strictEqual(d.reason, 'allowed');
    // Global live off
    d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'live',
        data: { type: 'live', hostId: 'them' },
        settings: { pushEnabled: true, categories: { live: false } },
    });
    assert_1.default.strictEqual(d.allowed, false);
    assert_1.default.strictEqual(d.reason, 'global_category_off');
    // Per-person everything beats global live off
    d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'live',
        data: { type: 'live', hostId: 'them' },
        settings: { pushEnabled: true, categories: { live: false } },
        override: { targetUid: 'them', mode: 'everything' },
    });
    assert_1.default.strictEqual(d.allowed, true);
    // Per-person nothing beats global on
    d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'message',
        data: { type: 'message', senderId: 'them' },
        settings: { pushEnabled: true, categories: { message: true } },
        override: { targetUid: 'them', mode: 'nothing' },
    });
    assert_1.default.strictEqual(d.allowed, false);
    assert_1.default.strictEqual(d.reason, 'person_nothing');
    // Master mute beats everything preset
    d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'live',
        data: { type: 'live', hostId: 'them' },
        settings: { pushEnabled: false },
        override: { targetUid: 'them', mode: 'everything' },
    });
    assert_1.default.strictEqual(d.allowed, false);
    assert_1.default.strictEqual(d.reason, 'master_muted');
    // Custom person category
    d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'live',
        data: { type: 'live', hostId: 'them' },
        settings: { pushEnabled: true, categories: { live: false } },
        override: { targetUid: 'them', mode: 'custom', categories: { live: true } },
    });
    assert_1.default.strictEqual(d.allowed, true);
    // Topic still needs opt-in even when category on
    d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'topic',
        data: { type: 'topic_event', topicId: 'football' },
        settings: { pushEnabled: true, categories: { topic: true } },
        topicOptInEnabled: false,
    });
    assert_1.default.strictEqual(d.allowed, false);
    assert_1.default.strictEqual(d.reason, 'topic_disabled');
    d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'topic',
        data: { type: 'topic_event', topicId: 'football' },
        settings: { pushEnabled: true, categories: { topic: true } },
        topicOptInEnabled: true,
    });
    assert_1.default.strictEqual(d.allowed, true);
    // Streak default off
    assert_1.default.strictEqual(userNotificationPreferences_1.DEFAULT_CATEGORY_ENABLED.streak, false);
    d = (0, userNotificationPreferences_1.decidePushNotification)({
        userId: 'me',
        type: 'streak',
        data: { type: 'streak' },
    });
    assert_1.default.strictEqual(d.allowed, false);
    assert_1.default.strictEqual(d.reason, 'global_category_off');
    console.log('userNotificationPreferences.test: ok');
}
const isMain = typeof require !== 'undefined' &&
    typeof module !== 'undefined' &&
    require.main === module;
if (isMain) {
    run();
}
//# sourceMappingURL=userNotificationPreferences.test.js.map