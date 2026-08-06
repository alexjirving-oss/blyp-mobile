// promoteCatalog.js
// Catalog-driven Promote Studio: method defs, targeting chips, reach estimates.
// Client merges server pricing.catalog over PROMOTE_CATALOG_FALLBACK.

export const PROMOTE_CATEGORIES = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'exclusive', label: 'Exclusive' },
  { id: 'battle', label: 'Battle' },
  { id: 'feed', label: 'Feed' },
  { id: 'profile', label: 'Profile' },
  { id: 'live', label: 'Live' },
  { id: 'search', label: 'Search' },
  { id: 'audience', label: 'Audience' },
]);

export const PROMOTE_SPORT_TARGETS = Object.freeze([
  { id: 'football', label: 'Football' },
  { id: 'basketball', label: 'Basketball' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'combat', label: 'Combat' },
  { id: 'motorsport', label: 'Motorsport' },
  { id: 'esports', label: 'Esports' },
]);

export const PROMOTE_GEO_TARGETS = Object.freeze([
  { id: 'local', label: 'Local' },
  { id: 'national', label: 'National' },
  { id: 'global', label: 'Global' },
]);

export const PROMOTE_INTEREST_TARGETS = Object.freeze([
  { id: 'highlights', label: 'Highlights' },
  { id: 'training', label: 'Training' },
  { id: 'fan', label: 'Fan culture' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'comedy', label: 'Comedy' },
]);

/** @type {ReadonlyArray<{ methodId: string, type: string, title: string, subtitle: string, category: string, packages: Array<{ id: string, label: string, hours: number, coins: number }>, needsPost?: boolean, needsBattle?: boolean, needsStream?: boolean, exclusiveCalendar?: boolean, charter?: boolean }>} */
export const PROMOTE_CATALOG_FALLBACK = Object.freeze([
  {
    methodId: 'spotlight',
    type: 'SPOTLIGHT',
    title: 'Spotlight',
    subtitle: 'Exclusive homepage spotlight window',
    category: 'exclusive',
    exclusiveCalendar: true,
    packages: [
      { id: '1h', label: '1 hour', hours: 1, coins: 500 },
      { id: '24h', label: '24 hours', hours: 24, coins: 5000 },
      { id: '7d', label: '7 days', hours: 168, coins: 25000 },
    ],
  },
  {
    methodId: 'time_slot',
    type: 'TIME_SLOT',
    title: 'Prime Time Slot',
    subtitle: 'Book an exclusive discovery slot',
    category: 'exclusive',
    exclusiveCalendar: true,
    packages: [
      { id: '30m', label: '30 min', hours: 0.5, coins: 250 },
      { id: '60m', label: '60 min', hours: 1, coins: 500 },
      { id: '120m', label: '2 hours', hours: 2, coins: 1000 },
    ],
  },
  {
    methodId: 'battle',
    type: 'BATTLE',
    title: 'Battle Boost+',
    subtitle: 'Amplify an upcoming or live battle',
    category: 'battle',
    needsBattle: true,
    packages: [{ id: '24h', label: '24 hours', hours: 24, coins: 100 }],
  },
  {
    methodId: 'feed_boost',
    type: 'FEED_BOOST',
    title: 'Feed Boost',
    subtitle: 'Charter boost for one post in For You',
    category: 'feed',
    needsPost: true,
    charter: true,
    packages: [
      { id: '6h', label: '6 hours', hours: 6, coins: 150 },
      { id: '24h', label: '24 hours', hours: 24, coins: 400 },
      { id: '72h', label: '3 days', hours: 72, coins: 900 },
    ],
  },
  {
    methodId: 'profile',
    type: 'PROFILE',
    title: 'Profile Amplify',
    subtitle: 'Surface your profile to interested fans',
    category: 'profile',
    packages: [
      { id: '12h', label: '12 hours', hours: 12, coins: 200 },
      { id: '48h', label: '48 hours', hours: 48, coins: 550 },
    ],
  },
  {
    methodId: 'live',
    type: 'LIVE',
    title: 'Live Amplify',
    subtitle: 'Push viewers toward your live session',
    category: 'live',
    needsStream: true,
    packages: [
      { id: '2h', label: '2 hours', hours: 2, coins: 300 },
      { id: '6h', label: '6 hours', hours: 6, coins: 700 },
    ],
  },
  {
    methodId: 'search',
    type: 'SEARCH_SPONSORED',
    title: 'Search Sponsored',
    subtitle: 'One labelled sponsored slot in search',
    category: 'search',
    packages: [
      { id: '12h', label: '12 hours', hours: 12, coins: 350 },
      { id: '48h', label: '48 hours', hours: 48, coins: 900 },
    ],
  },
  {
    methodId: 'followers',
    type: 'FOLLOWERS_NOTIFY',
    title: 'Followers Notify',
    subtitle: 'Nudge followers about new content',
    category: 'audience',
    packages: [
      { id: '6h', label: '6 hours', hours: 6, coins: 120 },
      { id: '24h', label: '24 hours', hours: 24, coins: 280 },
    ],
  },
  {
    methodId: 'team',
    type: 'TEAM_SHOUTOUT',
    title: 'Team Shoutout',
    subtitle: 'Reach fans of your team affinity',
    category: 'audience',
    packages: [
      { id: '12h', label: '12 hours', hours: 12, coins: 220 },
      { id: '48h', label: '48 hours', hours: 48, coins: 600 },
    ],
  },
  {
    methodId: 'cross_sport',
    type: 'CROSS_SPORT',
    title: 'Cross-Sport Push',
    subtitle: 'Cross into adjacent sport audiences',
    category: 'audience',
    packages: [
      { id: '12h', label: '12 hours', hours: 12, coins: 260 },
      { id: '48h', label: '48 hours', hours: 48, coins: 700 },
    ],
  },
  {
    methodId: 'rematch',
    type: 'REMATCH',
    title: 'Rematch Promo',
    subtitle: 'Promote a rematch or sequel battle',
    category: 'battle',
    needsBattle: true,
    packages: [
      { id: '24h', label: '24 hours', hours: 24, coins: 180 },
      { id: '72h', label: '3 days', hours: 72, coins: 450 },
    ],
  },
]);

