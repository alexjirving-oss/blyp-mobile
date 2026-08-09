const { isHlsVideoUri, pickProgressiveFeedVideoUri } = require('../src/utils/feedVideoUri');

describe('feedVideoUri', () => {
  it('detects HLS manifests', () => {
    expect(isHlsVideoUri('https://x/a.m3u8')).toBe(true);
    expect(isHlsVideoUri('https://x/hls/stream/index')).toBe(true);
    expect(isHlsVideoUri('https://x/clip.mp4')).toBe(false);
    expect(isHlsVideoUri(null)).toBe(false);
  });

  it('picks progressive before HLS', () => {
    expect(
      pickProgressiveFeedVideoUri([
        'https://cdn.example.com/a.m3u8',
        'https://cdn.example.com/a.mp4',
      ]),
    ).toContain('a.mp4');
  });

  it('falls back to HLS when nothing progressive exists', () => {
    expect(pickProgressiveFeedVideoUri(['https://cdn.example.com/a.m3u8'])).toContain('a.m3u8');
  });
});
