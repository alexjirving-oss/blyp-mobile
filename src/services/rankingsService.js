// rankingsService.js
//
// Client for the Rankings hub (Phase 0–4). Live boards hit the economy backend
// with optional day/week/month/year windows. Club boards require clubId
// (profileClubs membership ∩ gift_events / followers). Battle glory deep-links
// BattleLeaderboard. Remaining catalog tiles are Coming soon (with notes).

import { callEconomyBackend } from '../api/economyLiveApi';
import { CLUB_CATALOG, getClubById } from './profileIdentityCatalog';

/** @typedef {'coin_spend'|'gem_earn'|'followers_total'|'gifts_sent'|'gifts_recv'|'stream_earnings'|'peak_viewers'|'battle_glory'|'battle_wins'|'battle_streak'|'marble_wins'|'live_game_wins'|'club_coin_spend'|'club_followers'} LiveBoardId */
/** @typedef {'day'|'week'|'month'|'year'|'alltime'} RankingWindow */

export const RANKING_WINDOWS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'alltime', label: 'All' },
];

/** Windows shown for club spend (server supports week/month/alltime). */
export const CLUB_SPEND_WINDOWS = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'alltime', label: 'All' },
];

export const LIVE_BOARDS = [
  {
    id: 'coin_spend',
    title: 'Top coin spenders',
    blurb: 'Coins spent on gifts, promos, live games and more.',
    icon: 'wallet',
    category: 'Economy',
    unit: 'coins',
    source: 'economy',
    windows: true,
  },
  {
    id: 'gem_earn',
    title: 'Top gem earners',
    blurb: 'Gems earned from gifts received and team bonuses.',
    icon: 'diamond',
    category: 'Economy',
    unit: 'gems',
    source: 'economy',
    windows: true,
  },
  {
    id: 'gifts_sent',
    title: 'Most gifts sent',
    blurb: 'Gift units sent across live streams.',
    icon: 'gift',
    category: 'Economy',
    unit: 'gifts',
    source: 'economy',
    windows: true,
  },
  {
    id: 'gifts_recv',
    title: 'Most gifted creator',
    blurb: 'Creators who received the most gift units.',
    icon: 'heart',
    category: 'Economy',
    unit: 'gifts',
    source: 'economy',
    windows: true,
  },
  {
    id: 'stream_earnings',
    title: 'Top stream earnings',
    blurb: 'Coins received as a live creator (gift volume).',
    icon: 'star',
    category: 'Economy',
    unit: 'coins',
    source: 'economy',
    windows: true,
  },
  {
    id: 'followers_total',
    title: 'Most followed',
    blurb: 'Creators with the most followers right now.',
    icon: 'people',
    category: 'Social',
    unit: 'followers',
    source: 'economy',
    windows: false,
  },
  {
    id: 'peak_viewers',
    title: 'Highest peak viewers',
    blurb: 'Best single-stream peak concurrent viewers per host.',
    icon: 'eye',
    category: 'Live',
    unit: 'viewers',
    source: 'economy',
    windows: false,
  },
  {
    id: 'battle_glory',
    title: 'Battle glory',
    blurb: 'Points-only battle ranking — never money.',
    icon: 'trophy',
    category: 'Competitive',
    unit: 'glory',
    source: 'navigate',
    route: 'BattleLeaderboard',
    windows: false,
  },
  {
    id: 'battle_wins',
    title: 'Battles won',
    blurb: 'Wins from battleStats (week + all-time).',
    icon: 'flash',
    category: 'Competitive',
    unit: 'wins',
    source: 'economy',
    windows: true,
  },
  {
    id: 'battle_streak',
    title: 'Longest battle streak',
    blurb: 'Best win streak from battleStats.',
    icon: 'flame',
    category: 'Competitive',
    unit: 'streak',
    source: 'economy',
    windows: false,
  },
  {
    id: 'marble_wins',
    title: 'Marble race wins',
    blurb: 'Race winners from marblePodiumWins evidence.',
    icon: 'ellipse',
    category: 'Games',
    unit: 'wins',
    source: 'economy',
    windows: false,
  },
  {
    id: 'live_game_wins',
    title: 'Live mini-game wins',
    blurb: 'Wins settled via live-game payout ledger.',
    icon: 'game-controller',
    category: 'Games',
    unit: 'wins',
    source: 'economy',
    windows: true,
  },
  {
    id: 'club_coin_spend',
    title: 'Club: top spenders',
    blurb: 'Gift coin spend among members of a club (profileClubs ∩ gift_events).',
    icon: 'football',
    category: 'Clubs',
    unit: 'coins',
    source: 'economy',
    windows: 'club',
    requiresClubId: true,
  },
  {
    id: 'club_followers',
    title: 'Club: rising members',
    blurb: 'Most-followed members in a club via profileClubs (true rising deltas later).',
    icon: 'people',
    category: 'Clubs',
    unit: 'followers',
    source: 'economy',
    windows: false,
    requiresClubId: true,
  },
];

