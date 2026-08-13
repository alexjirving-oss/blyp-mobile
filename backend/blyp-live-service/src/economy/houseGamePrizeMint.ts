/**
 * Capped House mint for live-game prizes (Frenemies housePays, etc.).
 *
 * Credits spendable COIN (coin_balance) — NOT BONUS, NOT GEM, NOT cashable.
 * Distinct ledger entry_type so mints are auditable and not confused with
 * ADMIN_CREDIT / IAP-like free farm paths.
 *
 * Caps (defaults; override via env):
 *   HOUSE_GAME_PRIZE_MAX_PER_AWARD     = 500   (Frenemies / default)
 *   HOUSE_GAME_PRIZE_MAX_PER_USER_DAY  = 2000
 *   HOUSE_GAME_PRIZE_MAX_PER_STREAM    = 5000
 *   HOUSE_GAME_PRIZE_RD_MAX_PER_AWARD  = 15000 (Reaction Duel 3× stake)
 *   HOUSE_GAME_PRIZE_RD_MAX_PER_USER_DAY = 50000
 *   HOUSE_GAME_PRIZE_RD_MAX_PER_STREAM   = 100000
 */
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';
import { logger } from '../config/logger';

export const HOUSE_GAME_PRIZE_ENTRY_TYPE = 'HOUSE_GAME_PRIZE_MINT' as const;

export type HouseMintCaps = {
  maxPerAward: number;
  maxPerUserPerDay: number;
  maxPerStream: number;
};

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

/**
 * Frenemies housePays awards are ≤ MAX_COINS (500).
 * Reaction Duel mints the full 3× stake (max stake 5000 → 15000) after both
 * entries already burned their stakes — using Frenemies' 500/award default
 * would REJECT every preset ≥250 and leave stakes LOCKED (P0).
 */
export function getHouseMintCaps(
  game?: 'frenemies' | 'reaction_duel' | 'matchday' | 'live_game' | string,
): HouseMintCaps {
  if (game === 'reaction_duel') {
    return {
      maxPerAward: envInt('HOUSE_GAME_PRIZE_RD_MAX_PER_AWARD', 15_000, 1, 50_000),
      maxPerUserPerDay: envInt('HOUSE_GAME_PRIZE_RD_MAX_PER_USER_DAY', 50_000, 1, 500_000),
      maxPerStream: envInt('HOUSE_GAME_PRIZE_RD_MAX_PER_STREAM', 100_000, 1, 1_000_000),
    };
  }
  return {
    maxPerAward: envInt('HOUSE_GAME_PRIZE_MAX_PER_AWARD', 500, 1, 10_000),
    maxPerUserPerDay: envInt('HOUSE_GAME_PRIZE_MAX_PER_USER_DAY', 2000, 1, 100_000),
    maxPerStream: envInt('HOUSE_GAME_PRIZE_MAX_PER_STREAM', 5000, 1, 500_000),
  };
}

/** Pure gate used by tests + mint path. */
export function evaluateHouseMintCaps(args: {
  amount: number;
  userDayTotal: number;
  streamTotal: number;
  caps?: HouseMintCaps;
}): { ok: true; amount: number } | { ok: false; reason: string } {
  const caps = args.caps || getHouseMintCaps();
  const amount = Math.max(0, Math.floor(Number(args.amount) || 0));
  if (amount <= 0) return { ok: true, amount: 0 };
  if (amount > caps.maxPerAward) {
    return { ok: false, reason: `House prize exceeds per-award cap (${caps.maxPerAward})` };
  }
  if (args.userDayTotal + amount > caps.maxPerUserPerDay) {
    return {
      ok: false,
      reason: `House prize exceeds per-user daily cap (${caps.maxPerUserPerDay})`,
    };
  }
  if (args.streamTotal + amount > caps.maxPerStream) {
    return {
      ok: false,
      reason: `House prize exceeds per-stream cap (${caps.maxPerStream})`,
    };
  }
  return { ok: true, amount };
}

