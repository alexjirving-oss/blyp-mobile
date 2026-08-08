/**
 * Pure unit checks for notification preference precedence.
 * Run after build: node lib/notifications/userNotificationPreferences.test.js
 * Or: npx tsc && node lib/notifications/userNotificationPreferences.test.js
 */

import assert from 'assert';
import {
  decidePushNotification,
  DEFAULT_CATEGORY_ENABLED,
  extractActorUid,
  resolveNotificationCategory,
} from './userNotificationPreferences';

function run() {
  assert.strictEqual(resolveNotificationCategory('live', { type: 'live' }), 'live');
  assert.strictEqual(
    resolveNotificationCategory('activity', { type: 'post_gift' }),
    'gift'
  );
  assert.strictEqual(
    resolveNotificationCategory('call', { type: 'incoming_call', callerId: 'a' }),
    'call'
  );
  assert.strictEqual(extractActorUid({ hostId: 'host1', senderId: 's1' }), 'host1');

  // Defaults allow live
  let d = decidePushNotification({
    userId: 'me',
    type: 'live',
    data: { type: 'live', hostId: 'them' },
  });
  assert.strictEqual(d.allowed, true);
  assert.strictEqual(d.reason, 'allowed');

  // Global live off
  d = decidePushNotification({
    userId: 'me',
    type: 'live',
    data: { type: 'live', hostId: 'them' },
    settings: { pushEnabled: true, categories: { live: false } },
  });
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.reason, 'global_category_off');

  // Per-person everything beats global live off
  d = decidePushNotification({
    userId: 'me',
    type: 'live',
    data: { type: 'live', hostId: 'them' },
    settings: { pushEnabled: true, categories: { live: false } },
    override: { targetUid: 'them', mode: 'everything' },
  });
  assert.strictEqual(d.allowed, true);

  // Per-person nothing beats global on
  d = decidePushNotification({
    userId: 'me',
    type: 'message',
    data: { type: 'message', senderId: 'them' },
    settings: { pushEnabled: true, categories: { message: true } },
    override: { targetUid: 'them', mode: 'nothing' },
  });
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.reason, 'person_nothing');

  // Master mute beats everything preset
  d = decidePushNotification({
    userId: 'me',
    type: 'live',
    data: { type: 'live', hostId: 'them' },
    settings: { pushEnabled: false },
    override: { targetUid: 'them', mode: 'everything' },
  });
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.reason, 'master_muted');

  // Custom person category
  d = decidePushNotification({
    userId: 'me',
    type: 'live',
    data: { type: 'live', hostId: 'them' },
    settings: { pushEnabled: true, categories: { live: false } },
    override: { targetUid: 'them', mode: 'custom', categories: { live: true } },
  });
  assert.strictEqual(d.allowed, true);

  // Topic still needs opt-in even when category on
  d = decidePushNotification({
    userId: 'me',
    type: 'topic',
    data: { type: 'topic_event', topicId: 'football' },
    settings: { pushEnabled: true, categories: { topic: true } },
    topicOptInEnabled: false,
  });
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.reason, 'topic_disabled');

  d = decidePushNotification({
    userId: 'me',
    type: 'topic',
    data: { type: 'topic_event', topicId: 'football' },
    settings: { pushEnabled: true, categories: { topic: true } },
    topicOptInEnabled: true,
  });
  assert.strictEqual(d.allowed, true);

  // Streak default off
  assert.strictEqual(DEFAULT_CATEGORY_ENABLED.streak, false);
  d = decidePushNotification({
    userId: 'me',
    type: 'streak',
    data: { type: 'streak' },
  });
  assert.strictEqual(d.allowed, false);
  assert.strictEqual(d.reason, 'global_category_off');

  console.log('userNotificationPreferences.test: ok');
}

const isMain =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module;

if (isMain) {
  run();
}
