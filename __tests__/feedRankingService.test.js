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
  countFollowedPosts,
  ensureFollowMixCandidates,
  extractPostHashtags,
  hashtagAffinityAdjust,
  mergeCandidatePosts,
  prepareRankedFeed,
  rankPosts,
  resolveRankContext,
  scorePost,
} from '../src/services/feedRankingService';
import { attachPromoteBoost } from '../src/services/promoteBoostService';

const NOW = Date.UTC(2026, 7, 8, 12);
const HOUR = 60 * 60 * 1000;
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

  it('boosts posts whose hashtags match viewer interests', () => {
    const untagged = post('plain', { date: NOW - 30 * 60 * 1000 });
    const tagged = post('tagged', {
      date: NOW - 10 * 60 * 60 * 1000,
      hashtags: ['#Gaming', 'comedy'],
      caption: 'clip #tech night',
    });
    const terms = ['gaming', 'tech', 'music'];

    expect(extractPostHashtags(tagged).sort()).toEqual(['comedy', 'gaming', 'tech']);
    expect(hashtagAffinityAdjust(tagged, terms)).toBeGreaterThan(0);
    expect(hashtagAffinityAdjust(untagged, terms)).toBe(0);
    expect(scorePost(tagged, { now: NOW, terms }))
      .toBeGreaterThan(scorePost(untagged, { now: NOW, terms }));
    expect(rankPosts([untagged, tagged], terms, new Set(), {
      now: NOW,
      fairCap: false,
    })[0].id).toBe('tagged');
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

  it('prefers a creator gap and respects feed-tail recentOwners across pages', () => {
    const ranked = rankPosts([
      post('a1', { userId: 'creator-a', likeCount: 100 }),
      post('a2', { userId: 'creator-a', likeCount: 90 }),
      post('b1', { userId: 'creator-b', likeCount: 80 }),
      post('c1', { userId: 'creator-c', likeCount: 70 }),
      post('d1', { userId: 'creator-d', likeCount: 60 }),
    ], [], new Set(), {
      now: NOW,
      fairCap: false,
      recentOwners: ['creator-a', 'creator-x'],
      minCreatorGap: 2,
    });

    expect(ranked[0].userId).not.toBe('creator-a');
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i].userId).not.toBe(ranked[i - 1].userId);
    }
    const firstA = ranked.findIndex((item) => item.userId === 'creator-a');
    const secondA = ranked.findIndex((item, idx) => idx > firstA && item.userId === 'creator-a');
    if (firstA >= 0 && secondA >= 0) {
      expect(secondA - firstA).toBeGreaterThanOrEqual(2);
    }
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

  it('re-reads follow context after enrichment so stale empty signals cannot win', async () => {
    const following = new Set();
    let releasePromote;
    const promoteGate = new Promise((resolve) => {
      releasePromote = resolve;
    });
    attachPromoteBoost.mockImplementationOnce(() => promoteGate);

    const olderFollowed = post('followed-older', {
      userId: 'f1',
      date: NOW - 2 * HOUR,
    });
    const newerDiscovery = post('discover-newer', {
      userId: 'd1',
      date: NOW - 1 * HOUR,
    });

    const pending = prepareRankedFeed([newerDiscovery, olderFollowed], {
      mode: 'rank',
      now: NOW,
      getContext: () => ({
        following: new Set(following),
        terms: [],
        now: NOW,
      }),
    });

    // Let account hydrate finish and hit the promote gate.
    await Promise.resolve();
    await Promise.resolve();

    // Simulate follows hydrating while account/promote enrichment is still in flight.
    following.add('f1');
    releasePromote([newerDiscovery, olderFollowed]);

    const ranked = await pending;
    expect(ranked.map((item) => item.id)).toEqual(['followed-older', 'discover-newer']);
  });

  it('resolveRankContext prefers live getContext over frozen opts', () => {
    const ctx = resolveRankContext({
      terms: ['stale'],
      following: new Set(),
      getContext: () => ({
        terms: ['live'],
        following: new Set(['f1']),
        now: NOW,
      }),
    });
    expect(ctx.terms).toEqual(['live']);
    expect([...ctx.following]).toEqual(['f1']);
  });

  it('merges follow candidates and counts followed posts for sparse pages', async () => {
    const organic = [
      post('d1', { userId: 'discovery-1' }),
      post('d2', { userId: 'discovery-2' }),
    ];
    const following = new Set(['f1']);
    expect(countFollowedPosts(organic, following)).toBe(0);

    const merged = mergeCandidatePosts(organic, [
      post('f-post', { userId: 'f1' }),
      post('d1', { userId: 'discovery-1' }),
    ]);
    expect(merged.map((item) => item.id)).toEqual(['d1', 'd2', 'f-post']);
    expect(countFollowedPosts(merged, following)).toBe(1);

    // Firebase disabled in this suite — ensureFollowMixCandidates must fail open.
    await expect(
      ensureFollowMixCandidates(organic, following),
    ).resolves.toEqual(organic);
  });
});
