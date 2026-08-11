const fs = require('fs');
const path = require('path');

describe('For You ground-up path — storm FeedPlayer hard-disabled', () => {
  it('ForYouVideo has no expo-av / EnhancedVideo fallback', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/feed/ForYouVideo.js'),
      'utf8',
    );
    expect(src).not.toMatch(/import\s+EnhancedVideo/);
    expect(src).not.toMatch(/from\s+['"]expo-av['"]/);
    expect(src).toMatch(/For You player not linked/);
  });

  it('PremiumFeedVideo mounts ForYouVideo, not FeedPooledVideo / FeedPlayer', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/components/Feed/PremiumFeedVideo.js'),
      'utf8',
    );
    expect(src).toMatch(/ForYouVideo/);
    expect(src).not.toMatch(/FeedPooledVideo/);
    expect(src).not.toMatch(/FeedPlayer/);
  });

  it('HomeScreen For You cell uses resolvePlayableUri, not FeedPlayerNative', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/screens/HomeScreen.js'),
      'utf8',
    );
    expect(src).toMatch(/resolvePlayableUri/);
    expect(src).not.toMatch(/isFeedPlayerPoolAvailable/);
    expect(src).not.toMatch(/FeedPlayerNative/);
    expect(src).not.toMatch(/resolveFeedPlayback/);
  });
});
