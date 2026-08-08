// footballDataService.js
//
// Thin, swappable wrapper around a sports data provider so the rest of the app
// never talks to a specific API directly. Today this is backed by TheSportsDB
// (free, no API key required for these endpoints). To change providers later,
// only this file needs to change.

const API_KEY = '3'; // TheSportsDB free/open key. Swap for a paid key if needed.
const BASE_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const REQUEST_TIMEOUT_MS = 10000;

// Top leagues shown when the user opens "Add team" (browse list, no typing required).
const BROWSE_LEAGUES = [
  'English Premier League',
  'Spanish La Liga',
  'Italian Serie A',
  'German Bundesliga',
  'French Ligue 1',
  'UEFA Champions League',
];

let browseCache = null;

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Sports data request failed (HTTP ${res.status})`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function isFootballSport(raw) {
  const sport = String(raw?.strSport || '').toLowerCase();
  return sport === 'soccer' || sport === 'football';
}

function normalizeTeam(raw) {
  if (!raw) return null;
  return {
    id: raw.idTeam,
    name: raw.strTeam,
    shortName: raw.strTeamShort || '',
    badge: raw.strBadge || raw.strTeamBadge || null,
    league: raw.strLeague || '',
    leagueId: raw.idLeague || null,
    stadium: raw.strStadium || '',
    website: raw.strWebsite || '',
    country: raw.strCountry || '',
    sport: raw.strSport || 'Soccer',
  };
}

// Football season label TheSportsDB expects, e.g. "2025-2026". European seasons
// run Aug -> May, so before August we're still in the previous split season.
export function currentFootballSeason(now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0 = Jan
  return m >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function normalizeEvent(raw) {
  if (!raw) return null;
  const homeScore = raw.intHomeScore;
  const awayScore = raw.intAwayScore;
  return {
    id: raw.idEvent,
    name: raw.strEvent,
    homeTeam: raw.strHomeTeam || '',
    awayTeam: raw.strAwayTeam || '',
    homeScore: homeScore === null || homeScore === undefined || homeScore === '' ? null : Number(homeScore),
    awayScore: awayScore === null || awayScore === undefined || awayScore === '' ? null : Number(awayScore),
    league: raw.strLeague || '',
    leagueBadge: raw.strLeagueBadge || null,
    // strTimestamp is ISO-like UTC, e.g. "2026-08-05T18:30:00"
    timestamp: raw.strTimestamp || null,
    date: raw.dateEvent || null,
    time: raw.strTime || null,
    venue: raw.strVenue || '',
    round: raw.intRound || null,
    // Often empty on the free tier; broadcastService falls back to a curated map.
    tvStation: raw.strTVStation || raw.strChannel || '',
  };
}

function normalizePlayer(raw) {
  if (!raw) return null;
  const position = raw.strPosition || 'Squad';
  return {
    id: raw.idPlayer,
    name: raw.strPlayer || '',
    position,
    positionGroup: position.toLowerCase().includes('goalkeeper')
      ? 'Goalkeepers'
      : position.toLowerCase().includes('defen')
        ? 'Defenders'
        : position.toLowerCase().includes('midfield')
          ? 'Midfielders'
          : position.toLowerCase().includes('forward') || position.toLowerCase().includes('wing')
            ? 'Forwards'
            : 'Squad',
    number: raw.strNumber || '',
    nationality: raw.strNationality || '',
    image: raw.strCutout || raw.strThumb || null,
    status: raw.strStatus || '',
  };
}

/** Teams from major leagues — shown immediately when opening "Add team". */
export async function getBrowsableFootballTeams() {
  if (browseCache) return browseCache;
  const seen = new Set();
  const merged = [];
  const results = await Promise.allSettled(
    BROWSE_LEAGUES.map((league) =>
      fetchJson(`${BASE_URL}/search_all_teams.php?l=${encodeURIComponent(league)}`)
    )
  );
  for (const res of results) {
    if (res.status !== 'fulfilled') continue;
    const teams = Array.isArray(res.value?.teams) ? res.value.teams : [];
    for (const raw of teams) {
      if (!isFootballSport(raw)) continue;
      const id = String(raw.idTeam || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const norm = normalizeTeam(raw);
      if (norm) merged.push(norm);
    }
  }
  merged.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  browseCache = merged;
  return merged;
}

/**
 * Search football teams by name, or return the browse list when query is empty.
 * @param {string} query
 * @returns {Promise<Array>} normalized teams
 */
export async function searchFootballTeams(query) {
  const q = (query || '').trim();
  if (!q) return getBrowsableFootballTeams();
  const data = await fetchJson(`${BASE_URL}/searchteams.php?t=${encodeURIComponent(q)}`);
  const teams = Array.isArray(data?.teams) ? data.teams : [];
  return teams
    .filter(isFootballSport)
    .map(normalizeTeam)
    .filter(Boolean);
}

/** Full team metadata, including stadium and official website when supplied. */
export async function getFootballTeam(teamId) {
  if (!teamId) return null;
  const data = await fetchJson(`${BASE_URL}/lookupteam.php?id=${encodeURIComponent(teamId)}`);
  const raw = Array.isArray(data?.teams) ? data.teams[0] : null;
  return normalizeTeam(raw);
}

/**
 * Upcoming fixtures for a team.
 * @param {string} teamId
 * @returns {Promise<Array>} normalized events (soonest first)
 */
export async function getNextMatches(teamId) {
  if (!teamId) return [];
  const data = await fetchJson(`${BASE_URL}/eventsnext.php?id=${encodeURIComponent(teamId)}`);
  const events = Array.isArray(data?.events) ? data.events : [];
  return events.map(normalizeEvent).filter(Boolean);
}

/**
 * Most recent results for a team.
 * @param {string} teamId
 * @returns {Promise<Array>} normalized events (most recent first)
 */
export async function getLastMatches(teamId) {
  if (!teamId) return [];
  const data = await fetchJson(`${BASE_URL}/eventslast.php?id=${encodeURIComponent(teamId)}`);
  const events = Array.isArray(data?.results) ? data.results : [];
  return events.map(normalizeEvent).filter(Boolean);
}

/**
 * Current first-team squad. Availability varies by club on the free provider.
 * Empty means unavailable; callers must not infer that the club has no players.
 */
export async function getTeamSquad(teamId) {
  if (!teamId) return [];
  const data = await fetchJson(`${BASE_URL}/lookup_all_players.php?id=${encodeURIComponent(teamId)}`);
  const players = Array.isArray(data?.player) ? data.player : [];
  return players.map(normalizePlayer).filter((p) => p?.id && p?.name);
}

/**
 * League standings table for a league id. Tries the current season, then falls
 * back to the previous one (handles the pre-season gap). Returns [] if the free
 * tier has no table for that league.
 * @param {string} leagueId TheSportsDB idLeague
 * @returns {Promise<Array>} ranked rows
 */
export async function getLeagueTable(leagueId, season) {
  if (!leagueId) return [];
  const seasons = season ? [season] : [currentFootballSeason(), currentFootballSeason(new Date(Date.now() - 365 * 864e5))];
  for (const s of seasons) {
    try {
      const data = await fetchJson(`${BASE_URL}/lookuptable.php?l=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(s)}`);
      const rows = Array.isArray(data?.table) ? data.table : [];
      if (rows.length === 0) continue;
      return rows.map((r) => ({
        rank: Number(r.intRank),
        teamId: r.idTeam,
        team: r.strTeam,
        badge: r.strBadge || null,
        played: Number(r.intPlayed),
        win: Number(r.intWin),
        draw: Number(r.intDraw),
        loss: Number(r.intLoss),
        goalsFor: Number(r.intGoalsFor),
        goalsAgainst: Number(r.intGoalsAgainst),
        goalDiff: Number(r.intGoalDifference),
        points: Number(r.intPoints),
        form: r.strForm || '',
      }));
    } catch {
      /* try next season */
    }
  }
  return [];
}

export default {
  searchFootballTeams,
  getBrowsableFootballTeams,
  getFootballTeam,
  getNextMatches,
  getLastMatches,
  getTeamSquad,
  getLeagueTable,
  currentFootballSeason,
};