const TYPE_BY_METHOD = Object.freeze(
  Object.fromEntries(PROMOTE_CATALOG_FALLBACK.map((m) => [m.methodId, m.type]))
);

export function methodTitleForType(typeOrMethodId) {
  const raw = String(typeOrMethodId || '').trim();
  if (!raw) return 'Promote';
  const lower = raw.toLowerCase();
  const byId = PROMOTE_CATALOG_FALLBACK.find((m) => m.methodId === lower);
  if (byId) return byId.title;
  const upper = raw.toUpperCase();
  const byType = PROMOTE_CATALOG_FALLBACK.find((m) => m.type === upper);
  if (byType) return byType.title;
  return raw.replace(/_/g, ' ');
}

/**
 * Merge server catalog (pricing.catalog) over fallback. Server coins/titles win.
 * @param {any} serverPricing
 */
export function mergePromoteCatalog(serverPricing) {
  const serverList = Array.isArray(serverPricing?.catalog) ? serverPricing.catalog : [];
  const byId = new Map(serverList.map((m) => [String(m?.methodId || '').trim(), m]));
  return PROMOTE_CATALOG_FALLBACK.map((fb) => {
    const s = byId.get(fb.methodId);
    if (!s) return { ...fb, packages: fb.packages.map((p) => ({ ...p })) };
    const sPkgs = Array.isArray(s.packages) ? s.packages : [];
    const packages = (fb.packages || []).map((fp) => {
      const sp = sPkgs.find((x) => String(x?.id || '') === fp.id) || sPkgs[0];
      return {
        ...fp,
        label: sp?.label || fp.label,
        hours: Number(sp?.hours ?? fp.hours) || fp.hours,
        coins: Number(sp?.coins ?? fp.coins) || fp.coins,
      };
    });
    if (sPkgs.length && packages.length === 0) {
      for (const sp of sPkgs) {
        packages.push({
          id: String(sp.id || 'default'),
          label: String(sp.label || 'Package'),
          hours: Number(sp.hours) || 24,
          coins: Number(sp.coins) || 0,
        });
      }
    }
    return {
      ...fb,
      title: String(s.title || fb.title),
      subtitle: String(s.subtitle || fb.subtitle),
      type: String(s.type || fb.type),
      category: String(s.category || fb.category),
      packages,
    };
  });
}

/**
 * Rough reach preview for compose UI (not a guarantee).
 * @param {{ methodId?: string, type?: string, hours?: number, targeting?: { sports?: string[], geos?: string[], interests?: string[] } }} opts
 */
export function estimatePromoteReach(opts = {}) {
  const methodId = String(opts.methodId || '').trim();
  const type = String(opts.type || TYPE_BY_METHOD[methodId] || '').toUpperCase();
  const hours = Math.max(0.5, Number(opts.hours) || 24);
  const targeting = opts.targeting || {};
  const sports = Array.isArray(targeting.sports) ? targeting.sports.length : 0;
  const geos = Array.isArray(targeting.geos) ? targeting.geos.length : 0;
  const interests = Array.isArray(targeting.interests) ? targeting.interests.length : 0;
  const focus = 1 + Math.min(0.45, (sports + geos + interests) * 0.05);

  const baseByType = {
    SPOTLIGHT: 18000,
    TIME_SLOT: 9000,
    BATTLE: 4500,
    FEED_BOOST: 6500,
    PROFILE: 3500,
    LIVE: 8000,
    SEARCH_SPONSORED: 5000,
    FOLLOWERS_NOTIFY: 2500,
    TEAM_SHOUTOUT: 4000,
    CROSS_SPORT: 4200,
    REMATCH: 3800,
  };
  const base = baseByType[type] || 3000;
  const low = Math.round(base * Math.sqrt(hours / 24) * focus * 0.7);
  const high = Math.round(base * Math.sqrt(hours / 24) * focus * 1.35);
  return { low, high, unit: 'impressions' };
}

export function formatReachPreview(estimate) {
  if (!estimate) return 'Reach preview unavailable';
  const fmt = (n) => {
    const v = Number(n) || 0;
    if (v >= 1000) return ${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k;
    return String(Math.round(v));
  };
  return Est. – ;
}

export default {
  PROMOTE_CATEGORIES,
  PROMOTE_SPORT_TARGETS,
  PROMOTE_GEO_TARGETS,
  PROMOTE_INTEREST_TARGETS,
  PROMOTE_CATALOG_FALLBACK,
  mergePromoteCatalog,
  estimatePromoteReach,
  formatReachPreview,
  methodTitleForType,
};
