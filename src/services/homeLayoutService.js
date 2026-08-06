// homeLayoutService.js
//
// Home Layout Engine — ordered widgets for the Home hub (`HomeBasePanel`).
// Persisted under `blyp.prefs.homeLayout` via userPreferencesService so
// AsyncStorage + Firestore stay the single prefs rail.

import {
  getPreferences,
  subscribePreferences,
} from './userPreferencesService';

export const HOME_LAYOUT_VERSION = 1;

/** Widget types available in the catalog. */
export const WIDGET_CATALOG = [
  {
    type: 'suggestions',
    title: 'Smart suggestions',
    blurb: 'Ask Blyp prompts tuned to your interests',
    icon: 'sparkles-outline',
    category: 'assist',
  },
  {
    type: 'recentSearches',
    title: 'Recent searches',
    blurb: 'Jump back into what you asked',
    icon: 'time-outline',
    category: 'assist',
  },
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
    blurb: 'Pin Football, F1, and other interest pages',
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

/** Default layout for new users — coherent social home, not a junk drawer. */
export function buildDefaultHomeLayout(interestIds = []) {
  const sportKeys = (interestIds || [])
    .filter((id) => id === 'football' || id === 'f1' || id === 'sport')
    .map((id) => `topic:${id}`);
  const topicKeys = (interestIds || []).map((id) => `topic:${id}`);
  const pageKeys = sportKeys.length ? sportKeys : topicKeys.slice(0, 4);

  return {
    version: HOME_LAYOUT_VERSION,
    widgets: [
      makeWidget('suggestions'),
      makeWidget('recentSearches'),
      makeWidget('forYou'),
      makeWidget('continueWatching'),
      makeWidget('liveNow'),
      makeWidget('sportPages', { pageKeys }),
      makeWidget('quickDm', { peopleIds: [] }),
      makeWidget('trending'),
      makeWidget('creators'),
      makeWidget('clubs'),
      makeWidget('clubPeople'),
      makeWidget('battles'),
      makeWidget('rankings'),
      makeWidget('quickActions'),
      makeWidget('interests'),
      makeWidget('pageList'),
    ],
  };
}

function sanitizeConfig(type, config) {
  const c = config && typeof config === 'object' ? { ...config } : {};
  if (type === 'sportPages') {
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

  const seenTypes = new Set();
  const widgets = [];
  for (const w of raw.widgets) {
    if (!w || typeof w.type !== 'string' || !CATALOG_BY_TYPE.has(w.type)) continue;
    // One instance per type for P0 — keeps the home coherent.
    if (seenTypes.has(w.type)) continue;
    seenTypes.add(w.type);
    widgets.push({
      id: typeof w.id === 'string' && w.id ? w.id : `w_${w.type}_${uidSuffix()}`,
      type: w.type,
      enabled: w.enabled !== false,
      config: sanitizeConfig(w.type, w.config),
    });
  }

  if (widgets.length === 0) return buildDefaultHomeLayout(interestIds);

  // Heal: ensure sportPages / quickDm exist so customization always offers them.
  for (const required of ['sportPages', 'quickDm', 'forYou', 'liveNow']) {
    if (!seenTypes.has(required)) {
      const extra =
        required === 'sportPages'
          ? makeWidget('sportPages', {
              pageKeys: (interestIds || []).slice(0, 4).map((id) => `topic:${id}`),
            })
          : makeWidget(required);
      widgets.push(extra);
      seenTypes.add(required);
    }
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
  return persist(uid, normalized);
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
  const widgets = layout.widgets.filter((w) => w.id !== widgetId);
  return setHomeLayout(uid, { ...layout, widgets });
}

export async function addHomeWidget(uid, type, config) {
  if (!CATALOG_BY_TYPE.has(type)) return getHomeLayout(uid);
  const layout = await getHomeLayout(uid);
  if (layout.widgets.some((w) => w.type === type)) return layout;
  const widget = makeWidget(type, config);
  return setHomeLayout(uid, { ...layout, widgets: [...layout.widgets, widget] });
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
