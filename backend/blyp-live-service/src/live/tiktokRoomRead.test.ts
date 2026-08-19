import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  mapTikTokRoomPayload,
  normalizeTikTokUniqueId,
  validateTikTokUniqueId,
} from './tiktokRoomRead';

describe('normalizeTikTokUniqueId', () => {
  it('strips @ and profile URLs', () => {
    assert.equal(normalizeTikTokUniqueId('@MelodyLive'), 'MelodyLive');
    assert.equal(
      normalizeTikTokUniqueId('https://www.tiktok.com/@melody.live/live'),
      'melody.live',
    );
  });
});

describe('validateTikTokUniqueId', () => {
  it('accepts typical handles', () => {
    const ok = validateTikTokUniqueId('tv_asahi_news');
    assert.equal(ok.ok, true);
  });

  it('rejects junk', () => {
    const bad = validateTikTokUniqueId('no spaces');
    assert.equal(bad.ok, false);
  });
});

describe('mapTikTokRoomPayload', () => {
  it('maps bundled chat + gift events and webcast content field', () => {
    const events = mapTikTokRoomPayload({
      messages: [
        {
          type: 'WebcastChatMessage',
          data: {
            comment: 'hello from tiktok',
            user: { uniqueId: 'alice', nickname: 'Alice' },
            msgId: '1',
          },
        },
        {
          event: 'gift',
          giftName: 'Rose',
          repeatCount: 3,
          user: { uniqueId: 'bob', nickname: 'Bob' },
          msgId: '2',
        },
      ],
    });
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, 'chat');
    assert.equal(events[0].text, 'hello from tiktok');
    assert.equal(events[0].displayName, 'Alice');
    assert.equal(events[1].kind, 'gift');
    assert.equal(events[1].text, 'sent Rose ×3');

    const live = mapTikTokRoomPayload({
      content: 'yo',
      user: { displayId: 'carol', nickname: 'Carol' },
    });
    assert.equal(live[0]?.text, 'yo');
    assert.equal(live[0]?.uniqueId, 'carol');
  });
});
