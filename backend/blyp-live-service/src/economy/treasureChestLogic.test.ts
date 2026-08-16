import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  baseIdempotencyKey,
  bonusIdempotencyKey,
  buildTreasurePeek,
  findQualifyingVideoPost,
  isUserVerified,
  isVideoPost,
  postCreatedOnUtcDay,
  utcDay,
} from './treasureChestLogic';
import { getTreasureChestAmounts } from './treasureChestConfig';

describe('treasureChestLogic', () => {
  it('uses UTC day keys for once-per-day idempotency', () => {
    assert.equal(utcDay(Date.UTC(2026, 7, 16, 23, 59, 59)), '2026-08-16');
    assert.equal(utcDay(Date.UTC(2026, 7, 17, 0, 0, 0)), '2026-08-17');
    assert.equal(baseIdempotencyKey('u1', '2026-08-16'), 'treasure:base:u1:2026-08-16');
    assert.equal(bonusIdempotencyKey('u1', '2026-08-16'), 'treasure:bonus:u1:2026-08-16');
  });

  it('gates on admin metadata OR Firestore verified flags', () => {
    assert.equal(isUserVerified({}), false);
    assert.equal(
      isUserVerified({ adminMetadata: { verification: { isVerified: true } } }),
      true
    );
    assert.equal(isUserVerified({ firestoreUser: { verified: true } }), true);
    assert.equal(isUserVerified({ firestoreUser: { isVerified: true } }), true);
    assert.equal(
      isUserVerified({ firestoreUser: { verificationStatus: 'verified' } }),
      true
    );
    assert.equal(
      isUserVerified({ firestoreUser: { verificationStatus: 'pending' } }),
      false
    );
  });

  it('requires a video post created on the same UTC day for bonus', () => {
    const day = '2026-08-16';
    const posts = [
      {
        postId: 'p1',
        videoUrl: 'https://cdn.example/a.mp4',
        createdAt: '2026-08-16T12:00:00.000Z',
      },
      {
        postId: 'p2',
        videoUrl: 'https://cdn.example/b.mp4',
        createdAt: '2026-08-15T12:00:00.000Z',
      },
      {
        postId: 'p3',
        mediaUrl: 'https://cdn.example/c.jpg',
        createdAt: '2026-08-16T12:00:00.000Z',
      },
    ];
    assert.equal(postCreatedOnUtcDay('2026-08-16T01:00:00.000Z', day), true);
    assert.equal(isVideoPost(posts[0]), true);
    assert.equal(isVideoPost(posts[2]), false);
    assert.equal(findQualifyingVideoPost(posts, day, null)?.postId, 'p1');
    assert.equal(findQualifyingVideoPost(posts, day, 'p2'), null);
    assert.equal(findQualifyingVideoPost(posts, day, 'p1')?.postId, 'p1');
  });

  it('peek exposes one base + one bonus claimable at most', () => {
    const open = buildTreasurePeek({
      enabled: true,
      verified: true,
      day: '2026-08-16',
      baseCoins: 15,
      bonusCoins: 10,
      baseClaimedToday: false,
      bonusClaimedToday: false,
      hasVideoPostToday: true,
    });
    assert.equal(open.claimableBase, 15);
    assert.equal(open.claimableBonus, 0); // bonus needs base claimed first
    assert.equal(open.bonusEligible, false);

    const afterBase = buildTreasurePeek({
      enabled: true,
      verified: true,
      day: '2026-08-16',
      baseCoins: 15,
      bonusCoins: 10,
      baseClaimedToday: true,
      bonusClaimedToday: false,
      hasVideoPostToday: true,
    });
    assert.equal(afterBase.claimableBase, 0);
    assert.equal(afterBase.claimableBonus, 10);
    assert.equal(afterBase.bonusEligible, true);

    const unverified = buildTreasurePeek({
      enabled: true,
      verified: false,
      day: '2026-08-16',
      baseCoins: 15,
      bonusCoins: 10,
      baseClaimedToday: false,
      bonusClaimedToday: false,
      hasVideoPostToday: true,
    });
    assert.equal(unverified.claimableBase, 0);
    assert.equal(unverified.claimableBonus, 0);
  });
});

describe('treasureChestConfig', () => {
  it('defaults base to 15 within the 5–25 product band', () => {
    const prevEnabled = process.env.TREASURE_CHEST_ENABLED;
    const prevBase = process.env.TREASURE_CHEST_BASE_COINS;
    const prevBonus = process.env.TREASURE_CHEST_BONUS_COINS;
    try {
      delete process.env.TREASURE_CHEST_ENABLED;
      delete process.env.TREASURE_CHEST_BASE_COINS;
      delete process.env.TREASURE_CHEST_BONUS_COINS;
      const d = getTreasureChestAmounts();
      assert.equal(d.enabled, true);
      assert.equal(d.baseCoins, 15);
      assert.equal(d.bonusCoins, 10);
      assert.ok(d.baseCoins >= d.baseMin && d.baseCoins <= d.baseMax);
    } finally {
      if (prevEnabled === undefined) delete process.env.TREASURE_CHEST_ENABLED;
      else process.env.TREASURE_CHEST_ENABLED = prevEnabled;
      if (prevBase === undefined) delete process.env.TREASURE_CHEST_BASE_COINS;
      else process.env.TREASURE_CHEST_BASE_COINS = prevBase;
      if (prevBonus === undefined) delete process.env.TREASURE_CHEST_BONUS_COINS;
      else process.env.TREASURE_CHEST_BONUS_COINS = prevBonus;
    }
  });
});
