const {
  claimFeedAudio,
  releaseFeedAudio,
  isFeedAudioOwner,
  getFeedAudioOwner,
} = require('../src/services/feedAudioSession');

jest.mock('../src/services/notifySound', () => ({
  ensureMediaPlaybackAudioMode: jest.fn(async () => {}),
}));

describe('feedAudioSession', () => {
  beforeEach(() => {
    const owner = getFeedAudioOwner();
    if (owner) releaseFeedAudio(owner);
  });

  it('only one token owns audible playback', async () => {
    await expect(claimFeedAudio('a')).resolves.toBe(true);
    expect(isFeedAudioOwner('a')).toBe(true);
    await expect(claimFeedAudio('b')).resolves.toBe(true);
    expect(isFeedAudioOwner('a')).toBe(false);
    expect(isFeedAudioOwner('b')).toBe(true);
    releaseFeedAudio('b');
    expect(getFeedAudioOwner()).toBe(null);
  });

  it('release of non-owner is a no-op', async () => {
    await claimFeedAudio('a');
    releaseFeedAudio('other');
    expect(isFeedAudioOwner('a')).toBe(true);
  });
});
