// homeLayoutService.js
//
// Home Layout Engine — ordered widgets for the Home hub (`HomeBasePanel`).
// Persisted under `blyp.prefs.homeLayout` via userPreferencesService so
// AsyncStorage + Firestore stay the single prefs rail.

import {
  getPreferences,
  subscribePreferences,
} from './userPreferencesService';

export const HOME_LAYOUT_VERSION = 3;

/** Types retired from Home chrome — history lives in the search-bar dropdown only. */
export const RETIRED_HOME_WIDGET_TYPES = new Set(['suggestions', 'recentSearches']);

/**
 * Promo / catalog chrome stripped on v2→v3 so tip Home is video-first.
 * Still available in WIDGET_CATALOG for Edit Home re-add.
 */
export const DEFAULT_STRIP_WIDGET_TYPES = new Set([
  'clubs',
  'clubPeople',
  'battles',
  'rankings',
  'quickActions',
  'interests',
  'pageList',
]);

/** Always present on Home — hide/disable, never silently re-add after user remove. */
export const CORE_HOME_WIDGET_TYPES = new Set([
  'forYou',
  'continueWatching',
  'liveNow',
  'quickDm',
]);

/** Widget types available in the catalog. */
export const WIDGET_CATALOG = [
  {
    type: 'forYou',
    title: 'For you',
    blurb: 'Personalized video preview rail',
    icon: 'play-circle-outline',
    category: 'feed',
  },
  {
    type: 'continueWatching',
    title: 'Continue watching',
    blurb: 'Pick up where you left off',
    icon: 'play-forward-outline',
    category: 'feed',
  },
  {
    type: 'liveNow',
    title: 'Live now',
    blurb: 'Streams happening right now',
    icon: 'radio-outline',
    category: 'live',
  },
  {
    type: 'trending',
    title: 'Trending now',
    blurb: 'What’s heating up on Blyp',
    icon: 'flash-outline',
    category: 'feed',
  },
  {
    type: 'creators',
    title: 'Creators to follow',
    blurb: 'People matched to your taste',
    icon: 'people-outline',
    category: 'people',
  },
  {
    type: 'sportPages',
    title: 'Your pages',
    blurb: 'Pages you follow — hidden when empty',
    icon: 'football-outline',
    category: 'pages',
    configurable: true,
  },
  {
    type: 'quickDm',
    title: 'Quick messages',
    blurb: 'Message favorites or recent chats from Home',
    icon: 'chatbubbles-outline',
    category: 'people',
    configurable: true,
  },
  {
    type: 'clubs',
    title: 'Clubs',
    blurb: 'Your clubs and ones to explore',
    icon: 'shield-outline',
    category: 'identity',
  },
  {
    type: 'clubPeople',
    title: 'People in your clubs',
    blurb: 'Fans who share your clubs',
    icon: 'person-outline',
    category: 'people',
  },
  {
    type: 'quickActions',
    title: 'Jump in',
    blurb: 'Shortcuts into Live, Dating, Rankings, and more',
    icon: 'grid-outline',
    category: 'actions',
  },
  {
    type: 'interests',
    title: 'Your interests',
    blurb: 'Open any interest page you’ve joined',
    icon: 'heart-outline',
    category: 'pages',
  },
  {
    type: 'pageList',
    title: 'All pages',
    blurb: 'Full list of Home tabs and topic pages',
    icon: 'list-outline',
    category: 'pages',
  },
  {
    type: 'battles',
    title: 'Battles',
    blurb: 'Jump into live battles',
    icon: 'flame-outline',
    category: 'actions',
  },
  {
    type: 'rankings',
    title: 'Rankings',
    blurb: 'Leaderboards and standings',
    icon: 'trophy-outline',
    category: 'actions',
  },
];

const CATALOG_BY_TYPE = new Map(WIDGET_CATALOG.map((w) => [w.type, w]));

export function getCatalogEntry(type) {
  return CATALOG_BY_TYPE.get(type) || null;
}

function uidSuffix() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeWidget(type, config = {}) {
  return {
    id: `w_${type}_${uidSuffix()}`,
    type,
    enabled: true,
    config: config && typeof config === 'object' ? { ...config } : {},
  };
}

