const {
  resolvePlayableUri,
  nextPlayableUri,
} = require('../src/feed/resolvePlayableUri');

describe('resolvePlayableUri — progressive-first, never dead startUrl lead', () => {
  it('prefers videoUrl over startUrl and HLS', () => {
    const r = resolvePlayableUri({
      startUrl: 'https://cdn.example.com/dead-start.mp4',
      hlsUrl: 'https://cdn.example.com/master.m3u8',
      videoUrl: 'https://cdn.example.com/clip.mp4',
    });
    expect(r.strategy).toBe('progressive');
    expect(r.playUri).toContain('clip.mp4');
    expect(r.ladder[0]).not.toContain('dead-start');
  });

  it('never leads with startUrl when progressive CDN exists', () => {
    const r = resolvePlayableUri({
      abr: { startUrl: 'https://cdn.example.com/rung360.mp4' },
      compressedUrl: 'https://cdn.example.com/opt.mp4',
      startUrl: 'https://cdn.example.com/start.mp4',
    });
    expect(r.playUri).toContain('opt.mp4');
    expect(r.ladder[0]).toContain('opt.mp4');
  });

  it('uses HLS only when no progressive exists', () => {
    const r = resolvePlayableUri({
      hlsUrl: 'https://cdn.example.com/v/master.m3u8',
      startUrl: 'https://cdn.example.com/v/start.mp4',
    });
    expect(r.playUri).toContain('master.m3u8');
    expect(r.strategy).toBe('hls');
  });

  it('returns none when empty post', () => {
    expect(resolvePlayableUri(null).strategy).toBe('none');
    expect(resolvePlayableUri({}).playUri).toBeNull();
  });

  it('nextPlayableUri walks ladder after failure', () => {
    const ladder = [
      'https://cdn.example.com/a.mp4',
      'https://cdn.example.com/b.m3u8',
      'https://cdn.example.com/c.mp4',
    ];
    expect(nextPlayableUri(ladder, ladder[0])).toBe(ladder[1]);
    expect(nextPlayableUri(ladder, ladder[2])).toBeNull();
  });
});
