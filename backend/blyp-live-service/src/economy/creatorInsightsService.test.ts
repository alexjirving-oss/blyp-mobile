import assert from 'node:assert/strict';
import test from 'node:test';
import {
  periodStartMs,
  summarizeBattles,
  summarizePosts,
  summarizeReceivedGifts,
  summarizeSentGifts,
  summarizeStreams,
} from './creatorInsightsService';

const DAY_MS = 24 * 60 * 60 * 1000;

test('period windows use rolling seven and thirty day cutoffs', () => {
  const now = Date.UTC(2026, 7, 8, 12);
  assert.equal(periodStartMs('week', now), now - 7 * DAY_MS);
  assert.equal(periodStartMs('month', now), now - 30 * DAY_MS);
  assert.equal(periodStartMs('all', now), null);
});

test('content metrics use posts published inside the selected window', () => {
  const now = Date.UTC(2026, 7, 8, 12);
  const posts = [
    {
      id: 'recent-video',
      data: {
        type: 'video',
        date: now - DAY_MS,
        likedBy: ['a', 'b'],
        commentCount: 3,
        shares: 0,
        views: 50,
        reach: {
          impressions: 60,
          engagements: {
            shares: 4,
            dwellMsTotal: 125_000,
            completions: 7,
          },
        },
        caption: 'Recent video',
      },
    },
    {
      id: 'old-post',
      data: {
        type: 'post',
        date: now - 40 * DAY_MS,
        likeCount: 100,
        commentCount: 10,
        shares: 8,
        views: 500,
      },
    },
  ];

  const summary = summarizePosts(posts, now - 7 * DAY_MS);
  assert.deepEqual(
    {
      publishedCount: summary.publishedCount,
      videoCount: summary.videoCount,
      postCount: summary.postCount,
      likesReceived: summary.likesReceived,
      commentsReceived: summary.commentsReceived,
      shares: summary.shares,
      views: summary.views,
      watchTimeSeconds: summary.watchTimeSeconds,
      completions: summary.completions,
    },
    {
      publishedCount: 1,
      videoCount: 1,
      postCount: 0,
      likesReceived: 2,
      commentsReceived: 3,
      shares: 4,
      views: 60,
      watchTimeSeconds: 125,
      completions: 7,
    },
  );
  assert.equal(summary.bestPost?.id, 'recent-video');
});

test('live duration is clipped to the selected period', () => {
  const now = Date.UTC(2026, 7, 8, 12);
  const startAt = now - 7 * DAY_MS;
  const streams = [
    {
      id: 'overlap',
      data: {
        startedAt: startAt - 60 * 60 * 1000,
        endedAt: startAt + 2 * 60 * 60 * 1000,
        status: 'ended',
        likes: 12,
        totalViews: 30,
        peakViewerCount: 8,
      },
    },
    {
      id: 'outside',
      data: {
        startedAt: startAt - 3 * DAY_MS,
        endedAt: startAt - 2 * DAY_MS,
        status: 'ended',
      },
    },
  ];

  assert.deepEqual(summarizeStreams(streams, startAt, now), {
    sessionCount: 1,
    durationSeconds: 2 * 60 * 60,
    likesReceived: 12,
    views: 30,
    peakViewers: 8,
  });
});

test('gift metrics split owned posts from live sessions and rank unique recipients', () => {
  const groups = [
    {
      streamId: 'post-1',
      peerUserId: 'person-a',
      giftCount: 2,
      eventCount: 1,
      coins: 20,
    },
    {
      streamId: 'live-1',
      peerUserId: 'person-a',
      giftCount: 3,
      eventCount: 2,
      coins: 30,
    },
    {
      streamId: 'live-2',
      peerUserId: 'person-b',
      giftCount: 1,
      eventCount: 1,
      coins: 5,
    },
  ];

  assert.deepEqual(summarizeReceivedGifts(groups, new Set(['post-1'])), {
    posts: { count: 2, events: 1, coins: 20 },
    live: { count: 4, events: 3, coins: 35 },
  });
  assert.deepEqual(summarizeSentGifts(groups), {
    count: 6,
    events: 4,
    coins: 55,
    people: 2,
  });
});

test('battle outcomes are resolved from the participant side', () => {
  assert.deepEqual(
    summarizeBattles('me', [
      { creator_uid: 'me', opponent_uid: 'other', winner_side: 'A' },
      { creator_uid: 'other', opponent_uid: 'me', winner_side: 'A' },
      { creator_uid: 'me', opponent_uid: 'third', winner_side: null },
    ]),
    { played: 3, wins: 1, losses: 1, draws: 1 },
  );
});
