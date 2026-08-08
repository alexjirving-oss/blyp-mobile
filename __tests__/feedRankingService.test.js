jest.mock('../src/config/firebase', () => ({
  db: null,
  firebaseEnabled: false,
}));

jest.mock('../src/services/promoteBoostService', () => ({
  attachPromoteBoost: jest.fn(async (posts) => posts),
  applyPromoteFairCap: jest.fn((posts) => posts),
  promoteBoostAdjust: jest.fn((post) => Number(post?.promoteBoostWeight) || 0),
  isPromotedPost: jest.fn((post) => Number(post?.promoteBoostWeight) > 0),
}));

import {
  prepareRankedFeed,
  rankPosts,
  scorePost,
} from '../src/services/feedRankingService';
import { attachPromoteBoost } from '../src/services/promoteBoostService';

const NOW = Date.UTC(2026, 7, 8, 12);
const post = (id, overrides = {}) => ({
  id,
  userId: `creator-${id}`,
  date: NOW - 60 * 60 * 1000,
  type: 'video',
  videoUrl: `https://example.com/${id}.mp4`,
  ...overrides,
});

describe('For You v1 ranking', () => {
  beforeEach(() => {
    attachPromoteBoost.mockImplementation(async (posts) => posts);
  });

  it('uses freshness instead of random jitter for cold start', () => {
    const recent = post('recent');
    const old = post('old', { date: NOW - 7 * 24 * 60 * 60 * 1000 });

    expect(scorePost(recent, { now: NOW })).toBeGreaterThan(scorePost(old, { now: NOW }));
    expect(rankPosts([old, recent], [], new Set(), { now: NOW, fairCap: false }))
      .toEqual([recent, old]);
  });

  it('rewards follows, topic matches, engagement, gifts, and watch quality', () => {
    const baseline = post('baseline');
    const signalled = post('signalled', {
      userId: 'followed',
      category: 'Formula 1',
      likeCount: 12,
      commentCount: 4,
      shareCount: 3,
      giftCoins: 100,
      reach: {
        impressions: 10,
        engagements: { completions: 8, dwellMsTotal: 120_000 },
      },
    });
    const context = {
      now: NOW,
      terms: ['f1', 'formula'],
      following: new Set(['followed']),
    };

    expect(scorePost(signalled, context)).toBeGreaterThan(scorePost(baseline, context));
  });

  it('demotes posts seen recently', () => {
    const seen = post('seen');
    const unseen = post('unseen');

    expect(rankPosts([seen, unseen], [], new Set(), {
      now: NOW,
      seenIds: new Set(['seen']),
      fairCap: false,
    })[0].id).toBe('unseen');
  });

  it('avoids consecutive posts from one creator when alternatives exist', () => {
    const ranked = rankPosts([
      post('a1', { userId: 'creator-a', likeCount: 100 }),
      post('a2', { userId: 'creator-a', likeCount: 80 }),
      post('b1', { userId: 'creator-b' }),
    ], [], new Set(), { now: NOW, fairCap: false });

    expect(ranked.map((item) => item.userId)).toEqual([
      'creator-a',
      'creator-b',
      'creator-a',
    ]);
  });

  it('mixes discovery into a follow-heavy candidate page', () => {
    const following = new Set(['f1', 'f2', 'f3']);
    const ranked = rankPosts([
      post('follow-1', { userId: 'f1', likeCount: 100 }),
      post('follow-2', { userId: 'f2', likeCount: 90 }),
      post('follow-3', { userId: 'f3', likeCount: 80 }),
      post('discover', { userId: 'd1' }),
    ], [], following, { now: NOW, fairCap: false });

    expect(ranked.slice(0, 3).some((item) => item.userId === 'd1')).toBe(true);
  });

  it('fails open to organic ranking when enrichment fails', async () => {
    attachPromoteBoost.mockRejectedValueOnce(new Error('offline'));
    const candidates = [post('older', { date: NOW - 48 * 60 * 60 * 1000 }), post('newer')];

    await expect(prepareRankedFeed(candidates, {
      mode: 'rank',
      now: NOW,
    })).resolves.toEqual([candidates[1], candidates[0]]);
  });
});
