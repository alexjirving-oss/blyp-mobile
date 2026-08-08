const {
  dedupePostsById,
  ensureFocusPostInList,
  feedInventoryStats,
  resolveFeedVideoUri,
  stampFeedKeys,
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

  it('reports inventory unique vs duplicates', () => {
    expect(
      feedInventoryStats([
        { id: '1', userId: 'u1' },
        { id: '2', userId: 'u2' },
        { id: '1', userId: 'u1' },
      ]),
    ).toEqual({ total: 3, unique: 2, duplicates: 1, creators: 2 });
  });
});
