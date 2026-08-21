// liveDashboardService.js
//
// Stage Desk — infinitely customizable host live chrome.
// Persisted under `blyp.prefs.liveDashboard` via userPreferencesService.

import {
  getPreferences,
  subscribePreferences,
} from './userPreferencesService';
import { isLiveDashboardProFlagOn } from '../config/LiveDashboardFlags';

export const LIVE_DASHBOARD_VERSION = 1;

/** Product name shown in host UI. */
export const STAGE_DESK_NAME = 'Stage Desk';

export const FREE_SLOT_LIMIT = 6;
export const PRO_SLOT_LIMIT = 12;

export const ALERT_THEMES = [
  { id: 'pulse', label: 'Pulse', accent: '#FF2D55', blurb: 'Blyp teal alerts' },
  { id: 'neon', label: 'Neon', accent: '#67E8F9', blurb: 'Electric cyan pop' },
  { id: 'ember', label: 'Ember', accent: '#FB7185', blurb: 'Rose heat for gifts' },
  { id: 'gold', label: 'Gold', accent: '#FBBF24', blurb: 'Warm highlight rail' },
];

/**
 * Widget catalog. `tier: 'pro'` requires Blyp Plus / trial or the pro feature flag.
 * `surface: 'chrome'` widgets can render as on-stream host chrome when pinned.
 */
export const STAGE_DESK_CATALOG = [
  {
    type: 'giftAlerts',
    title: 'Gift alerts',
    blurb: 'Cinema + toast style for incoming gifts',
    icon: 'gift',
    category: 'alerts',
    tier: 'core',
    surface: 'chrome',
  },
  {
    type: 'comboTicker',
    title: 'Combo ticker',
    blurb: 'Streak counter when gifters chain gifts',
    icon: 'flash',
    category: 'alerts',
    tier: 'core',
    surface: 'chrome',
  },
  {
    type: 'goalBar',
    title: 'Goal bar',
    blurb: 'Coin / gift progress toward your stream goal',
    icon: 'trending-up',
    category: 'goals',
    tier: 'core',
    surface: 'chrome',
  },
  {
    type: 'topGifters',
    title: 'Top gifters',
    blurb: 'Leaderboard of supporters this stream',
    icon: 'trophy',
    category: 'social',
    tier: 'core',
    surface: 'chrome',
  },
  {
    type: 'chatHighlight',
    title: 'Chat highlight',
    blurb: 'Pin standout comments for yourself',
    icon: 'chatbubble-ellipses',
    category: 'chat',
    tier: 'core',
    surface: 'chrome',
  },
  {
    type: 'quickReplies',
    title: 'Quick replies',
    blurb: 'One-tap host chat responses',
    icon: 'happy-outline',
    category: 'chat',
    tier: 'core',
    surface: 'panel',
  },
  {
    type: 'guestInvites',
    title: 'Guest invites',
    blurb: 'Pull followers onto the stage',
    icon: 'person-add',
    category: 'guests',
    tier: 'core',
    surface: 'panel',
  },
  {
    type: 'battleControls',
    title: 'Battle controls',
    blurb: 'Challenge guests and track battle state',
    icon: 'flame',
    category: 'battles',
    tier: 'core',
    surface: 'panel',
  },
  {
    type: 'layoutPicker',
    title: 'Layout picker',
    blurb: 'Bottom · Focus · Equal · Split',
    icon: 'grid',
    category: 'stage',
    tier: 'core',
    surface: 'panel',
  },
  {
    type: 'mediaControls',
    title: 'Mic & camera',
    blurb: 'Mute, flip, and video cut',
    icon: 'videocam',
    category: 'stage',
    tier: 'core',
    surface: 'panel',
  },
  {
    type: 'sharePromote',
    title: 'Share & promote',
    blurb: 'Share the room and boost reach',
    icon: 'share-social',
    category: 'growth',
    tier: 'core',
    surface: 'panel',
  },
  {
    type: 'sessionStats',
    title: 'Session pulse',
    blurb: 'Viewers, hearts, and gift totals',
    icon: 'pulse',
    category: 'stats',
    tier: 'core',
    surface: 'chrome',
  },
  {
    type: 'marbleRace',
    title: 'Marble Race',
    blurb: 'Guest Grand Prix controls when live',
    icon: 'game-controller',
    category: 'games',
    tier: 'pro',
    surface: 'panel',
  },
  {
    type: 'teamShoutouts',
    title: 'Team shoutouts',
    blurb: 'Fire scripted thanks to top fans',
    icon: 'megaphone',
    category: 'social',
    tier: 'pro',
    surface: 'panel',
  },
  {
    type: 'subscriberBadges',
    title: 'Subscriber badges',
    blurb: 'Highlight Plus / sub viewers in chat',
    icon: 'ribbon',
    category: 'subs',
    tier: 'pro',
    surface: 'chrome',
  },
  {
    type: 'soundAlerts',
    title: 'Sound alerts',
    blurb: 'Play cues on gifts and joins (device)',
    icon: 'volume-high',
    category: 'alerts',
    tier: 'pro',
    surface: 'panel',
  },
  {
    type: 'alertTheme',
    title: 'Alert theme',
    blurb: 'Accent palette for gift & goal chrome',
    icon: 'color-palette',
    category: 'look',
    tier: 'pro',
    surface: 'panel',
  },
];

