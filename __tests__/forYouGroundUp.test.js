const {
  nextPlayableUri,
  resolvePlayableUri,
} = require('../src/feed/resolvePlayableUri');
const {
  FOR_YOU_POOL_SIZE,
  roleForIndex,
  shouldLoadCell,
  playbackFlags,
} = require('../src/feed/ForYouEngine');

describe('resolvePlayableUri — progressive over dead startUrl', () => {
  it('prefers working videoUrl over startUrl and HLS', () => {
    const r = resolvePlayableUri({
      startUrl: 'https://cdn.example.com/dead-start.mp4',
      hlsUrl: 'https://cdn.example.com/master.m3u8',
      videoUrl: 'https://cdn.example.com/clip.mp4',
    });
    expect(r.strategy).toBe('progressive');
    expect(r.playUri).toContain('clip.mp4');
    expect(r.ladder[0]).toContain('clip.mp4');
    expect(r.ladder[0]).not.toContain('dead-start');
  });

  it('never puts startUrl ahead of progressive CDN/compressed', () => {
    const r = resolvePlayableUri({
      abr: { startUrl: 'https://cdn.example.com/rung360.mp4' },
      compressedUrl: 'https://cdn.example.com/opt.mp4',
      startUrl: 'https://cdn.example.com/start.mp4',
    });
    expect(r.playUri).toContain('opt.mp4');
  });

  it('uses HLS only when no progressive MP4 exists', () => {
    const r = resolvePlayableUri({
      hlsUrl: 'https://cdn.example.com/v/master.m3u8',
      startUrl: 'https://cdn.example.com/v/start.mp4',
    });
    expect(r.playUri).toContain('master.m3u8');
    expect(r.strategy).toBe('hls');
  });

  it('nextPlayableUri walks the ladder after failure', () => {
    const ladder = [
      'https://cdn.example.com/a.mp4',
      'https://cdn.example.com/b.m3u8',
      'https://cdn.example.com/c.mp4',
    ];
    expect(nextPlayableUri(ladder, ladder[0])).toBe(ladder[1]);
    expect(nextPlayableUri(ladder, ladder[2])).toBeNull();
  });
});

describe('ForYouEngine roles', () => {
  it('maps active ±1 neighbors; pool size is 3', () => {
    expect(FOR_YOU_POOL_SIZE).toBe(3);
    expect(roleForIndex(5, 5)).toBe('active');
    expect(roleForIndex(4, 5)).toBe('neighbor');
    expect(roleForIndex(6, 5)).toBe('neighbor');
    expect(roleForIndex(7, 5)).toBe('none');
    expect(shouldLoadCell(4, 5, 5)).toBe(true);
    expect(shouldLoadCell(8, 5, 5)).toBe(false);
  });

  it('neighbor stays paused+muted; active respects feed mute', () => {
    expect(
      playbackFlags({ index: 4, activeIndex: 5, cellActive: false }),
    ).toEqual({ shouldPlay: false, isMuted: true, role: 'neighbor' });
    expect(
      playbackFlags({
        index: 5,
        activeIndex: 5,
        cellActive: true,
        feedMuted: false,
      }),
    ).toEqual({ shouldPlay: true, isMuted: false, role: 'active' });
  });
});

describe('ground-up path — storm FeedPlayer must be gone', () => {
  const fs = require('fs');
  const path = require('path');

  it('does not ship storm feedplayer package or FeedPooledVideo', () => {
    expect(
      fs.existsSync(
        path.join(__dirname, '../android/app/src/main/java/com/blyp/mobile/feedplayer'),
      ),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(__dirname, '../src/components/Feed/FeedPooledVideo.js')),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(__dirname, '../src/native/FeedPlayerNative.js')),
    ).toBe(false);
    expect(
      fs.existsSync(path.join(__dirname, '../plugins/withFeedPlayerIOS.js')),
    ).toBe(false);
  });

  it('PremiumFeedVideo uses ForYouVideo from src/feed', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/components/Feed/PremiumFeedVideo.js'),
      'utf8',
    );
    expect(src).toMatch(/from ['\"]\.\.\/\.\.\/feed\/ForYouVideo['\"]/);
    expect(src).not.toMatch(/FeedPooledVideo/);
  });

  it('MainApplication registers BlypShorts (not FeedPlayer)', () => {
    const src = require('fs').readFileSync(
      require('path').join(
        __dirname,
        '../android/app/src/main/java/com/blyp/mobile/MainApplication.kt',
      ),
      'utf8',
    );
    expect(src).toMatch(/shorts\.ShortsPackage/);
    expect(src).not.toMatch(/feedplayer\.FeedPlayerPackage/);
  });

  it('Shorts ViewManagers expose seekToMs + role', () => {
    const fs = require('fs');
    const path = require('path');
    const ktVm = fs.readFileSync(
      path.join(
        __dirname,
        '../android/app/src/main/java/com/blyp/mobile/shorts/ShortsViewManager.kt',
      ),
      'utf8',
    );
    expect(ktVm).toMatch(/seekToMs/);
    expect(ktVm).toMatch(/name = "role"/);
    const bridges = fs.readFileSync(
      path.join(__dirname, '../plugins/blyp-shorts-ios/ShortsBridges.m'),
      'utf8',
    );
    expect(bridges).toMatch(/seekToMs/);
    expect(bridges).toMatch(/RCT_EXPORT_VIEW_PROPERTY\(role/);
    expect(fs.existsSync(path.join(__dirname, '../plugins/withBlypShortsIOS.js'))).toBe(
      true,
    );
  });

  it('ShortsPool is size 3 and does not touch AVAudioSession', () => {
    const fs = require('fs');
    const path = require('path');
    const kt = fs.readFileSync(
      path.join(__dirname, '../android/app/src/main/java/com/blyp/mobile/shorts/ShortsPool.kt'),
      'utf8',
    );
    expect(kt).toMatch(/const val POOL_SIZE = 3/);
    expect(kt).toMatch(/seekTo\(0\)/);
    expect(kt).toMatch(/didSeekOnActivate/);
    const swift = fs.readFileSync(
      path.join(__dirname, '../plugins/blyp-shorts-ios/ShortsPool.swift'),
      'utf8',
    );
    expect(swift).toMatch(/static let poolSize = 3/);
    expect(swift).not.toMatch(/setCategory\s*\(/);
    expect(swift).toMatch(/never touches AVAudioSession/i);
    expect(swift).toMatch(/didSeekOnActivate/);
  });
});
