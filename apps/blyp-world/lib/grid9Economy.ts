/**
 * Grid 9 / Nuke economy math (Alex rulesVersion 2026-08-16.8).
 * Mirrors backend/blyp-live-service/src/games/grid9/constants.ts — keep in sync.
 *
 * Gift face F:
 * - Player (recipient) credited F (100% of coins gifted)
 * - Jackpot += floor(F * 0.10) as a *platform match* (viewer debit stays F)
 * - HP delta = F (damage or heal)
 *
 * Match clock: 60 minutes; last standing wins early; at deadline pick highest
 * effective HP (health+shield), then health, damageDealt, lowest slot.
 *
 * Buyback: GRID9_BUYBACK_COST_COINS (500) — 100% to jackpot; revive at 1000 HP.
 *
 * Settlement tokens:
 * - Knockout = floor(finishingFaceCoins * 0.5)  (e.g. 500 → 250)
 * - Winner = floor(seatShareCoins * 0.5) + floor(jackpotCoins * 0.5)
 */

export const GRID9_MAX_HEALTH = 1000;
/** 100% of gift face to the recipient seat. */
export const GRID9_AUDIENCE_GIFT_SEAT_BPS = 10_000;
/** Additive pot match: +10% of face (not skimmed from the player). */
export const GRID9_AUDIENCE_GIFT_JACKPOT_BPS = 1000;
export const GRID9_TOKEN_PAYOUT_BPS = 5000;
export const GRID9_HOUSE_JACKPOT_SEED = 100;
/** Timed match length (ms). */
export const GRID9_MAX_MATCH_DURATION_MS = 60 * 60 * 1_000;
/**
 * Invented buyback price (Alex did not specify). 100% → jackpot.
 */
export const GRID9_BUYBACK_COST_COINS = 500;

/** Demo Nuke strike face value when director clicks a cell offline. */
export const GRID9_NUKE_DEMO_FACE_COINS = 500;

export function splitGrid9AudienceGiftCoins(amountCoins: number): {
  seatCoins: number;
  jackpotCoins: number;
} {
  const amount = Math.floor(Number(amountCoins) || 0);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { seatCoins: 0, jackpotCoins: 0 };
  }
  const seatCoins = Math.floor((amount * GRID9_AUDIENCE_GIFT_SEAT_BPS) / 10_000);
  const jackpotCoins = Math.floor(
    (amount * GRID9_AUDIENCE_GIFT_JACKPOT_BPS) / 10_000,
  );
  return { seatCoins, jackpotCoins };
}

/** tokens = floor(coins * 0.5) — KO and jackpot/winner share the same rate. */
export function tokensFromCoins(coinValue: number): number {
  const coins = Math.floor(Number(coinValue) || 0);
  if (!Number.isSafeInteger(coins) || coins <= 0) return 0;
  return Math.floor((coins * GRID9_TOKEN_PAYOUT_BPS) / 10_000);
}

export function applyHpDelta(
  health: number,
  delta: number,
  maxHealth = GRID9_MAX_HEALTH,
): { health: number; eliminated: boolean } {
  const next = Math.max(0, Math.min(maxHealth, health + delta));
  return { health: next, eliminated: next <= 0 };
}

export type GiftHpKind = "damage" | "heal";

export function giftHpDelta(faceCoins: number, kind: GiftHpKind): number {
  const face = Math.max(0, Math.floor(Number(faceCoins) || 0));
  return kind === "heal" ? face : -face;
}

export function winnerTokenPayout(args: {
  seatShareCoins: number;
  jackpotCoins: number;
}): number {
  return tokensFromCoins(args.seatShareCoins) + tokensFromCoins(args.jackpotCoins);
}

export function knockoutTokenPayout(finishingFaceCoins: number): number {
  return tokensFromCoins(finishingFaceCoins);
}

/** Format remaining ms as M:SS or H:MM:SS for the studio clock. */
export function formatMatchClock(remainingMs: number): string {
  const ms = Math.max(0, Math.floor(remainingMs));
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Deterministic finale among survivors (same order as live-service winnerAtDeadline):
 * 1) highest health + shieldPoints
 * 2) highest health
 * 3) highest damageDealt
 * 4) lowest slot index
 */
export function pickFinaleWinnerSlotIndex(
  seats: Array<{
    slotIndex: number;
    health: number;
    shields: number;
    damageDealt?: number;
    knockedOut?: boolean;
  }>,
): number | null {
  const alive = seats.filter((s) => !s.knockedOut && s.health > 0);
  if (alive.length === 0) return null;
  const sorted = alive.slice().sort(
    (a, b) =>
      b.health +
        b.shields -
        (a.health + a.shields) ||
      b.health - a.health ||
      (b.damageDealt ?? 0) - (a.damageDealt ?? 0) ||
      a.slotIndex - b.slotIndex,
  );
  return sorted[0]?.slotIndex ?? null;
}