const CATALOG_BY_TYPE = new Map(STAGE_DESK_CATALOG.map((w) => [w.type, w]));

export function getCatalogEntry(type) {
  return CATALOG_BY_TYPE.get(type) || null;
}

export function getSlotLimit(isPro) {
  return isPro ? PRO_SLOT_LIMIT : FREE_SLOT_LIMIT;
}

/** Plus / trial OR explicit feature flag unlocks Pro catalog + higher slot cap. */
export function resolveStageDeskPro({ entitled = false } = {}) {
  return !!entitled || isLiveDashboardProFlagOn();
}

function uidSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeWidget(type, config = {}) {
  return {
    id: `sd_${type}_${uidSuffix()}`,
    type,
    enabled: true,
    config: config && typeof config === 'object' ? { ...config } : {},
  };
}

function sanitizeConfig(type, config) {
  const c = config && typeof config === 'object' ? { ...config } : {};
  if (type === 'goalBar') {
    const target = Math.max(1, Math.min(1_000_000, Number(c.target) || 500));
    const label = typeof c.label === 'string' && c.label.trim() ? c.label.trim().slice(0, 40) : 'Gift goal';
    return { target, label };
  }
  if (type === 'quickReplies') {
    const defaults = ['Thanks for the gift!', 'Welcome!', 'Who wants on stage?', 'Drop a heart'];
    const replies = Array.isArray(c.replies)
      ? c.replies.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim().slice(0, 80)).slice(0, 8)
      : defaults;
    return { replies: replies.length ? replies : defaults };
  }
  if (type === 'alertTheme' || type === 'giftAlerts') {
    const themeId = ALERT_THEMES.some((t) => t.id === c.themeId) ? c.themeId : 'pulse';
    return { themeId };
  }
  if (type === 'soundAlerts') {
    return { enabled: c.enabled !== false };
  }
  if (type === 'teamShoutouts') {
    const lines = Array.isArray(c.lines)
      ? c.lines.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim().slice(0, 100)).slice(0, 6)
      : ['Shoutout to our top gifters!', 'Love this squad — keep it going'];
    return { lines: lines.length ? lines : ['Shoutout to our top gifters!'] };
  }
  return {};
}

/** Sensible default Stage Desk for a new host. */
export function buildDefaultLiveDashboard() {
  return {
    version: LIVE_DASHBOARD_VERSION,
    themeId: 'pulse',
    widgets: [
      makeWidget('sessionStats'),
      makeWidget('giftAlerts', { themeId: 'pulse' }),
      makeWidget('goalBar', { target: 500, label: 'Gift goal' }),
      makeWidget('topGifters'),
      makeWidget('layoutPicker'),
      makeWidget('guestInvites'),
      makeWidget('mediaControls'),
      makeWidget('quickReplies'),
    ],
  };
}

export function normalizeLiveDashboard(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.widgets) || raw.widgets.length === 0) {
    return buildDefaultLiveDashboard();
  }

  const seenTypes = new Set();
  const widgets = [];
  for (const w of raw.widgets) {
    if (!w || typeof w.type !== 'string' || !CATALOG_BY_TYPE.has(w.type)) continue;
    if (seenTypes.has(w.type)) continue;
    seenTypes.add(w.type);
    widgets.push({
      id: typeof w.id === 'string' && w.id ? w.id : `sd_${w.type}_${uidSuffix()}`,
      type: w.type,
      enabled: w.enabled !== false,
      config: sanitizeConfig(w.type, w.config),
    });
  }

  if (widgets.length === 0) return buildDefaultLiveDashboard();

  const themeId = ALERT_THEMES.some((t) => t.id === raw.themeId) ? raw.themeId : 'pulse';

  return {
    version: LIVE_DASHBOARD_VERSION,
    themeId,
    widgets,
  };
}

