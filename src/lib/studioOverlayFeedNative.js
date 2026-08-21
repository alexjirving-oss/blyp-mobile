/**
 * Phone Studio overlay feed. Do not copy web normalizeFeed / DEFAULT_OVERLAYS —
 * those turn chat/gifts on and jukebox off.
 *
 * Shared shape with Firestore `liveStreams/{id}.studioOverlayFeed`.
 */

const PHONE_IDS = ['jukebox', 'gifters', 'goal', 'events'];

/** Same S-preset origins as web program overlays. Do not shift jukebox off-stage. */
const FALLBACK_POS = {
  gifters: { x: 2, y: 2, scale: 0.52 },
  goal: { x: 2, y: 78, scale: 0.52 },
  jukebox: { x: 3, y: 86, scale: 0.52 },
  events: { x: 2, y: 48, scale: 0.52 },
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

export function hasNativeOverlayWidgets(feed) {
  const o = feed?.overlays;
  if (!o) return false;
  return PHONE_IDS.some((id) => o[id] === true);
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
    chat: false,
    gifts: false,
    timer: false,
    viewers: false,
    qr: false,
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
  };
}

export const parseStudioOverlayFeed = parseStudioOverlayFeedNative;
