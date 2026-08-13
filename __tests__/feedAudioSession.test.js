const {
  claimFeedAudio,
  releaseFeedAudio,
  isFeedAudioOwner,
  getFeedAudioOwner,
  markFeedAudioRouteDirty,
} = require('../src/services/feedAudioSession');

const { reclaimMediaPlaybackRoute } = require('../src/services/notifySound');

jest.mock('../src/services/notifySound', () => ({
  ensureMediaPlaybackAudioMode: jest.fn(async () => {}),
  invalidateMediaPlaybackAudioMode: jest.fn(),
  reclaimMediaPlaybackRoute: jest.fn(async () => ({ modeName: 'MODE_NORMAL' })),
}));
jest.mock('../src/services/blypAudioRoute', () => ({
  applyMediaSpeaker: jest.fn(async () => ({ modeName: 'MODE_NORMAL' })),
}));

describe('feedAudioSession', () => {
  beforeEach(() => {
    const owner = getFeedAudioOwner();
    if (owner) releaseFeedAudio(owner);
    reclaimMediaPlaybackRoute.mockClear();
    markFeedAudioRouteDirty();
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

  it('reclaims speaker once then skips setAudioMode on swipe claims', async () => {
    await claimFeedAudio('clip-1');
    expect(reclaimMediaPlaybackRoute).toHaveBeenCalledTimes(1);
    await claimFeedAudio('clip-2');
    await claimFeedAudio('clip-3');
    expect(reclaimMediaPlaybackRoute).toHaveBeenCalledTimes(1);
    markFeedAudioRouteDirty();
    await claimFeedAudio('clip-4');
    expect(reclaimMediaPlaybackRoute).toHaveBeenCalledTimes(2);
  });
});
