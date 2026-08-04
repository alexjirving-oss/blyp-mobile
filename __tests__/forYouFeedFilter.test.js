import { isForYouFeedPost } from '../src/utils/forYouFeedFilter';

describe('forYouFeedFilter', () => {
  it('accepts liked video posts', () => {
    expect(
      isForYouFeedPost({ type: 'video', videoUrl: 'https://x/v.mp4', likes: 2 }),
    ).toBe(true);
  });

  it('rejects photos', () => {
    expect(isForYouFeedPost({ type: 'image', imageUrl: 'https://x/p.jpg', likes: 5 })).toBe(false);
  });

  it('rejects zero-like videos', () => {
    expect(isForYouFeedPost({ type: 'video', videoUrl: 'https://x/v.mp4', likes: 0 })).toBe(false);
  });

  it('rejects explicitly silent videos', () => {
    expect(
      isForYouFeedPost({ type: 'video', videoUrl: 'https://x/v.mp4', likes: 3, hasAudio: false }),
    ).toBe(false);
  });
});
