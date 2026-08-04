// matchdayService
//
// Domain helpers for Matchday Live: feature flag, the live window derived from a
// TheSportsDB fixture timestamp (no live feed required), match-scoped ids for the
// banter room, prediction market metadata, and final-result settlement using the
// existing free football data service.

import { getLastMatches } from './footballDataService';
import { settleMatchdayPredictions, makeIdempotencyKey, type MatchdayResultInput } from '../api/economyLiveApi';

// ~1h before kickoff the experience opens; it stays live through full time plus
// a generous stoppage/halftime buffer so the room doesn't close mid-match.
const PRE_KICKOFF_WINDOW_MS = 60 * 60 * 1000; // 1h
const FULL_TIME_BUFFER_MS = 2.5 * 60 * 60 * 1000; // 2h30 from kickoff

export function isMatchdayLiveEnabled(): boolean {
  return String(process.env.EXPO_PUBLIC_ENABLE_MATCHDAY_LIVE || '').trim() === '1';
}

/** Parse a TheSportsDB fixture into a kickoff Date (UTC), tolerating missing tz. */
export function parseKickoff(ev: any): Date | null {
  if (!ev) return null;
  const ts = ev.timestamp;
  let d: Date | null = null;
  try {
    if (ts) {
      d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`);
    } else if (ev.date) {
      d = new Date(`${ev.date}T${ev.time || '00:00:00'}Z`);
    }
  } catch {
    d = null;
  }
  if (!d || isNaN(d.getTime())) return null;
  return d;
}

export type MatchPhase = 'unknown' | 'upcoming' | 'live' | 'ended';

export interface MatchWindow {
  kickoff: Date | null;
  opensAt: Date | null;
  endsAt: Date | null;
  phase: MatchPhase;
  inLiveWindow: boolean;
  msToKickoff: number | null;
}

export function getMatchWindow(ev: any, now: number = Date.now()): MatchWindow {
  const kickoff = parseKickoff(ev);
  if (!kickoff) {
    return { kickoff: null, opensAt: null, endsAt: null, phase: 'unknown', inLiveWindow: false, msToKickoff: null };
  }
  const ko = kickoff.getTime();
  const opensAt = ko - PRE_KICKOFF_WINDOW_MS;
  const endsAt = ko + FULL_TIME_BUFFER_MS;
  let phase: MatchPhase = 'upcoming';
  if (now >= endsAt) phase = 'ended';
  else if (now >= opensAt) phase = 'live';
  return {
    kickoff,
    opensAt: new Date(opensAt),
    endsAt: new Date(endsAt),
    phase,
    inLiveWindow: now >= opensAt && now < endsAt,
    msToKickoff: ko - now,
  };
}

/** Human countdown like "2d 4h", "58m", "12s", or "Kicked off". */
export function formatCountdown(ms: number | null): string {
  if (ms == null) return '';
  if (ms <= 0) return 'Kicked off';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

/** TheSportsDB idEvent is globally unique; fall back to a stable derived id. */
export function matchdayEventId(ev: any): string {
  if (ev?.id) return String(ev.id);
  const base = `${ev?.homeTeam || ''}-${ev?.awayTeam || ''}-${ev?.date || ev?.timestamp || ''}`;
  return `gen:${base.replace(/\s+/g, '_').toLowerCase()}`;
}

export function matchdayChatRoomId(eventId: string): string {
  return `matchday:${eventId}`;
}

export interface PredictionMarketDef {
  market: 'SCORELINE' | 'FIRST_SCORER' | 'RESULT';
  title: string;
  subtitle: string;
  icon: string;
}

export const PREDICTION_MARKETS: PredictionMarketDef[] = [
  { market: 'RESULT', title: 'Full-time result', subtitle: 'Home / Draw / Away', icon: 'trophy' },
  { market: 'SCORELINE', title: 'Correct score', subtitle: 'Exact final scoreline', icon: 'football' },
  { market: 'FIRST_SCORER', title: 'First goalscorer', subtitle: 'Name the opener', icon: 'flash' },
];

/** Build a settlement payload from a played fixture (free API gives no scorers). */
export function buildResultFromEvent(ev: any): MatchdayResultInput | null {
  if (!ev) return null;
  const h = ev.homeScore;
  const a = ev.awayScore;
  if (h == null || a == null) return null;
  let winner: 'HOME' | 'AWAY' | 'DRAW' = 'DRAW';
  if (Number(h) > Number(a)) winner = 'HOME';
  else if (Number(h) < Number(a)) winner = 'AWAY';
  return {
    status: 'COMPLETED',
    homeScore: Number(h),
    awayScore: Number(a),
    winner,
    // Free tier exposes no goalscorer data; FIRST_SCORER predictions are refunded.
    firstScorer: null,
  };
}

export type SettlementOutcome =
  | { ok: true; settled: true; result: MatchdayResultInput }
  | { ok: false; reason: 'not-final-yet' | 'error'; message?: string };

/**
 * Settle a match from its final result (fetched via the free data service).
 * For v1 there is no live in-play feed, so predictions resolve on full time.
 */
export async function settleFromFinalResult(eventId: string, teamId: string): Promise<SettlementOutcome> {
  try {
    const last = await getLastMatches(teamId);
    const ev = (Array.isArray(last) ? last : []).find((e) => String(e.id) === String(eventId));
    if (!ev) return { ok: false, reason: 'not-final-yet' };
    const result = buildResultFromEvent(ev);
    if (!result) return { ok: false, reason: 'not-final-yet' };
    await settleMatchdayPredictions({
      idempotencyKey: makeIdempotencyKey(`matchday-settle:${eventId}`),
      eventId,
      result,
    });
    return { ok: true, settled: true, result };
  } catch (e: any) {
    return { ok: false, reason: 'error', message: e?.message || String(e) };
  }
}