/** Coming-soon catalog so the hub feels full (names match product plan). */
export const COMING_SOON_BOARDS = [
  { id: 'coin_earn', title: 'Highest coin earner', category: 'Economy', windows: 'Day · Week · Month · Year' },
  {
    id: 'followers_delta',
    title: 'Most new followers',
    category: 'Social',
    windows: 'Day · Week · Month · Year',
    note: 'Needs follow-event history — deferred.',
  },
  { id: 'following_growth', title: 'Fastest growing', category: 'Social', windows: 'Week · Month' },
  { id: 'posts_created', title: 'Most posts', category: 'Social', windows: 'Day · Week · Month · Year' },
  { id: 'likes_recv', title: 'Most likes received', category: 'Social', windows: 'Day · Week · Month · Year' },
  { id: 'comments_recv', title: 'Most comments received', category: 'Social', windows: 'Day · Week · Month · Year' },
  {
    id: 'watch_time',
    title: 'Most watch time',
    category: 'Live',
    windows: 'Day · Week · Month · Year',
    note: 'No durable watch-duration telemetry yet (watchHistory is continue-watching only).',
  },
  {
    id: 'live_hours',
    title: 'Most hours live',
    category: 'Live',
    windows: 'Day · Week · Month · Year',
    note: 'Needs host session duration rollups beyond per-stream docs.',
  },
  { id: 'avg_viewers', title: 'Highest avg concurrent', category: 'Live', windows: 'Week · Month' },
  {
    id: 'marble_podium',
    title: 'Marble podium finishes',
    category: 'Games',
    windows: 'Week · Month',
    note: 'Only race-winner counters exist (marblePodiumWins); top-3 podium history not stored yet.',
  },
  {
    id: 'matchday_net',
    title: 'Matchday prediction net',
    category: 'Games',
    windows: 'Event · Season',
    note: 'Needs settled prediction PnL rollup beyond per-prediction rows.',
  },
  {
    id: 'league_posts',
    title: 'League / sport: top posters',
    category: 'Leagues',
    windows: 'Week · Month',
    note: 'sportTags exist on posts, but no durable league-scoped poster rollup yet. Club membership is on profileClubs.',
  },
  {
    id: 'league_live',
    title: 'League / sport: top live hosts',
    category: 'Leagues',
    windows: 'Week · Month',
    note: 'Needs sport-tagged stream rollups. Club membership is on profileClubs.',
  },
  {
    id: 'team_earnings',
    title: 'Agency / team earnings',
    category: 'Teams',
    windows: 'Month',
    note: 'team_earnings table is cumulative (no monthly window yet); scoped agency board deferred.',
  },
  { id: 'dating_matches', title: 'Most dating matches', category: 'Dating', windows: 'Week · Month' },
  { id: 'dating_likes_recv', title: 'Most dating likes received', category: 'Dating', windows: 'Week · Month' },
  { id: 'promote_spend', title: 'Promotion spenders', category: 'Economy', windows: 'Month' },
  { id: 'daily_streak', title: 'Daily reward streaks', category: 'Economy', windows: 'All time' },
  { id: 'friends_coin', title: 'Friends: coin spend', category: 'Social', windows: 'Week' },
  { id: 'global_score', title: 'Blyp Score (composite)', category: 'Later', windows: 'Week' },
];

export { CLUB_CATALOG, getClubById };

/**
 * @param {string} board
 * @param {{ limit?: number, window?: RankingWindow, clubId?: string }} [opts]
 */
export async function fetchRankingBoard(board, opts = {}) {
  const limit = opts.limit || 25;
  const window = opts.window || 'alltime';
  const params = { board, limit, window };
  if (opts.clubId) params.clubId = opts.clubId;
  return callEconomyBackend('/economy/rankings', 'GET', params);
}

export function formatScore(score, unit) {
  const n = Number(score) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function windowLabel(windowId) {
  const hit = RANKING_WINDOWS.find((w) => w.id === windowId);
  return hit?.label || 'All';
}
