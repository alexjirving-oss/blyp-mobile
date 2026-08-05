// profileIdentityCatalog.js
//
// Curated clubs + badges for profile identity (Phase 0+).
// Catalog is client-side for now; unknown ids are stripped on normalize.
// Entitlement caps (Phase 1): Free 3 clubs / 1 badge; Plus/trial 8 / 3.
// Do not conflate with avatarFrame (admin-only) or StandingBadge (trust).

export const MAX_PROFILE_CLUBS_FREE = 3;
export const MAX_PROFILE_CLUBS_PLUS = 8;
export const MAX_PROFILE_BADGES_EQUIPPED = 3;
export const MAX_PROFILE_BADGES_FREE = 1;

/**
 * Entitlement-aware hard caps for picker + save normalize.
 * Plus / trial share the higher caps (same as useHasAI / capabilities.ai).
 * @param {boolean} hasPlus
 * @returns {{ maxClubs: number, maxBadges: number }}
 */
export function getProfileIdentityCaps(hasPlus) {
  const entitled = !!hasPlus;
  return {
    maxClubs: entitled ? MAX_PROFILE_CLUBS_PLUS : MAX_PROFILE_CLUBS_FREE,
    maxBadges: entitled ? MAX_PROFILE_BADGES_EQUIPPED : MAX_PROFILE_BADGES_FREE,
  };
}

/** @typedef {{ id: string, label: string, kind: 'football'|'game'|'community', icon: string, shortLabel?: string }} ClubDef */
/** @typedef {{ id: string, label: string, icon: string, rarity: 'common'|'rare'|'seasonal' }} BadgeDef */

/** @type {readonly ClubDef[]} */
export const CLUB_CATALOG = Object.freeze([
  { id: 'club_arsenal', label: 'Arsenal', kind: 'football', icon: 'football', shortLabel: 'Arsenal' },
  { id: 'club_chelsea', label: 'Chelsea', kind: 'football', icon: 'football', shortLabel: 'Chelsea' },
  { id: 'club_liverpool', label: 'Liverpool', kind: 'football', icon: 'football', shortLabel: 'Liverpool' },
  { id: 'club_man_city', label: 'Manchester City', kind: 'football', icon: 'football', shortLabel: 'Man City' },
  { id: 'club_man_united', label: 'Manchester United', kind: 'football', icon: 'football', shortLabel: 'Man Utd' },
  { id: 'club_tottenham', label: 'Tottenham', kind: 'football', icon: 'football', shortLabel: 'Spurs' },
  { id: 'club_newcastle', label: 'Newcastle United', kind: 'football', icon: 'football', shortLabel: 'Newcastle' },
  { id: 'club_aston_villa', label: 'Aston Villa', kind: 'football', icon: 'football', shortLabel: 'Villa' },
  { id: 'club_marble_racing', label: 'Marble Racing', kind: 'game', icon: 'speedometer', shortLabel: 'Marbles' },
]);

/** @type {readonly BadgeDef[]} */
export const BADGE_CATALOG = Object.freeze([
  { id: 'badge_early_blyper', label: 'Early Blyper', icon: 'sparkles', rarity: 'rare' },
  { id: 'badge_matchday', label: 'Matchday', icon: 'football', rarity: 'common' },
  { id: 'badge_marble_racer', label: 'Marble Racer', icon: 'speedometer', rarity: 'common' },
  { id: 'badge_live_host', label: 'Live Host', icon: 'radio', rarity: 'common' },
  { id: 'badge_creator', label: 'Creator', icon: 'color-wand', rarity: 'common' },
  { id: 'badge_community', label: 'Community', icon: 'people', rarity: 'common' },
]);

const clubById = new Map(CLUB_CATALOG.map((c) => [c.id, c]));
const badgeById = new Map(BADGE_CATALOG.map((b) => [b.id, b]));

export function getClubById(id) {
  return clubById.get(String(id || '')) || null;
}

export function getBadgeById(id) {
  return badgeById.get(String(id || '')) || null;
}

/**
 * Keep only known catalog ids, de-dupe, preserve order, cap length.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function normalizeProfileClubs(raw, max = MAX_PROFILE_CLUBS_PLUS) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  const limit = Math.max(0, Number(max) || MAX_PROFILE_CLUBS_PLUS);
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : String(item?.id || '').trim();
    if (!id || seen.has(id) || !clubById.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {string[]}
 */
export function normalizeProfileBadges(raw, max = MAX_PROFILE_BADGES_EQUIPPED) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  const limit = Math.max(0, Number(max) || MAX_PROFILE_BADGES_EQUIPPED);
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : String(item?.id || '').trim();
    if (!id || seen.has(id) || !badgeById.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= limit) break;
  }
  return out;
}

/** Resolve club ids to catalog rows (drops unknowns). */
export function resolveClubs(ids) {
  return normalizeProfileClubs(ids).map((id) => clubById.get(id)).filter(Boolean);
}

/** Resolve badge ids to catalog rows (drops unknowns). */
export function resolveBadges(ids) {
  return normalizeProfileBadges(ids).map((id) => badgeById.get(id)).filter(Boolean);
}

/**
 * Toggle an id in a list with a hard cap (for pickers).
 * @param {string[]} current
 * @param {string} id
 * @param {number} max
 */
export function toggleIdInList(current, id, max) {
  const list = Array.isArray(current) ? [...current] : [];
  const idx = list.indexOf(id);
  if (idx >= 0) {
    list.splice(idx, 1);
    return list;
  }
  if (list.length >= max) return list;
  list.push(id);
  return list;
}
