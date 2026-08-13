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

describe('For You engine', () => {
  it('maps active ±1 neighbors; pool size is 3', () => {
    expect(FOR_YOU_POOL_SIZE).toBe(3);
    expect(roleForIndex(5, 5)).toBe('active');
    expect(roleForIndex(4, 5)).toBe('neighbor');
    expect(roleForIndex(6, 5)).toBe('neighbor');
    expect(roleForIndex(7, 5)).toBe('none');
    expect(shouldLoadCell(4, 5, 5)).toBe(true);
    expect(shouldLoadCell(8, 5, 5)).toBe(false);
    // Single center: mid-swipe must stay within the 3-slot pool.
    expect(shouldLoadCell(4, 5, 6)).toBe(false);
    expect(shouldLoadCell(7, 5, 6)).toBe(true);
  });

  it('neighbor parks paused; active respects feed mute; never emits seekToZero', () => {
    expect(
      playbackFlags({ index: 4, activeIndex: 5 }),
    ).toEqual({ shouldPlay: false, isMuted: true, role: 'neighbor' });
    expect(
      playbackFlags({
        index: 5,
        activeIndex: 5,
        cellActive: true,
        feedMuted: false,
      }),
    ).toEqual({ shouldPlay: true, isMuted: false, role: 'active' });
    // Promote must never ask the player to seek back to 0.
    expect(
      playbackFlags({ index: 5, activeIndex: 5, cellActive: true }).seekToZero,
    ).toBeUndefined();
  });
});

describe('For You render route', () => {
  const fs = require('fs');
  const path = require('path');

  const srcDir = path.join(__dirname, '../src');

  it('HomeScreen case A renders the FlatList / PremiumFeedVideo path', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/screens/HomeScreen.js'),
      'utf8',
    );
    expect(src).toMatch(/case 'A':/);
    expect(src).not.toMatch(/feed\/instant/);
    expect(src).not.toMatch(/InstantForYouPanel/);
    const caseA = src.slice(src.indexOf("case 'A':"), src.indexOf("case 'B':"));
    expect(caseA).toMatch(/<FlatList/);
    expect(caseA).toMatch(/renderItem=\{renderForYouItem\}/);
    expect(caseA).not.toMatch(/Instant/);
  });

  it('nothing outside src/feed/instant imports the instant feed', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (full === path.join(srcDir, 'feed', 'instant')) continue;
          walk(full);
        } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
          if (/feed\/instant/.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });

  it('ShortsPool promote path uses updatePlayback / uriMatches (no seek)', () => {
    const kt = fs.readFileSync(
      path.join(
        __dirname,
        '../android/app/src/main/java/com/blyp/mobile/shorts/ShortsPool.kt',
      ),
      'utf8',
    );
    expect(kt).toMatch(/fun uriMatches/);
    expect(kt).toMatch(/fun hasBoundUri/);
    expect(kt).toMatch(/fun updatePlayback/);
    expect(kt).toMatch(/promote-seek=0/);
    const surface = fs.readFileSync(
      path.join(
        __dirname,
        '../android/app/src/main/java/com/blyp/mobile/shorts/ShortsSurfaceView.kt',
      ),
      'utf8',
    );
    expect(surface).toMatch(/hasBoundUri/);
    expect(surface).toMatch(/updatePlayback/);
  });

  it('ShortsSurfaceView skips rebind when surface arrives on already-bound uri', () => {
    const surface = fs.readFileSync(
      path.join(
        __dirname,
        '../android/app/src/main/java/com/blyp/mobile/shorts/ShortsSurfaceView.kt',
      ),
      'utf8',
    );
    expect(surface).toMatch(/alreadyBound/);
    expect(surface).toMatch(/if \(playing == value\) return/);
    expect(surface).toMatch(/if \(muted == value\) return/);
  });

  it('MainApplication still registers BlypShorts', () => {
    const src = fs.readFileSync(
      path.join(
        __dirname,
        '../android/app/src/main/java/com/blyp/mobile/MainApplication.kt',
      ),
      'utf8',
    );
    expect(src).toMatch(/shorts\.ShortsPackage/);
  });
});