/** Default layout for new users — video-first home, not a junk drawer. */
export function buildDefaultHomeLayout(interestIds = []) {
  void interestIds;
  return {
    version: HOME_LAYOUT_VERSION,
    widgets: [
      makeWidget('forYou'),
      makeWidget('continueWatching'),
      makeWidget('liveNow'),
      makeWidget('quickDm', { peopleIds: [] }),
      makeWidget('trending'),
      makeWidget('creators'),
      // Clubs / battles / rankings / jump-in / page lists stay in the catalog
      // for Edit Home — not forced into the default feed chrome.
    ],
  };
}

function sanitizeConfig(type, config, { clearSportPins = false } = {}) {
  const c = config && typeof config === 'object' ? { ...config } : {};
  if (type === 'sportPages') {
    if (clearSportPins) {
      // v1→v2: interest-auto Football/F1 pins looked like junk. Hide until re-pin.
      return { pageKeys: [] };
    }
    const keys = Array.isArray(c.pageKeys)
      ? c.pageKeys.filter((k) => typeof k === 'string' && k.startsWith('topic:')).slice(0, 12)
      : [];
    return { pageKeys: keys };
  }
  if (type === 'quickDm') {
    const peopleIds = Array.isArray(c.peopleIds)
      ? c.peopleIds.filter((id) => typeof id === 'string' && id.length > 0).slice(0, 16)
      : [];
    return { peopleIds };
  }
  return {};
}

export function normalizeHomeLayout(raw, interestIds = []) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.widgets) || raw.widgets.length === 0) {
    return buildDefaultHomeLayout(interestIds);
  }

  const clearSportPins = !raw.version || Number(raw.version) < 2;
  const stripDefaultJunk = !raw.version || Number(raw.version) < 3;
  const seenTypes = new Set();
  const widgets = [];
  for (const w of raw.widgets) {
    if (!w || typeof w.type !== 'string') continue;
    // Strip retired chip rows — search history lives under the Blyp bar dropdown.
    if (RETIRED_HOME_WIDGET_TYPES.has(w.type)) continue;
    // v3: drop auto-default promo sections; users can re-add from Edit Home.
    if (stripDefaultJunk && DEFAULT_STRIP_WIDGET_TYPES.has(w.type)) continue;
    if (!CATALOG_BY_TYPE.has(w.type)) continue;
    // One instance per type for P0 — keeps the home coherent.
    if (seenTypes.has(w.type)) continue;
    seenTypes.add(w.type);
    widgets.push({
      id: typeof w.id === 'string' && w.id ? w.id : `w_${w.type}_${uidSuffix()}`,
      type: w.type,
      enabled: w.enabled !== false,
      config: sanitizeConfig(w.type, w.config, { clearSportPins }),
    });
  }

  if (widgets.length === 0) return buildDefaultHomeLayout(interestIds);

  // Always repair missing core rails (hide via enabled=false is fine; delete is not).
  for (const required of CORE_HOME_WIDGET_TYPES) {
    if (!seenTypes.has(required)) {
      widgets.push(makeWidget(required));
      seenTypes.add(required);
    }
  }

  // Force video-first lead only while migrating off junk defaults.
  if (stripDefaultJunk || clearSportPins) {
    const leadTypes = ['forYou', 'continueWatching', 'liveNow', 'quickDm'];
    const lead = [];
    const rest = [];
    const used = new Set();
    for (const t of leadTypes) {
      const w = widgets.find((x) => x.type === t);
      if (w) {
        lead.push(w);
        used.add(t);
      }
    }
    for (const w of widgets) {
      if (!used.has(w.type)) rest.push(w);
    }
    return {
      version: HOME_LAYOUT_VERSION,
      widgets: [...lead, ...rest],
    };
  }

  return {
    version: HOME_LAYOUT_VERSION,
    widgets,
  };
}

export function getEnabledWidgets(layout) {
  const widgets = layout?.widgets;
  if (!Array.isArray(widgets)) return [];
  return widgets.filter((w) => w && w.enabled !== false);
}

export function listAddableWidgets(layout) {
  const present = new Set((layout?.widgets || []).map((w) => w.type));
  return WIDGET_CATALOG.filter((c) => !present.has(c.type));
}

