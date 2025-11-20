import { fixVideoUrlForPlayback } from '../src/utils/videoUrlFixer';

describe('smoke utils', () => {
  it('fixVideoUrlForPlayback returns null for empty', () => {
    expect(fixVideoUrlForPlayback(null)).toBeNull();
  });

  it('fixVideoUrlForPlayback returns original when no change needed', () => {
    const url = 'https://example.com/video.mp4';
    expect(fixVideoUrlForPlayback(url)).toBe(url);
  });
});