export function getEnabledWidgets(layout, { isPro = false } = {}) {
  const widgets = layout?.widgets;
  if (!Array.isArray(widgets)) return [];
  const limit = getSlotLimit(isPro);
  const out = [];
  for (const w of widgets) {
    if (!w || w.enabled === false) continue;
    const meta = getCatalogEntry(w.type);
    if (!meta) continue;
    if (meta.tier === 'pro' && !isPro) continue;
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

export function getChromeWidgets(layout, opts) {
  return getEnabledWidgets(layout, opts).filter((w) => getCatalogEntry(w.type)?.surface === 'chrome');
}

export function listAddableWidgets(layout, { isPro = false } = {}) {
  const present = new Set((layout?.widgets || []).map((w) => w.type));
  return STAGE_DESK_CATALOG.filter((c) => {
    if (present.has(c.type)) return false;
    if (c.tier === 'pro' && !isPro) return false;
    return true;
  });
}

export function listLockedProWidgets(layout) {
  const present = new Set((layout?.widgets || []).map((w) => w.type));
  return STAGE_DESK_CATALOG.filter((c) => c.tier === 'pro' && !present.has(c.type));
}

export function getTheme(themeId) {
  return ALERT_THEMES.find((t) => t.id === themeId) || ALERT_THEMES[0];
}

export async function getLiveDashboard(uid) {
  const prefs = await getPreferences(uid);
  return normalizeLiveDashboard(prefs.liveDashboard);
}

export function subscribeLiveDashboard(uid, cb) {
  return subscribePreferences(uid, (prefs) => {
    try {
      cb(normalizeLiveDashboard(prefs?.liveDashboard));
    } catch {
      /* ignore */
    }
  });
}

export async function setLiveDashboard(uid, layout) {
  const { setLiveDashboard: persist } = await import('./userPreferencesService');
  const normalized = normalizeLiveDashboard(layout);
  return persist(uid, normalized);
}

export async function reorderLiveDashboardWidget(uid, widgetId, direction) {
  const layout = await getLiveDashboard(uid);
  const idx = layout.widgets.findIndex((w) => w.id === widgetId);
  if (idx < 0) return layout;
  const j = idx + direction;
  if (j < 0 || j >= layout.widgets.length) return layout;
  const next = [...layout.widgets];
  [next[idx], next[j]] = [next[j], next[idx]];
  return setLiveDashboard(uid, { ...layout, widgets: next });
}

export async function setLiveDashboardWidgetEnabled(uid, widgetId, enabled) {
  const layout = await getLiveDashboard(uid);
  const widgets = layout.widgets.map((w) =>
    w.id === widgetId ? { ...w, enabled: !!enabled } : w
  );
  return setLiveDashboard(uid, { ...layout, widgets });
}

export async function removeLiveDashboardWidget(uid, widgetId) {
  const layout = await getLiveDashboard(uid);
  const widgets = layout.widgets.filter((w) => w.id !== widgetId);
  return setLiveDashboard(uid, { ...layout, widgets });
}

export async function addLiveDashboardWidget(uid, type, config, { isPro = false } = {}) {
  const meta = getCatalogEntry(type);
  if (!meta) return getLiveDashboard(uid);
  if (meta.tier === 'pro' && !isPro) return getLiveDashboard(uid);
  const layout = await getLiveDashboard(uid);
  if (layout.widgets.some((w) => w.type === type)) return layout;
  const widget = makeWidget(type, config);
  return setLiveDashboard(uid, { ...layout, widgets: [...layout.widgets, widget] });
}

export async function updateLiveDashboardWidgetConfig(uid, widgetId, configPatch) {
  const layout = await getLiveDashboard(uid);
  const widgets = layout.widgets.map((w) => {
    if (w.id !== widgetId) return w;
    const merged = sanitizeConfig(w.type, { ...(w.config || {}), ...(configPatch || {}) });
    return { ...w, config: merged };
  });
  return setLiveDashboard(uid, { ...layout, widgets });
}

export async function setLiveDashboardTheme(uid, themeId) {
  const layout = await getLiveDashboard(uid);
  const nextTheme = ALERT_THEMES.some((t) => t.id === themeId) ? themeId : layout.themeId;
  return setLiveDashboard(uid, { ...layout, themeId: nextTheme });
}

export async function resetLiveDashboard(uid) {
  return setLiveDashboard(uid, buildDefaultLiveDashboard());
}

export default {
  LIVE_DASHBOARD_VERSION,
  STAGE_DESK_NAME,
  FREE_SLOT_LIMIT,
  PRO_SLOT_LIMIT,
  ALERT_THEMES,
  STAGE_DESK_CATALOG,
  getCatalogEntry,
  getSlotLimit,
  resolveStageDeskPro,
  makeWidget,
  buildDefaultLiveDashboard,
  normalizeLiveDashboard,
  getEnabledWidgets,
  getChromeWidgets,
  listAddableWidgets,
  listLockedProWidgets,
  getTheme,
  getLiveDashboard,
  subscribeLiveDashboard,
  setLiveDashboard,
  reorderLiveDashboardWidget,
  setLiveDashboardWidgetEnabled,
  removeLiveDashboardWidget,
  addLiveDashboardWidget,
  updateLiveDashboardWidgetConfig,
  setLiveDashboardTheme,
  resetLiveDashboard,
};
