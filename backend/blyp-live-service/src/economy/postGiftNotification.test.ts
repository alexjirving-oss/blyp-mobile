import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildPostGiftNotification,
  isPostGiftPushEnabled,
  pickPostGiftSenderName,
  postGiftBlockReason,
} from './postGiftNotification';

describe('post gift notifications', () => {
  const senderUid = '96b24294-6051-70bb-3f4c-a40185e033cf';
  const ownerUid = '7a733285-30a5-70c2-8b7f-2c4f73a174bf';

  it('uses a public username and never exposes a Cognito uid', () => {
    assert.equal(
      pickPostGiftSenderName(senderUid, { username: '@melody' }),
      'melody',
    );
    assert.equal(
      pickPostGiftSenderName(
        senderUid,
        { username: senderUid },
        { displayName: 'Melody Creator' },
      ),
      'Melody Creator',
    );
    assert.equal(
      pickPostGiftSenderName(senderUid, {
        username: senderUid,
        displayName: '11111111-2222-3333-4444-555555555555',
      }),
      'Someone',
    );
  });

  it('builds video copy and deduplicates by giftEventId', () => {
    const input = {
      giftEventId: 'gift-event-123',
      senderUserId: senderUid,
      contentOwnerUserId: ownerUid,
      postId: 'post-456',
      senderName: 'melody',
      giftId: 'heart',
      giftName: 'Heart',
      quantity: 2,
      coinSpent: 10,
      post: {
        type: 'video',
        title: 'Sunset at the beach',
        videoUrl: 'https://example.invalid/video.mp4',
      },
      pushEnabled: true,
      now: 1_700_000_000_000,
    };

    const first = buildPostGiftNotification(input);
    const replay = buildPostGiftNotification(input);
    const nextGift = buildPostGiftNotification({ ...input, giftEventId: 'gift-event-124' });

    assert.equal(first.id, replay.id);
    assert.notEqual(first.id, nextGift.id);
    assert.equal(first.dedupeKey, `post_gift:gift-event-123:${ownerUid}`);
    assert.equal(first.doc.title, 'melody gifted your video');
    assert.equal(first.doc.body, '2× Heart · 10 coins on “Sunset at the beach”');
    assert.equal(first.doc.status, 'queued');
    assert.equal(first.doc.data.actorUsername, 'melody');
    assert.equal(first.doc.data.postId, 'post-456');
    assert.equal(first.doc.data.giftEventId, 'gift-event-123');
    assert.ok(!first.doc.title.includes(senderUid));
    assert.ok(!first.doc.body.includes(senderUid));
  });

  it('keeps an inbox row but disables push when preferences opt out', () => {
    assert.equal(isPostGiftPushEnabled({ notificationPreferences: { gifts: false } }), false);
    assert.equal(isPostGiftPushEnabled({ notifications: { gifts: true } }), true);

    const built = buildPostGiftNotification({
      giftEventId: 'gift-no-push',
      senderUserId: senderUid,
      contentOwnerUserId: ownerUid,
      postId: 'post-no-push',
      senderName: 'melody',
      giftId: 'diamond',
      giftName: 'Diamond',
      quantity: 1,
      coinSpent: 25,
      post: { caption: 'A photo post' },
      pushEnabled: false,
      now: 1_700_000_000_001,
    });

    assert.equal(built.doc.status, 'no_device');
    assert.equal(built.doc.lastError, 'push_preference_disabled');
    assert.equal(built.doc.title, 'melody gifted your post');
  });

  it('suppresses delivery when either user has blocked the other', () => {
    assert.equal(postGiftBlockReason(false, false), null);
    assert.equal(postGiftBlockReason(true, false), 'blocked');
    assert.equal(postGiftBlockReason(false, true), 'blocked');
  });
});
