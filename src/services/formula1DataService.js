// formula1DataService.js
//
// Formula 1 data. HARD RULE: only real data, never fabricated.
//
// Sources (both free, both real):
//   - Race schedule + results: Jolpica (the maintained Ergast F1 API successor).
//     Accurate, current-season calendar and classifications.
//     https://api.jolpi.ca/ergast/f1
//   - Constructor badges/logos for the followable team list: TheSportsDB.
//     (Jolpica has no logos; TheSportsDB has accurate constructor crests.)
//
// Race next/last are championship-wide (not per constructor). If a source can't
// provide something, we surface null and the UI shows a clear "unavailable"
// state — we never invent a race, date, or result.

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';
const SPORTSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';
const F1_LEAGUE_NAME = 'Formula 1';
const REQUEST_TIMEOUT_MS = 12000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`F1 data request failed (HTTP ${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function raceDateTimeMs(date, time) {
  if (!date) return null;
  // Jolpica time already carries a trailing Z, e.g. "13:00:00Z".
  const t = time || '00:00:00Z';
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? `${date}T${t}` : `${date}T${t}Z`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function normalizeJolpicaRace(r, year) {
  if (!r) return null;
  const date = r.date || null;
  const time = r.time || null;
  return {
    id: `${year}-${r.round}`,
    name: r.raceName || 'Grand Prix',
    venue: r.Circuit?.circuitName || '',
    locality: r.Circuit?.Location?.locality || '',
    country: r.Circuit?.Location?.country || '',
    timestamp: date ? `${date}T${time || '00:00:00Z'}` : null,
    date,
    time,
    round: r.round || null,
    season: String(year),
    league: F1_LEAGUE_NAME,
    sport: 'F1',
    tvStation: '', // not provided by source — UI shows "not available"
  };
}

function normalizeConstructor(raw) {
  if (!raw) return null;
  return {
    id: raw.idTeam,
    name: raw.strTeam,
    shortName: raw.strTeamShort || '',
    badge: raw.strBadge || raw.strTeamBadge || null,
    league: F1_LEAGUE_NAME,
    stadium: '',
    sport: 'F1',
  };
}

// ---- caches -------------------------------------------------------------
let teamsCache = null;
const scheduleCache = new Map(); // year -> Jolpica races[]

// Distinctive tokens that map an authoritative Jolpica constructor to its
// TheSportsDB crest entry (whose names carry sponsor prefixes, e.g.
// "Oracle Red Bull Racing"). Matching is best-effort; a missing crest falls
// back to a placeholder badge in the UI — we never fabricate a logo.
const CONSTRUCTOR_BADGE_HINTS = {
  red_bull: ['red bull'],
  rb: ['racing bulls', 'alphatauri'],
  mercedes: ['mercedes'],
  ferrari: ['ferrari'],
  mclaren: ['mclaren'],
  aston_martin: ['aston martin'],
  alpine: ['alpine'],
  williams: ['williams'],
  haas: ['haas'],
  sauber: ['sauber', 'stake'],
  audi: ['audi'],
  cadillac: ['cadillac'],
};

function badgeForConstructor(constructorId, name, sportsDbTeams) {
  const hints = CONSTRUCTOR_BADGE_HINTS[constructorId] || [String(name || '').toLowerCase()];
  for (const t of sportsDbTeams) {
    const tn = String(t?.strTeam || '').toLowerCase();
    if (hints.some((h) => h && tn.includes(h))) {
      return t.strBadge || t.strTeamBadge || null;
    }
  }
  return null;
}

async function fetchSportsDbF1Teams() {
  try {
    const data = await fetchJson(`${SPORTSDB_BASE}/search_all_teams.php?l=${encodeURIComponent(F1_LEAGUE_NAME)}`);
    return Array.isArray(data?.teams) ? data.teams : [];
  } catch {
    return [];
  }
}

async function fetchJolpicaConstructors(year) {
  const data = await fetchJson(`${JOLPICA_BASE}/${year}/constructors.json`);
  const list = data?.MRData?.ConstructorTable?.Constructors;
  return Array.isArray(list) ? list : [];
}

/**
 * Current F1 constructors for the follow list.
 *
 * The grid comes from Jolpica/Ergast (authoritative and complete — it always
 * includes every entered constructor, e.g. Williams). Crests are enriched from
 * TheSportsDB, whose own league roster search is unreliable and has been
 * observed to silently omit constructors (Williams among them). If a crest
 * can't be matched we surface a null badge (UI shows a placeholder) rather than
 * dropping a real team from the grid.
 */
export async function getF1Teams() {
  if (teamsCache) return teamsCache;

  const year = new Date().getFullYear();
  let constructors = [];
  try {
    constructors = await fetchJolpicaConstructors(year);
    if (constructors.length === 0 && year > 2023) {
      constructors = await fetchJolpicaConstructors(year - 1);
    }
  } catch {
    constructors = [];
  }

  const sportsDbTeams = await fetchSportsDbF1Teams();

  if (constructors.length > 0) {
    teamsCache = constructors.map((c) => ({
      id: c.constructorId,
      name: c.name,
      shortName: '',
      badge: badgeForConstructor(c.constructorId, c.name, sportsDbTeams),
      league: F1_LEAGUE_NAME,
      stadium: '',
      sport: 'F1',
    }));
    return teamsCache;
  }

  // Last-resort fallback so the page is never empty if Jolpica is unreachable.
  teamsCache = sportsDbTeams.map(normalizeConstructor).filter(Boolean);
  return teamsCache;
}

async function getSeasonSchedule(year) {
  if (scheduleCache.has(year)) return scheduleCache.get(year);
  const data = await fetchJson(`${JOLPICA_BASE}/${year}.json`);
  const races = data?.MRData?.RaceTable?.Races;
  const list = Array.isArray(races) ? races : [];
  scheduleCache.set(year, list);
  return list;
}

/** The next Grand Prix (soonest upcoming), or null if the source has none. */
export async function getNextRace() {
  const now = Date.now();
  const year = new Date().getFullYear();
  const races = await getSeasonSchedule(year);
  const upcoming = races
    .map((r) => ({ raw: r, t: raceDateTimeMs(r.date, r.time) }))
    .filter((x) => x.t != null && x.t >= now)
    .sort((a, b) => a.t - b.t);
  if (upcoming.length === 0) return null;
  return normalizeJolpicaRace(upcoming[0].raw, year);
}

/**
 * The most recent completed Grand Prix plus its podium (from real results).
 * @returns {Promise<{ race: object, podium: Array } | null>}
 */
export async function getLastRaceResult() {
  const year = new Date().getFullYear();
  const data = await fetchJson(`${JOLPICA_BASE}/${year}/last/results.json`);
  const race = data?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  const normalized = normalizeJolpicaRace(race, year);
  const results = Array.isArray(race.Results) ? race.Results : [];
  const podium = results
    .slice(0, 3)
    .map((res) => {
      const driver = res.Driver
        ? `${res.Driver.givenName || ''} ${res.Driver.familyName || ''}`.trim()
        : '';
      return {
        position: Number(res.position),
        driver,
        teamName: res.Constructor?.name || '',
        teamId: res.Constructor?.constructorId || '',
        detail: res.Time?.time || res.status || '',
        points: res.points != null ? Number(res.points) : null,
      };
    })
    .filter((p) => Number.isFinite(p.position) && p.position > 0);

  return { race: normalized, podium };
}

/** Full race calendar for the season (normalized, in round order). */
export async function getSeasonRaces(year = new Date().getFullYear()) {
  try {
    const races = await getSeasonSchedule(year);
    const list = races.map((r) => normalizeJolpicaRace(r, year)).filter(Boolean);
    if (list.length === 0 && year > 2023) return getSeasonRaces(year - 1);
    return list;
  } catch {
    return [];
  }
}

/** Driver championship standings. Falls back to the previous season pre-season. */
export async function getDriverStandings(year = new Date().getFullYear()) {
  try {
    const data = await fetchJson(`${JOLPICA_BASE}/${year}/driverStandings.json`);
    const lists = data?.MRData?.StandingsTable?.StandingsLists;
    const rows = Array.isArray(lists) && lists[0]?.DriverStandings ? lists[0].DriverStandings : [];
    if (rows.length === 0 && year > 2023) return getDriverStandings(year - 1);
    return rows.map((r) => ({
      position: Number(r.position),
      points: Number(r.points),
      wins: Number(r.wins),
      driver: `${r.Driver?.givenName || ''} ${r.Driver?.familyName || ''}`.trim(),
      code: r.Driver?.code || '',
      teamName: r.Constructors?.[0]?.name || '',
      teamId: r.Constructors?.[0]?.constructorId || '',
    }));
  } catch {
    return [];
  }
}

/** Constructor championship standings. */
export async function getConstructorStandings(year = new Date().getFullYear()) {
  try {
    const data = await fetchJson(`${JOLPICA_BASE}/${year}/constructorStandings.json`);
    const lists = data?.MRData?.StandingsTable?.StandingsLists;
    const rows = Array.isArray(lists) && lists[0]?.ConstructorStandings ? lists[0].ConstructorStandings : [];
    if (rows.length === 0 && year > 2023) return getConstructorStandings(year - 1);
    return rows.map((r) => ({
      position: Number(r.position),
      points: Number(r.points),
      wins: Number(r.wins),
      teamName: r.Constructor?.name || '',
      teamId: r.Constructor?.constructorId || '',
    }));
  } catch {
    return [];
  }
}

export default {
  getF1Teams,
  getNextRace,
  getLastRaceResult,
  getSeasonRaces,
  getDriverStandings,
  getConstructorStandings,
};
