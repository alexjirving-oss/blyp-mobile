// rankingsService.js
//
// Client for the Rankings hub (Phase 0). Live boards hit the economy backend
// (coin spend / gem earn / most followed). Battle glory deep-links the existing
// BattleLeaderboard screen. Remaining catalog tiles are Coming soon.

import { callEconomyBackend } from '../api/economyLiveApi';

/** @typedef {'coin_spend'|'gem_earn'|'followers_total'|'battle_glory'} LiveBoardId */

export const LIVE_BOARDS = [
  {
    id: 'coin_spend',
    title: 'Top coin spenders',
    blurb: 'All-time coins spent on gifts, promos and live.',
    icon: 'wallet',
    category: 'Economy',
    unit: 'coins',
    source: 'economy',
  },
  {
    id: 'gem_earn',
    title: 'Top gem earners',
    blurb: 'All-time gems earned from gifts received.',
    icon: 'diamond',
    category: 'Economy',
    unit: 'gems',
    source: 'economy',
  },
  {
    id: 'followers_total',
    title: 'Most followed',
    blurb: 'Creators with the most followers right now.',
    icon: 'people',
    category: 'Social',
    unit: 'followers',
    source: 'economy',
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
  },
];

/** Coming-soon catalog so the hub feels full (names match product plan). */
export const COMING_SOON_BOARDS = [
  { id: 'coin_earn', title: 'Highest coin earner', category: 'Economy', windows: 'Day · Week · Month · Year' },
  { id: 'coin_spend_windowed', title: 'Coin spenders (windows)', category: 'Economy', windows: 'Day · Week · Month · Year' },
  { id: 'gem_earn_windowed', title: 'Gem earners (windows)', category: 'Economy', windows: 'Day · Week · Month · Year' },
  { id: 'gifts_sent', title: 'Most gifts sent', category: 'Economy', windows: 'Day · Week · Month · Year' },
  { id: 'gifts_recv', title: 'Most gifted creator', category: 'Economy', windows: 'Day · Week · Month · Year' },
  { id: 'followers_delta', title: 'Most new followers', category: 'Social', windows: 'Day · Week · Month · Year' },
  { id: 'following_growth', title: 'Fastest growing', category: 'Social', windows: 'Week · Month' },
  { id: 'posts_created', title: 'Most posts', category: 'Social', windows: 'Day · Week · Month · Year' },
  { id: 'likes_recv', title: 'Most likes received', category: 'Social', windows: 'Day · Week · Month · Year' },
  { id: 'comments_recv', title: 'Most comments received', category: 'Social', windows: 'Day · Week · Month · Year' },
  { id: 'watch_time', title: 'Most watch time', category: 'Live', windows: 'Day · Week · Month · Year' },
  { id: 'live_hours', title: 'Most hours live', category: 'Live', windows: 'Day · Week · Month · Year' },
  { id: 'peak_viewers', title: 'Highest peak viewers', category: 'Live', windows: 'Day · Week · Month · Year' },
  { id: 'avg_viewers', title: 'Highest avg concurrent', category: 'Live', windows: 'Week · Month' },
  { id: 'battle_wins', title: 'Battles won', category: 'Competitive', windows: 'Week · Month · All time' },
  { id: 'battle_streak', title: 'Longest battle streak', category: 'Competitive', windows: 'All time' },
  { id: 'marble_wins', title: 'Marble race wins', category: 'Games', windows: 'Day · Week · Month · Year' },
  { id: 'marble_podium', title: 'Marble podium finishes', category: 'Games', windows: 'Week · Month' },
  { id: 'live_game_wins', title: 'Live mini-game wins', category: 'Games', windows: 'Day · Week · Month' },
  { id: 'matchday_net', title: 'Matchday prediction net', category: 'Games', windows: 'Event · Season' },
  { id: 'club_coin_spend', title: 'Club: top spenders', category: 'Clubs', windows: 'Week · Month' },
  { id: 'club_followers', title: 'Club: rising members', category: 'Clubs', windows: 'Week · Month' },
  { id: 'league_posts', title: 'League / sport: top posters', category: 'Leagues', windows: 'Week · Month' },
  { id: 'league_live', title: 'League / sport: top live hosts', category: 'Leagues', windows: 'Week · Month' },
  { id: 'team_earnings', title: 'Agency / team earnings', category: 'Teams', windows: 'Month' },
  { id: 'dating_matches', title: 'Most dating matches', category: 'Dating', windows: 'Week · Month' },
  { id: 'dating_likes_recv', title: 'Most dating likes received', category: 'Dating', windows: 'Week · Month' },
  { id: 'promote_spend', title: 'Promotion spenders', category: 'Economy', windows: 'Month' },
  { id: 'daily_streak', title: 'Daily reward streaks', category: 'Economy', windows: 'All time' },
  { id: 'friends_coin', title: 'Friends: coin spend', category: 'Social', windows: 'Week' },
  { id: 'global_score', title: 'Blyp Score (composite)', category: 'Later', windows: 'Week' },
];

/**
 * @param {string} board
 * @param {{ limit?: number }} [opts]
 */
export async function fetchRankingBoard(board, opts = {}) {
  const limit = opts.limit || 25;
  return callEconomyBackend('/economy/rankings', 'GET', { board, limit });
}

export function formatScore(score, unit) {
  const n = Number(score) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
