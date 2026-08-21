/**
 * Phone Studio overlay feed. Do not copy web normalizeFeed / DEFAULT_OVERLAYS —
 * those turn chat/gifts on and jukebox off.
 *
 * Shared shape with Firestore `liveStreams/{id}.studioOverlayFeed`.
 */

/** Floating widgets StudioWatchOverlays can paint. Chat/gifts/viewers bind Host+9 chrome. */
const PHONE_IDS = [
  'jukebox',
  'gifters',
  'goal',
  'events',
  'chat',
  'gifts',
  'timer',
  'viewers',
  'qr',
];

/** Host+9 chrome defaults when studioOverlayFeed is absent (menu not mirrored yet). */
export const HOST_TOP9_DEFAULT_OVERLAYS = {
  gifters: true,
  goal: true,
  chat: true,
  gifts: true,
  jukebox: false,
  events: true,
  timer: true,
  viewers: true,
  qr: false,
};

/** Same S-preset origins as web program overlays. Do not shift jukebox off-stage. */
const FALLBACK_POS = {
  gifters: { x: 2, y: 2, scale: 0.52 },
  goal: { x: 2, y: 78, scale: 0.52 },
  jukebox: { x: 3, y: 86, scale: 0.52 },
  events: { x: 2, y: 48, scale: 0.52 },
  chat: { x: 62, y: 78, scale: 0.52 },
  gifts: { x: 72, y: 62, scale: 0.52 },
  timer: { x: 78, y: 2, scale: 0.52 },
  viewers: { x: 40, y: 2, scale: 0.52 },
  qr: { x: 78, y: 40, scale: 0.52 },
};

const WEB_SCALE_S = 0.52;

/**
 * Web S (0.52) shrinks a large CSS card. Native cards are already phone-sized,
 * so S renders at 1× or the jukebox lower-third is unreadable.
 */
export function phoneWidgetScale(hostScale) {
  const s = Number(hostScale);
  const base = Number.isFinite(s) ? s : WEB_SCALE_S;
  return Math.min(2.5, Math.max(0.7, base / WEB_SCALE_S));
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(95, Math.max(0, n));
}

function clampScale(n) {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.75, Math.max(0.4, n));
}

function readPos(id, raw) {
  const d = FALLBACK_POS[id];
  return {
    x: typeof raw?.x === 'number' ? clampPct(raw.x) : d.x,
    y: typeof raw?.y === 'number' ? clampPct(raw.y) : d.y,
    scale: typeof raw?.scale === 'number' ? clampScale(raw.scale) : d.scale,
  };
}

export function httpsArtUrl(url) {
  if (typeof url !== 'string') return null;
  const t = url.trim();
  if (t.length < 12 || t.length > 2048) return null;
  if (!/^https:\/\//i.test(t)) return null;
  return t;
}

function parseEvents(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const ev of raw) {
    if (!ev || typeof ev !== 'object') continue;
    const text = typeof ev.text === 'string' ? ev.text.trim() : '';
    if (!text) continue;
    const id = typeof ev.id === 'string' && ev.id ? ev.id : `ev-${out.length}`;
    out.push({
      id,
      text,
      at: typeof ev.at === 'number' && Number.isFinite(ev.at) ? ev.at : 0,
    });
    if (out.length >= 4) break;
  }
  return out;
}

function parseGifters(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => (g == null ? '' : String(g).trim()))
    .filter(Boolean)
    .slice(0, 5);
}

/** Portrait lock / missing size → portrait map. Wider than tall → landscape. */
export function phoneOverlayAspect(width, height) {
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'portrait';
  return h >= w ? 'portrait' : 'landscape';
}

export const pickPhoneOverlayAspect = phoneOverlayAspect;

const FLOATING_IDS = ['jukebox', 'gifters', 'goal', 'events', 'timer', 'qr'];

export function hasNativeOverlayWidgets(feed, omit) {
  const o = feed?.overlays;
  if (!o) return false;
  const skip = omit instanceof Set ? omit : new Set(Array.isArray(omit) ? omit : []);
  return FLOATING_IDS.some((id) => !skip.has(id) && o[id] === true);
}

/** Studio menu flags for Host+9 chrome. Raw feed; missing keys keep defaults. */
export function hostTop9OverlayFlags(rawFeed) {
  const base = { ...HOST_TOP9_DEFAULT_OVERLAYS };
  const flags = rawFeed?.overlays;
  if (!flags || typeof flags !== 'object') return base;
  for (const id of Object.keys(base)) {
    if (typeof flags[id] === 'boolean') base[id] = flags[id];
  }
  return base;
}

/**
 * Clamp a widget's top-left into the inset layer so the full bbox stays inside.
 * boxW/boxH must already include visual scale.
 */
