/**
 * Teams economy (marketing + desk). Match product copy — do not invent tiers.
 *
 * Gift spend → 50% creator gems / 50% Blyp.
 * Agency earns 10% of roster gift spend, paid from Blyp’s half.
 * Applies to ALL gift surfaces: LIVE, posts, messages, dating — not LIVE-only.
 * Creators keep 100% of their half. No 30% withdraw fee on Blyp.
 *
 * Backend: applyTeamGiftBonus runs after every successful economy /gift/send
 * (no LIVE-only gate). Chat/dating use GiftSystem with streamId like chat:… .
 */
export const CREATOR_GIFT_SHARE = 0.5;
export const BLYP_GIFT_SHARE = 0.5;
export const AGENCY_RATE_BASE = 0.1;
/** @deprecated Product lock: agency cut copy is 10% only. Kept for type compat. */
export const AGENCY_RATE_GROWTH = 0.1;
export type AgencyTier = "base" | "growth";
export function agencyRate(tier: AgencyTier = "base"): number {
  void tier;
  return AGENCY_RATE_BASE;
}
/** If creators received `creatorGems` as their 50% half, estimate total gift spend. */
export function estimateGiftSpendFromCreatorGems(creatorGems: number): number {
  const n = Number(creatorGems) || 0;
  if (n <= 0) return 0;
  return n / CREATOR_GIFT_SHARE;
}
/** Agency cut from total gift spend (paid from Blyp half — never from creator gems). */
export function estimateAgencyEarnings(
  giftSpend: number,
  tier: AgencyTier = "base",
): number {
  const spend = Number(giftSpend) || 0;
  if (spend <= 0) return 0;
  return spend * agencyRate(tier);
}
export function formatEconomyShort(n: number): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}
export const ECONOMY_BULLETS = [
  "50/50 split — creators keep 100% of their half.",
  "You earn 10% from Blyp’s half on every gift to your roster: LIVE, posts, messages, dating.",
  "No 30% withdraw fee. Guest gifts go to the gifted person.",
] as const;
export const MONEY_CARD_LEAD =
  "Your cut is 10% from Blyp’s half — on all gifts to your roster (LIVE, posts, messages, dating), not LIVE-only.";
