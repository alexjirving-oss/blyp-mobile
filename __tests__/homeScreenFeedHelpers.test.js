const { isForYouFeedPost, isVideoWithSoundPost } = require('../src/utils/forYouFeedFilter');

// HomeScreen depends on these symbols at runtime — guard against rename/delete regressions.
describe('HomeScreen feed helper contract', () => {
  const isPlayableVideoPost = (p) => isVideoWithSoundPost(p);
  const isValidFeedPost = (p) => isForYouFeedPost(p);

  it('isPlayableVideoPost exists and accepts video', () => {
    expect(isPlayableVideoPost({ type: 'video', videoUrl: 'https://x/v.mp4' })).toBe(true);
  });

  it('isValidFeedPost accepts videos with sound regardless of likes', () => {
    expect(isValidFeedPost({ type: 'video', videoUrl: 'https://x/v.mp4', likes: 1 })).toBe(true);
    expect(isValidFeedPost({ type: 'video', videoUrl: 'https://x/v.mp4', likes: 0 })).toBe(true);
    expect(isValidFeedPost({ type: 'image', imageUrl: 'https://x/p.jpg', likes: 5 })).toBe(false);
  });
});