async function sumMinted(
  trx: Knex.Transaction,
  applyFilter: (qb: Knex.QueryBuilder) => void,
): Promise<number> {
  const qb = trx('ledger_entries').where({
    entry_type: HOUSE_GAME_PRIZE_ENTRY_TYPE,
    currency: 'COIN',
    status: 'POSTED',
  });
  applyFilter(qb);
  const row = await qb.sum({ total: 'amount' }).first();
  return Number((row as any)?.total || 0);
}

/**
 * Mint capped spendable COIN to a winner. Idempotent on idempotencyKey.
 * Does NOT use creditCoinsAdmin (ADMIN_CREDIT / BONUS farm path).
 */
export async function mintHouseGamePrize(args: {
  winnerUserId: string;
  amount: number;
  idempotencyKey: string;
  game: 'frenemies' | 'reaction_duel' | 'matchday' | 'live_game' | string;
  sessionId?: string | null;
  streamId?: string | null;
  referenceType: string;
  referenceId: string;
  reason?: string;
}): Promise<{ coins: number; replay: boolean; currency: 'COIN' }> {
  const amount = Math.max(0, Math.floor(Number(args.amount) || 0));
  if (amount <= 0) return { coins: 0, replay: false, currency: 'COIN' };

  const { db } = getEconomyInfra();
  const caps = getHouseMintCaps(args.game);

  try {
    return await db.transaction(async (trx) => {
      const existing = await trx('ledger_entries')
        .where({
          user_id: args.winnerUserId,
          idempotency_key: args.idempotencyKey,
          entry_type: HOUSE_GAME_PRIZE_ENTRY_TYPE,
        })
        .first();
      if (existing) {
        return {
          coins: Number(existing.amount),
          replay: true,
          currency: 'COIN' as const,
        };
      }

      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const userDayTotal = await sumMinted(trx, (qb) => {
        qb.where({ user_id: args.winnerUserId }).andWhere('created_at', '>=', dayStart.toISOString());
      });

      const streamKey = args.streamId || args.sessionId || null;
      let streamTotal = 0;
      if (streamKey) {
        streamTotal = await sumMinted(trx, (qb) => {
          qb.whereRaw(
            "(metadata->>'streamId' = ? OR metadata->>'sessionId' = ?)",
            [streamKey, streamKey],
          );
        });
      }

      const gate = evaluateHouseMintCaps({
        amount,
        userDayTotal,
        streamTotal,
        caps,
      });
      if (!gate.ok) {
        throw new EconomyError('RESTRICTED', 429, gate.reason);
      }

      await trx('wallets').insert({ user_id: args.winnerUserId }).onConflict('user_id').ignore();
      const wallet = await trx('wallets').where({ user_id: args.winnerUserId }).forUpdate().first();
      if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

      const after = BigInt(wallet.coin_balance || 0) + BigInt(gate.amount);
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(),
        user_id: args.winnerUserId,
        entry_type: HOUSE_GAME_PRIZE_ENTRY_TYPE,
        currency: 'COIN',
        amount: String(gate.amount),
        status: 'POSTED',
        reference_type: args.referenceType,
        reference_id: args.referenceId,
        idempotency_key: args.idempotencyKey,
        metadata: {
          game: args.game,
          sessionId: args.sessionId || null,
          streamId: args.streamId || args.sessionId || null,
          reason: args.reason || null,
          source: 'house_game_prize_mint',
          caps,
          payoutVersion: 2,
        },
      });
      await trx('wallets')
        .where({ user_id: args.winnerUserId })
        .update({
          coin_balance: after.toString(),
          updated_at: trx.fn.now(),
        });

      return { coins: gate.amount, replay: false, currency: 'COIN' as const };
    });
  } catch (e: any) {
    if (e instanceof EconomyError) throw e;
    logger.error({ err: e?.message, key: args.idempotencyKey }, '[houseMint] failed');
    throw e;
  }
}
