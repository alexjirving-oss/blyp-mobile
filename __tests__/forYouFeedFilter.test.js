import { isForYouFeedPost } from '../src/utils/forYouFeedFilter';

describe('forYouFeedFilter', () => {
  it('accepts video posts with sound (likes optional)', () => {
    expect(
      isForYouFeedPost({ type: 'video', videoUrl: 'https://x/v.mp4', likes: 2 }),
    ).toBe(true);
  });

  it('accepts zero-like videos with a playable url', () => {
    expect(isForYouFeedPost({ type: 'video', videoUrl: 'https://x/v.mp4', likes: 0 })).toBe(true);
  });

  it('rejects photos', () => {
    expect(isForYouFeedPost({ type: 'image', imageUrl: 'https://x/p.jpg', likes: 5 })).toBe(false);
  });

  it('rejects explicitly silent videos', () => {
    expect(
      isForYouFeedPost({ type: 'video', videoUrl: 'https://x/v.mp4', likes: 3, hasAudio: false }),
    ).toBe(false);
  });
});