export function clampOverlayBox(xPct, yPct, boxW, boxH, layerW, layerH) {
  const w = Math.max(0, Number(layerW) || 0);
  const h = Math.max(0, Number(layerH) || 0);
  const bw = Math.max(0, Number(boxW) || 0);
  const bh = Math.max(0, Number(boxH) || 0);
  const left = (Number(xPct) / 100) * w;
  const top = (Number(yPct) / 100) * h;
  const maxX = Math.max(0, w - bw);
  const maxY = Math.max(0, h - bh);
  return {
    left: Math.min(maxX, Math.max(0, Number.isFinite(left) ? left : 0)),
    top: Math.min(maxY, Math.max(0, Number.isFinite(top) ? top : 0)),
  };
}

export function clampOverlayBBox({
  xPct,
  yPct,
  scale,
  widgetW,
  widgetH,
  layerW,
  layerH,
}) {
  const s = phoneWidgetScale(scale);
  return {
    ...clampOverlayBox(
      xPct,
      yPct,
      (Number(widgetW) || 0) * s,
      (Number(widgetH) || 0) * s,
      layerW,
      layerH,
    ),
    scale: s,
  };
}

/**
 * @returns {object|null} null → render nothing (absent / bad version).
 */
export function parseStudioOverlayFeedNative(raw, opts) {
  if (!raw || typeof raw !== 'object') return null;
  const v = Number(raw.v);
  if (!Number.isFinite(v) || v < 1) return null;

  const aspect = opts?.aspect === 'landscape' ? 'landscape' : 'portrait';
  const flags = raw.overlays && typeof raw.overlays === 'object' ? raw.overlays : {};
  const overlays = {
    jukebox: flags.jukebox === true,
    gifters: flags.gifters === true,
    goal: flags.goal === true,
    events: flags.events === true,
    chat: flags.chat === true,
    gifts: flags.gifts === true,
    timer: flags.timer === true,
    viewers: flags.viewers === true,
    qr: flags.qr === true,
  };

  const posMap =
    aspect === 'portrait'
      ? raw.positionsPortrait || raw.positions
      : raw.positionsLandscape || raw.positions;
  const positions = {};
  for (const id of PHONE_IDS) {
    positions[id] = readPos(id, posMap && typeof posMap === 'object' ? posMap[id] : undefined);
  }

  const goalPct =
    typeof raw.goalPct === 'number' && Number.isFinite(raw.goalPct)
      ? Math.min(100, Math.max(0, raw.goalPct))
      : 0;

  return {
    v: 1,
    overlays,
    positions,
    gifters: parseGifters(raw.gifters),
    goalPct,
    goalLabel:
      typeof raw.goalLabel === 'string' && raw.goalLabel.trim()
        ? raw.goalLabel.trim()
        : 'Stream goal',
    jukeboxNow: typeof raw.jukeboxNow === 'string' ? raw.jukeboxNow : '',
    jukeboxArt: httpsArtUrl(raw.jukeboxArt),
    jukeboxTitle: typeof raw.jukeboxTitle === 'string' ? raw.jukeboxTitle : '',
    jukeboxArtist: typeof raw.jukeboxArtist === 'string' ? raw.jukeboxArtist : '',
    jukeboxNext: typeof raw.jukeboxNext === 'string' ? raw.jukeboxNext : '',
    jukeboxPaused: raw.jukeboxPaused === true,
    events: parseEvents(raw.events),
    timerLabel:
      typeof raw.timerLabel === 'string' && raw.timerLabel.trim()
        ? raw.timerLabel.trim().slice(0, 16)
        : '00:00:00',
    viewers:
      typeof raw.viewers === 'number' && Number.isFinite(raw.viewers)
        ? Math.max(0, Math.floor(raw.viewers))
        : 0,
    watchUrl:
      typeof raw.watchUrl === 'string' && /^https:\/\//i.test(raw.watchUrl.trim())
        ? raw.watchUrl.trim().slice(0, 240)
        : '',
    giftsLabel:
      typeof raw.giftsLabel === 'string' && raw.giftsLabel.trim()
        ? raw.giftsLabel.trim().slice(0, 48)
        : 'Gift alerts',
    chatLines: parseGifters(
      Array.isArray(raw.chatLines)
        ? raw.chatLines.map((c) => {
            if (!c || typeof c !== 'object') return '';
            const name = typeof c.name === 'string' ? c.name.trim() : '';
            const text = typeof c.text === 'string' ? c.text.trim() : '';
            if (!text) return '';
            return name ? `${name}: ${text}` : text;
          })
        : [],
    ),
  };
}

export const parseStudioOverlayFeed = parseStudioOverlayFeedNative;
