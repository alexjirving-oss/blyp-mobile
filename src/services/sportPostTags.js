// sportPostTags.js
//
// Resolve upload-time sportTags / teamIds so Football & F1 video rails can
// match posts without relying only on caption text.

import { INTEREST_CATALOG, SPORT_PAGE_IDS } from './userPreferencesService';

/** Chips shown on Review/publish for explicit sport tagging. */
export const SPORT_TAG_OPTIONS = INTEREST_CATALOG.filter((i) =>
  ['football', 'f1', 'sport'].includes(i.id)
).map((i) => ({ id: i.id, label: i.label, icon: i.icon }));

/**
 * Normalize a sportTags array for Firestore (known interest ids only).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeSportTags(raw) {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(INTEREST_CATALOG.map((i) => i.id));
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item || '')
      .trim()
      .toLowerCase();
    if (!id || seen.has(id) || !allowed.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Normalize SportsDB / Jolpica team ids for Firestore.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeTeamIds(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const id = String(item || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Map a followed team.sport value to a sportTag interest id.
 * @param {object} team
 * @returns {string|null}
 */
export function sportTagForTeam(team) {
  const sport = String(team?.sport || '').toLowerCase();
  if (sport === 'f1' || sport === 'formula 1' || sport === 'formula1') return 'f1';
  if (sport === 'soccer' || sport === 'football') return 'football';
  return null;
}

/**
 * Build default sportTags + teamIds from followed teams (and optional picks).
 * Used at publish time so rails fill even when the user skips the chip UI.
 *
 * @param {{ followedTeams?: object[], selectedSportTags?: string[], selectedTeamIds?: string[] }} opts
 * @returns {{ sportTags: string[], teamIds: string[] }}
 */
export function resolvePublishSportTags(opts = {}) {
  const followed = Array.isArray(opts.followedTeams) ? opts.followedTeams : [];
  const pickedTags = normalizeSportTags(opts.selectedSportTags);
  const pickedTeams = normalizeTeamIds(opts.selectedTeamIds);

  const autoTags = [];
  for (const t of followed) {
    const tag = sportTagForTeam(t);
    if (tag) autoTags.push(tag);
  }

  let sportTags = normalizeSportTags([...pickedTags, ...autoTags]);
  // If user only picked a non-sport interest chip set, leave empty — do not invent.
  if (sportTags.length === 0 && pickedTeams.length === 0 && followed.length === 0) {
    return { sportTags: [], teamIds: [] };
  }

  // Prefer explicit team picks; else attach all followed teams that match selected tags
  // (or all followed sport teams when tags came only from auto).
  let teamIds = pickedTeams.slice();
  if (teamIds.length === 0 && followed.length > 0) {
    const tagSet = new Set(sportTags.length ? sportTags : SPORT_PAGE_IDS);
    for (const t of followed) {
      const tag = sportTagForTeam(t);
      if (tag && tagSet.has(tag) && t?.id) teamIds.push(String(t.id));
    }
    teamIds = normalizeTeamIds(teamIds);
  }

  // If teams were picked without sport tags, infer tags from those teams.
  if (sportTags.length === 0 && teamIds.length > 0) {
    const byId = new Map(followed.map((t) => [String(t.id), t]));
    for (const id of teamIds) {
      const tag = sportTagForTeam(byId.get(id));
      if (tag) sportTags.push(tag);
    }
    sportTags = normalizeSportTags(sportTags);
  }

  return { sportTags, teamIds };
}
