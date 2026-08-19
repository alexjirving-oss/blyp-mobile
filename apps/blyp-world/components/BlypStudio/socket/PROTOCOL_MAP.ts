/**
 * BlypStudio ↔ Grid 9 live-service protocol map (Phase 5).
 *
 * Source of truth: backend/blyp-live-service/src/games/grid9/protocol.ts
 * Channel: socket.io event name `grid9` (GRID9_SOCKET_CHANNEL).
 *
 * Economy (Alex rulesVersion 2026-08-16.8):
 * - maxHealth 1000; gift/weapon face coins = HP delta
 * - Player gets 100% of gift face F; jackpot += floor(F*0.10) platform match
 *   (viewer debit stays F — pot is not skimmed from the player)
 * - Timed match 60 minutes; last standing wins early; deadline = highest HP+shield
 * - Buyback 500 coins → 100% jackpot; revive at 1000 HP
 * - KO tokens = floor(finishingFaceCoins * 0.5)
 * - Winner tokens = floor(seatShare * 0.5) + floor(jackpot * 0.5)
 *
 * Alex alias → real protocol (do NOT emit invented names):
 * | Studio / Alex name     | Real client intent / server event                         | Status |
 * |------------------------|-----------------------------------------------------------|--------|
 * | START_ROULETTE         | (none) — server emits ROULETTE_START / ROULETTE_LAND      | listen only; Spin uses mock UI unless host START_PRIVATE_MATCH |
 * | FILL_SENTINELS         | (none) — server fills sentinels in matchmaker/lobby       | mock only |
 * | GRID9_GIFT_DROP        | SEND_ARSENAL_GIFT intent; ARSENAL_GRANTED (+ HP/KO) + JACKPOT_CHANGED | listen |
 * | BUYBACK                | BUYBACK intent; PLAYER_BUYBACK                            | emit when KO'd in match |
 * | Reset Match            | MATCH_LEAVE (if in match); no full “reset lobby” intent   | partial |
 * | Kick                   | KICK_PLAYER (owner only)                                  | emit if host |
 * | Start private match    | START_PRIVATE_MATCH (owner only)                          | emit if host |
 *
 * Host claim: userId (Cognito sub) === PRIVATE_ROOM_STATUS.ownerUserId
 *             or STATE_SNAPSHOT.state.ownerUserId
 */

export const GRID9_SOCKET_CHANNEL = "grid9" as const;
export const GRID9_PROTOCOL = "grid9.ws" as const;
export const GRID9_PROTOCOL_VERSION = 2 as const;

export const STUDIO_TO_GRID9_MAP = {
  spinRoulette: {
    alexAlias: "START_ROULETTE",
    emit: null as string | null,
    hostEmitFallback: "START_PRIVATE_MATCH",
    listen: ["ROULETTE_START", "ROULETTE_LAND"] as const,
    note: "Roulette is server-authoritative; no START_ROULETTE client intent.",
  },
  autoFillSentinels: {
    alexAlias: "FILL_SENTINELS",
    emit: null as string | null,
    listen: [] as const,
    note: "No FILL_SENTINELS intent — studio keeps local mock fill.",
  },
  giftDrop: {
    alexAlias: "GRID9_GIFT_DROP",
    emit: "SEND_ARSENAL_GIFT",
    listen: ["ARSENAL_GRANTED", "JACKPOT_CHANGED"] as const,
    note: "Economy updates from ARSENAL_GRANTED.seatCoins/jackpotCoins/health + JACKPOT_CHANGED.",
  },
  buyback: {
    alexAlias: "BUYBACK",
    emit: "BUYBACK",
    listen: ["PLAYER_BUYBACK", "MATCH_COMPLETED"] as const,
    note: "KO buyback: 500 coins → jackpot 100%; revive at maxHealth.",
  },
  resetMatch: {
    alexAlias: "RESET_MATCH",
    emit: "MATCH_LEAVE",
    listen: ["MATCH_COMPLETED"] as const,
    note: "Leave match if joined; local lobby reset always.",
  },
  kick: {
    alexAlias: "KICK",
    emit: "KICK_PLAYER",
    listen: ["PRIVATE_ROOM_STATUS"] as const,
    note: "Owner-only.",
  },
} as const;