export async function getHomeLayout(uid) {
  const prefs = await getPreferences(uid);
  return normalizeHomeLayout(prefs.homeLayout, prefs.interests);
}

export function subscribeHomeLayout(uid, cb) {
  return subscribePreferences(uid, (prefs) => {
    try {
      cb(normalizeHomeLayout(prefs?.homeLayout, prefs?.interests));
    } catch {
      /* ignore */
    }
  });
}

export async function setHomeLayout(uid, layout) {
  const { setHomeLayout: persist } = await import('./userPreferencesService');
  const prefs = await getPreferences(uid);
  const normalized = normalizeHomeLayout(layout, prefs.interests);
  // persist() returns full prefs — callers expect { version, widgets }.
  await persist(uid, normalized);
  return normalized;
}

export async function reorderHomeWidget(uid, widgetId, direction) {
  const layout = await getHomeLayout(uid);
  const idx = layout.widgets.findIndex((w) => w.id === widgetId);
  if (idx < 0) return layout;
  const j = idx + direction;
  if (j < 0 || j >= layout.widgets.length) return layout;
  const next = [...layout.widgets];
  [next[idx], next[j]] = [next[j], next[idx]];
  return setHomeLayout(uid, { ...layout, widgets: next });
}

export async function setHomeWidgetEnabled(uid, widgetId, enabled) {
  const layout = await getHomeLayout(uid);
  const widgets = layout.widgets.map((w) =>
    w.id === widgetId ? { ...w, enabled: !!enabled } : w
  );
  return setHomeLayout(uid, { ...layout, widgets });
}

export async function removeHomeWidget(uid, widgetId) {
  const layout = await getHomeLayout(uid);
  const target = layout.widgets.find((w) => w.id === widgetId);
  if (!target) return layout;
  // Core rails cannot be deleted — hide instead so Edit Home controls tell the truth.
  if (CORE_HOME_WIDGET_TYPES.has(target.type)) {
    return setHomeWidgetEnabled(uid, widgetId, false);
  }
  const widgets = layout.widgets.filter((w) => w.id !== widgetId);
  return setHomeLayout(uid, { ...layout, widgets });
}

export async function addHomeWidget(uid, type, config) {
  if (!CATALOG_BY_TYPE.has(type)) return getHomeLayout(uid);
  const layout = await getHomeLayout(uid);
  // Re-enable if the type already exists but was hidden (core hide path).
  const existing = layout.widgets.find((w) => w.type === type);
  if (existing) {
    if (existing.enabled === false) {
      return setHomeWidgetEnabled(uid, existing.id, true);
    }
    return layout;
  }
  const widget = makeWidget(type, config);
  // Preserve every existing widget — never rebuild from defaults on add.
  const nextWidgets = [...layout.widgets, widget];
  return setHomeLayout(uid, {
    version: HOME_LAYOUT_VERSION,
    widgets: nextWidgets,
  });
}

export async function updateHomeWidgetConfig(uid, widgetId, configPatch) {
  const layout = await getHomeLayout(uid);
  const widgets = layout.widgets.map((w) => {
    if (w.id !== widgetId) return w;
    const merged = sanitizeConfig(w.type, { ...(w.config || {}), ...(configPatch || {}) });
    return { ...w, config: merged };
  });
  return setHomeLayout(uid, { ...layout, widgets });
}

export async function resetHomeLayout(uid) {
  const prefs = await getPreferences(uid);
  return setHomeLayout(uid, buildDefaultHomeLayout(prefs.interests));
}

export default {
  HOME_LAYOUT_VERSION,
  WIDGET_CATALOG,
  RETIRED_HOME_WIDGET_TYPES,
  DEFAULT_STRIP_WIDGET_TYPES,
  CORE_HOME_WIDGET_TYPES,
  getCatalogEntry,
  makeWidget,
  buildDefaultHomeLayout,
  normalizeHomeLayout,
  getEnabledWidgets,
  listAddableWidgets,
  getHomeLayout,
  subscribeHomeLayout,
  setHomeLayout,
  reorderHomeWidget,
  setHomeWidgetEnabled,
  removeHomeWidget,
  addHomeWidget,
  updateHomeWidgetConfig,
  resetHomeLayout,
};
