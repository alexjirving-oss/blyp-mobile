/**
 * @jest-environment node
 */
import {
  clampOverlayBox,
  hasNativeOverlayWidgets,
  hostTop9OverlayFlags,
  parseStudioOverlayFeedNative,
  phoneOverlayAspect,
} from '../src/lib/studioOverlayFeedNative';

describe('parseStudioOverlayFeedNative', () => {
  test('renders nothing when feed is absent or v<1', () => {
    expect(parseStudioOverlayFeedNative(null)).toBeNull();
    expect(parseStudioOverlayFeedNative(undefined)).toBeNull();
    expect(parseStudioOverlayFeedNative({ overlays: { jukebox: true } })).toBeNull();
    expect(parseStudioOverlayFeedNative({ v: 0, overlays: { jukebox: true } })).toBeNull();
  });

  test('does not apply web DEFAULT_OVERLAYS (chat on, jukebox off)', () => {
    const feed = parseStudioOverlayFeedNative({ v: 1 });
    expect(feed.overlays.jukebox).toBe(false);
    expect(feed.overlays.gifters).toBe(false);
    expect(feed.overlays.goal).toBe(false);
    expect(feed.overlays.events).toBe(false);
    expect(feed.overlays.chat).toBe(false);
    expect(feed.overlays.gifts).toBe(false);
    expect(feed.overlays.timer).toBe(false);
    expect(feed.overlays.viewers).toBe(false);
    expect(feed.overlays.qr).toBe(false);
    expect(hasNativeOverlayWidgets(feed)).toBe(false);
  });

  test('honors host flags for every studio overlay id', () => {
    const feed = parseStudioOverlayFeedNative({
      v: 1,
      overlays: {
        jukebox: true,
        gifters: true,
        goal: true,
        events: true,
        chat: true,
        gifts: true,
        timer: true,
        viewers: true,
        qr: true,
      },
      timerLabel: '01:02:03',
      viewers: 4,
      watchUrl: 'https://blyp.world/live/abc',
      giftsLabel: '12 gifts',
      chatLines: [{ name: 'Alex', text: 'hi' }],
    });
    expect(feed.overlays.jukebox).toBe(true);
    expect(feed.overlays.gifters).toBe(true);
    expect(feed.overlays.goal).toBe(true);
    expect(feed.overlays.events).toBe(true);
    expect(feed.overlays.chat).toBe(true);
    expect(feed.overlays.gifts).toBe(true);
    expect(feed.overlays.timer).toBe(true);
    expect(feed.overlays.viewers).toBe(true);
    expect(feed.overlays.qr).toBe(true);
    expect(feed.timerLabel).toBe('01:02:03');
    expect(feed.viewers).toBe(4);
    expect(feed.watchUrl).toBe('https://blyp.world/live/abc');
    expect(feed.giftsLabel).toBe('12 gifts');
    expect(feed.chatLines[0]).toBe('Alex: hi');
    expect(hasNativeOverlayWidgets(feed)).toBe(true);
  });

  test('https art only; ignores unknown keys', () => {
    const feed = parseStudioOverlayFeedNative({
      v: 2,
      overlays: { jukebox: true },
      jukeboxArt: 'http://evil.example/cover.jpg',
      jukeboxTitle: 'Track',
      themeCss: 'body{display:none}',
      chatLines: [{ name: 'x', text: 'y' }],
      extraUnknown: 1,
    });
    expect(feed.jukeboxArt).toBeNull();
    expect(feed.jukeboxTitle).toBe('Track');
    expect(feed.themeCss).toBeUndefined();
    expect(feed.chatLines).toEqual(['x: y']);
    expect(feed.extraUnknown).toBeUndefined();

    const httpsFeed = parseStudioOverlayFeedNative({
      v: 1,
      jukeboxArt: 'https://i.scdn.co/image/ab.png',
    });
    expect(httpsFeed.jukeboxArt).toBe('https://i.scdn.co/image/ab.png');
  });

  test('portrait lock / taller phone uses positionsPortrait', () => {
    expect(phoneOverlayAspect(390, 844)).toBe('portrait');
    expect(phoneOverlayAspect(844, 390)).toBe('landscape');
    const feed = parseStudioOverlayFeedNative(
      {
        v: 1,
        overlays: { jukebox: true },
        positions: { jukebox: { x: 10, y: 10, scale: 1 } },
        positionsPortrait: { jukebox: { x: 3, y: 80, scale: 0.52 } },
        positionsLandscape: { jukebox: { x: 70, y: 20, scale: 1 } },
      },
      { aspect: 'portrait' },
    );
    expect(feed.positions.jukebox.x).toBe(3);
    expect(feed.positions.jukebox.y).toBe(80);
    const land = parseStudioOverlayFeedNative(
      {
        v: 1,
        overlays: { jukebox: true },
        positionsPortrait: { jukebox: { x: 3, y: 80, scale: 0.52 } },
        positionsLandscape: { jukebox: { x: 70, y: 20, scale: 1 } },
      },
      { aspect: 'landscape' },
    );
    expect(land.positions.jukebox.x).toBe(70);
  });
});

describe('hostTop9OverlayFlags', () => {
  test('absent feed keeps Host+9 chrome on', () => {
    const flags = hostTop9OverlayFlags(null);
    expect(flags.gifters).toBe(true);
    expect(flags.chat).toBe(true);
    expect(flags.gifts).toBe(true);
    expect(flags.goal).toBe(true);
    expect(flags.viewers).toBe(true);
    expect(flags.jukebox).toBe(false);
    expect(flags.qr).toBe(false);
  });

  test('missing overlay keys keep defaults; explicit false hides chrome', () => {
    expect(hostTop9OverlayFlags({ overlays: { gifters: false } }).gifters).toBe(false);
    expect(hostTop9OverlayFlags({ overlays: { gifters: false } }).chat).toBe(true);
    expect(hostTop9OverlayFlags({ overlays: { chat: true } }).chat).toBe(true);
  });
});

describe('clampOverlayBox', () => {
  test('keeps widget inside inset layer', () => {
    const placed = clampOverlayBox(90, 90, 172, 80, 390, 844);
    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.top).toBeGreaterThanOrEqual(0);
    expect(placed.left + 172).toBeLessThanOrEqual(390);
    expect(placed.top + 80).toBeLessThanOrEqual(844);
  });
});
