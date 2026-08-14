const {
  buildCycleContinuation,
  dedupePostsById,
  demoteAvoidedPosts,
  ensureFocusPostInList,
  feedInventoryStats,
  getLastFeedHeadIds,
  resetLastFeedHeadIds,
  resolveFeedVideoUri,
  resolveForYouBootWidenApply,
  shuffleArray,
  shufflePostsVaried,
  stampFeedKeys,
  varietyAvoidCount,
} = require('../src/utils/forYouFeedList');

describe('forYouFeedList', () => {
  it('hard-dedupes by post id preserving first occurrence', () => {
    const a = { id: '1', title: 'a' };
    const b = { id: '2', title: 'b' };
    const a2 = { id: '1', title: 'a-dup' };
    expect(dedupePostsById([a, b, a2, { title: 'noid' }])).toEqual([a, b]);
  });

  it('stamps stable feedKey from id + cycle', () => {
    expect(stampFeedKeys([{ id: 'p1' }], 3)[0].feedKey).toBe('p1__3');
  });

  it('injects focus post at front when missing, leaves order when present', () => {
    const list = [{ id: 'a' }, { id: 'b' }];
    const injected = ensureFocusPostInList(list, {
      postId: 'x',
      post: { id: 'x', type: 'video', videoUrl: 'https://x/v.mp4' },
      cycle: 1,
      isEligible: () => true,
    });
    expect(injected.map((p) => p.id)).toEqual(['x', 'a', 'b']);
    expect(injected[0].feedKey).toBe('x__1');

    const kept = ensureFocusPostInList(list, {
      postId: 'b',
      post: { id: 'b' },
      cycle: 2,
      isEligible: () => true,
    });
    expect(kept.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('prefers CDN / compressed playback URIs', () => {
    expect(
      resolveFeedVideoUri({
        videoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/raw.mp4',
        cdnUrl: 'https://cdn.example.com/opt.mp4',
      }),
    ).toContain('cdn.example.com');
    expect(
      resolveFeedVideoUri({
        media: [{ type: 'video', compressedUrl: 'https://cdn.example.com/c.mp4', url: 'https://x/raw.mp4' }],
      }),
    ).toContain('cdn.example.com/c.mp4');
  });

  it('prefers progressive MP4 over HLS playlists', () => {
    expect(
      resolveFeedVideoUri({
        hlsUrl: 'https://cdn.example.com/v/master.m3u8',
        videoUrl: 'https://cdn.example.com/v/clip.mp4',
      }),
    ).toContain('clip.mp4');
    expect(
      resolveFeedVideoUri({
        hlsUrl: 'https://cdn.example.com/v/master.m3u8',
      }),
    ).toContain('master.m3u8');
  });

  it('reports inventory unique vs duplicates', () => {
    expect(
      feedInventoryStats([
        { id: '1', userId: 'u1' },
        { id: '2', userId: 'u2' },
        { id: '1', userId: 'u1' },
      ]),
    ).toEqual({ total: 3, unique: 2, duplicates: 1, creators: 2 });
  });

  it('shuffleArray permutes with a deterministic RNG', () => {
    const seq = [0.9, 0.1, 0.5, 0.2];
    let i = 0;
    const random = () => seq[i++ % seq.length];
    const out = shuffleArray(['a', 'b', 'c', 'd'], random);
    expect(out).toHaveLength(4);
    expect(new Set(out)).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(out).not.toEqual(['a', 'b', 'c', 'd']);
  });

  it('shufflePostsVaried keeps last head out of the fresh prefix when pool allows', () => {
    resetLastFeedHeadIds();
    const posts = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
      { id: 'e' },
    ];
    // Force a stable shuffle order via a constant RNG that always picks j=0.
    const random = () => 0;
    const first = shufflePostsVaried(posts, {
      avoidFirstIds: [],
      avoidCount: 3,
      random,
    });
    expect(getLastFeedHeadIds()).toEqual(first.slice(0, 3).map((p) => p.id));

    const second = shufflePostsVaried(posts, {
      avoidFirstIds: getLastFeedHeadIds(),
      avoidCount: 3,
      random,
      remember: false,
    });
    const avoided = new Set(first.slice(0, 3).map((p) => p.id));
    // Fresh clips (not in last head) must lead; avoided ids trail.
    const freshCount = posts.length - avoided.size;
    expect(second.slice(0, freshCount).every((p) => !avoided.has(p.id))).toBe(true);
    expect(second.slice(freshCount).every((p) => avoided.has(p.id))).toBe(true);
  });

  it('varietyAvoidCount scales with pool and leaves a lead slot', () => {
    expect(varietyAvoidCount(1)).toBe(0);
    expect(varietyAvoidCount(10)).toBe(6);
    expect(varietyAvoidCount(10, 2)).toBe(2);
  });

  it('buildCycleContinuation reshuffles with new feedKeys and prefers unseen', () => {
    resetLastFeedHeadIds();
    const posts = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
      { id: 'e' },
      { id: 'f' },
    ];
    const random = () => 0;
    // Last 3 of this window are avoided first (varietyAvoidCount(6) === 3).
    const seen = ['a', 'b', 'c', 'd'];
    const next = buildCycleContinuation(posts, {
      cycle: 2,
      recentlySeenIds: seen,
      random,
    });
    expect(next.every((p) => String(p.feedKey).endsWith('__2'))).toBe(true);
    expect(new Set(next.map((p) => p.id)).size).toBe(posts.length);
    expect(next.slice(0, 3).map((p) => p.id).sort()).toEqual(['a', 'e', 'f']);
  });

  it('demotes avoided ids off the head while preserving relative order', () => {
    resetLastFeedHeadIds();
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const next = demoteAvoidedPosts(list, {
      avoidFirstIds: ['a', 'b'],
      avoidCount: 2,
      remember: false,
    });
    expect(next.map((p) => p.id)).toEqual(['c', 'd', 'a', 'b']);
  });

  describe('resolveForYouBootWidenApply', () => {
    const provisional = [{ id: 'a' }, { id: 'b' }];
    const widened = [{ id: 'z' }, { id: 'a' }, { id: 'c' }, { id: 'd' }];

    it('replaces when still at head with unchanged provisional head', () => {
      expect(
        resolveForYouBootWidenApply({
          currentList: provisional,
          widenedList: widened,
          discoverIndex: 0,
          provisionalHeadId: 'a',
        }),
      ).toEqual({ mode: 'replace', list: widened });
    });

    it('appends unseen boot posts without reshuffling when user left index 0', () => {
      const current = [{ id: 'a' }, { id: 'b' }];
      expect(
        resolveForYouBootWidenApply({
          currentList: current,
          widenedList: widened,
          discoverIndex: 1,
          provisionalHeadId: 'a',
        }),
      ).toEqual({
        mode: 'append',
        list: [{ id: 'a' }, { id: 'b' }, { id: 'z' }, { id: 'c' }, { id: 'd' }],
      });
    });

    it('skips when focus is pinned or there is nothing new to append', () => {
      expect(
        resolveForYouBootWidenApply({
          currentList: provisional,
          widenedList: widened,
          discoverIndex: 0,
          focusPinned: true,
        }),
      ).toEqual({ mode: 'skip', list: null });

      expect(
        resolveForYouBootWidenApply({
          currentList: [{ id: 'z' }, { id: 'a' }, { id: 'c' }, { id: 'd' }],
          widenedList: widened,
          discoverIndex: 2,
          provisionalHeadId: 'z',
        }),
      ).toEqual({ mode: 'skip', list: null });
    });
  });
});
