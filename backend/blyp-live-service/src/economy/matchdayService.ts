import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';
import { emitMatchdayEvent } from '../realtime/realtimeBus';
import type {
  MatchdayPredictionPlaceInput,
  MatchdayPredictionSettleInput,
  MatchdayPurchaseInput,
} from './economySchemas';

// Matchday Live is monetized through the existing BlypCoins wallet. Prediction
// prizes pay out in BONUS_COIN by default (non-cashable) so the pari-mutuel pool
// keeps the same low-risk posture as the existing live-games engine.

function nowIso() {
  return new Date().toISOString();
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

export function getMatchdayPricing() {
  const unlockCoins = envInt('MATCHDAY_UNLOCK_COINS', 50, 0, 1_000_000);
  const entitlementTtlHours = envInt('MATCHDAY_ENTITLEMENT_TTL_HOURS', 6, 1, 72);
  const predictionMinStake = envInt('MATCHDAY_PREDICTION_MIN_STAKE', 5, 1, 1_000_000);
  const predictionMaxStake = envInt('MATCHDAY_PREDICTION_MAX_STAKE', 1000, 1, 1_000_000);
  return { unlockCoins, entitlementTtlHours, predictionMinStake, predictionMaxStake };
}

async function ensureWalletRow(trx: Knex.Transaction, userId: string) {
  await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
  const row = await trx('wallets').where({ user_id: userId }).first();
  if (!row) throw new EconomyError('INTERNAL', 500, 'Failed to load wallet');
  return row;
}

// Bonus-first debit, mirroring debitCoinsForPromotion. Returns balances after spend.
async function debitCoins(
  trx: Knex.Transaction,
  userId: string,
  totalCostCoins: bigint,
  idempotencyKey: string,
  entryType: string,
  referenceType: string,
  referenceId: string,
  meta: Record<string, any>
) {
  await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
  const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
  if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

  const bonus = BigInt(wallet.bonus_coin_balance);
  const paid = BigInt(wallet.coin_balance);

  const useBonus = bonus >= totalCostCoins ? totalCostCoins : bonus;
  const usePaid = totalCostCoins - useBonus;
  if (paid < usePaid) throw new EconomyError('INSUFFICIENT_FUNDS', 409, 'Insufficient funds');

  if (usePaid > 0n) {
    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: userId,
      entry_type: entryType,
      currency: 'COIN',
      amount: (-usePaid).toString(),
      status: 'POSTED',
      reference_type: referenceType,
      reference_id: referenceId,
      idempotency_key: `${idempotencyKey}:COIN`,
      metadata: meta,
    });
  }
  if (useBonus > 0n) {
    await trx('ledger_entries').insert({
      ledger_id: randomUUID(),
      user_id: userId,
      entry_type: entryType,
      currency: 'BONUS_COIN',
      amount: (-useBonus).toString(),
      status: 'POSTED',
      reference_type: referenceType,
      reference_id: referenceId,
      idempotency_key: `${idempotencyKey}:BONUS`,
      metadata: meta,
    });
  }

  await trx('wallets')
    .where({ user_id: userId })
    .update({
      coin_balance: (paid - usePaid).toString(),
      bonus_coin_balance: (bonus - useBonus).toString(),
      lifetime_spend_coins: (BigInt(wallet.lifetime_spend_coins) + totalCostCoins).toString(),
      updated_at: trx.fn.now(),
    });

  const updated = await trx('wallets').where({ user_id: userId }).first();
  return {
    coinBalance: Number(updated?.coin_balance ?? 0),
    bonusCoinBalance: Number(updated?.bonus_coin_balance ?? 0),
  };
}

// Credit a refund/payout into BONUS_COIN (non-cashable, matches SAFE live-game mode).
async function creditBonus(
  trx: Knex.Transaction,
  userId: string,
  amount: bigint,
  idempotencyKey: string,
  entryType: string,
  referenceType: string,
  referenceId: string,
  meta: Record<string, any>
) {
  if (amount <= 0n) return;
  await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
  const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
  if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');

  await trx('wallets')
    .where({ user_id: userId })
    .update({
      bonus_coin_balance: (BigInt(wallet.bonus_coin_balance) + amount).toString(),
      updated_at: trx.fn.now(),
    });

  await trx('ledger_entries').insert({
    ledger_id: randomUUID(),
    user_id: userId,
    entry_type: entryType,
    currency: 'BONUS_COIN',
    amount: amount.toString(),
    status: 'POSTED',
    reference_type: referenceType,
    reference_id: referenceId,
    idempotency_key: `${idempotencyKey}:${userId}`,
    metadata: meta,
  });
}

function serializeEntitlement(row: any) {
  return {
    entitlementId: row.entitlement_id,
    eventId: row.event_id,
    status: row.status,
    coinCost: Number(row.coin_cost),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function isEntitlementLive(row: any): boolean {
  if (!row || row.status !== 'ACTIVE') return false;
  if (!row.expires_at) return true;
  return new Date(row.expires_at).getTime() > Date.now();
}

export async function checkMatchdayEntitlement(userId: string, eventId: string) {
  const { db } = getEconomyInfra();
  const pricing = getMatchdayPricing();

  const row = await db('matchday_entitlements').where({ user_id: userId, event_id: eventId }).first();
  const wallet = await db('wallets').where({ user_id: userId }).first();

  return {
    eventId,
    entitled: isEntitlementLive(row),
    entitlement: row ? serializeEntitlement(row) : null,
    priceCoins: pricing.unlockCoins,
    wallet: {
      coinBalance: Number(wallet?.coin_balance ?? 0),
      bonusCoinBalance: Number(wallet?.bonus_coin_balance ?? 0),
    },
  };
}

export async function purchaseMatchdayEntitlement(userId: string, input: MatchdayPurchaseInput) {
  const { db } = getEconomyInfra();
  const pricing = getMatchdayPricing();
  const coins = BigInt(pricing.unlockCoins);
  const { eventId, idempotencyKey, eventMeta } = input;

  return await db.transaction(async (trx) => {
    // True idempotency replay (same key).
    const replay = await trx('matchday_entitlements').where({ user_id: userId, idempotency_key: idempotencyKey }).first();
    if (replay) {
      const wallet = await ensureWalletRow(trx, userId);
      return {
        kind: 'replay' as const,
        response: {
          entitlement: serializeEntitlement(replay),
          newBalances: { coinBalance: Number(wallet.coin_balance), bonusCoinBalance: Number(wallet.bonus_coin_balance) },
        },
      };
    }

    // Already entitled for this event (different key) → return without charging again.
    const existing = await trx('matchday_entitlements').where({ user_id: userId, event_id: eventId }).first();
    if (existing && isEntitlementLive(existing)) {
      const wallet = await ensureWalletRow(trx, userId);
      return {
        kind: 'replay' as const,
        response: {
          entitlement: serializeEntitlement(existing),
          newBalances: { coinBalance: Number(wallet.coin_balance), bonusCoinBalance: Number(wallet.bonus_coin_balance) },
        },
      };
    }

    const entitlementId = randomUUID();
    const expiresAt = new Date(Date.now() + pricing.entitlementTtlHours * 60 * 60 * 1000);
    const meta = {
      originalIdempotencyKey: idempotencyKey,
      eventMeta: eventMeta ?? null,
    };

    let resolvedBalances: { coinBalance: number; bonusCoinBalance: number };
    if (coins > 0n) {
      resolvedBalances = await debitCoins(
        trx,
        userId,
        coins,
        idempotencyKey,
        'MATCHDAY_UNLOCK',
        'MATCHDAY_ENTITLEMENT',
        entitlementId,
        meta
      );
    } else {
      const w = await ensureWalletRow(trx, userId);
      resolvedBalances = { coinBalance: Number(w.coin_balance), bonusCoinBalance: Number(w.bonus_coin_balance) };
    }

    // If a stale/expired row exists, replace it (UNIQUE on user_id+event_id).
    if (existing) {
      await trx('matchday_entitlements').where({ entitlement_id: existing.entitlement_id }).delete();
    }

    await trx('matchday_entitlements').insert({
      entitlement_id: entitlementId,
      user_id: userId,
      event_id: eventId,
      status: 'ACTIVE',
      coin_cost: coins.toString(),
      expires_at: expiresAt.toISOString(),
      idempotency_key: idempotencyKey,
      metadata: meta,
      created_at: nowIso(),
    });

    const row = await trx('matchday_entitlements').where({ entitlement_id: entitlementId }).first();

    return {
      kind: 'ok' as const,
      response: {
        entitlement: serializeEntitlement(row),
        newBalances: resolvedBalances,
      },
    };
  });
}

async function requireActiveEntitlement(trx: Knex.Transaction, userId: string, eventId: string) {
  const row = await trx('matchday_entitlements').where({ user_id: userId, event_id: eventId }).first();
  if (!isEntitlementLive(row)) {
    throw new EconomyError('RESTRICTED', 403, 'Matchday entitlement required');
  }
}

const VALID_MARKETS = new Set(['SCORELINE', 'FIRST_SCORER', 'RESULT']);

export async function placeMatchdayPrediction(userId: string, input: MatchdayPredictionPlaceInput) {
  const { db } = getEconomyInfra();
  const pricing = getMatchdayPricing();
  const { eventId, market, selection, stakeCoins, idempotencyKey } = input;

  if (!VALID_MARKETS.has(market)) throw new EconomyError('INVALID_INPUT', 400, 'Unknown market');
  if (stakeCoins < pricing.predictionMinStake || stakeCoins > pricing.predictionMaxStake) {
    throw new EconomyError('INVALID_INPUT', 400, `Stake must be ${pricing.predictionMinStake}-${pricing.predictionMaxStake} coins`);
  }
  const stake = BigInt(stakeCoins);

  return await db.transaction(async (trx) => {
    const replay = await trx('matchday_predictions').where({ user_id: userId, idempotency_key: idempotencyKey }).first();
    if (replay) {
      const wallet = await ensureWalletRow(trx, userId);
      return {
        kind: 'replay' as const,
        response: {
          prediction: serializePrediction(replay),
          newBalances: { coinBalance: Number(wallet.coin_balance), bonusCoinBalance: Number(wallet.bonus_coin_balance) },
        },
      };
    }

    await requireActiveEntitlement(trx, userId, eventId);

    // One prediction per market per event keeps settlement deterministic.
    const dup = await trx('matchday_predictions').where({ user_id: userId, event_id: eventId, market }).first();
    if (dup) throw new EconomyError('CONFLICT', 409, 'Prediction already placed for this market');

    const predictionId = randomUUID();
    const meta = { originalIdempotencyKey: idempotencyKey, eventId, market };
    const newBalances = await debitCoins(
      trx,
      userId,
      stake,
      idempotencyKey,
      'MATCHDAY_PREDICTION_STAKE',
      'MATCHDAY_PREDICTION',
      predictionId,
      meta
    );

    await trx('matchday_predictions').insert({
      prediction_id: predictionId,
      user_id: userId,
      event_id: eventId,
      market,
      selection: String(selection).trim(),
      stake_coins: stake.toString(),
      status: 'OPEN',
      payout_coins: '0',
      idempotency_key: idempotencyKey,
      metadata: meta,
      created_at: nowIso(),
    });

    const row = await trx('matchday_predictions').where({ prediction_id: predictionId }).first();
    return { kind: 'ok' as const, response: { prediction: serializePrediction(row), newBalances } };
  });
}

function serializePrediction(row: any) {
  return {
    predictionId: row.prediction_id,
    eventId: row.event_id,
    market: row.market,
    selection: row.selection,
    stakeCoins: Number(row.stake_coins),
    status: row.status,
    payoutCoins: Number(row.payout_coins),
    createdAt: new Date(row.created_at).toISOString(),
    settledAt: row.settled_at ? new Date(row.settled_at).toISOString() : null,
  };
}

export async function getMatchdayPredictions(userId: string, eventId: string) {
  const { db } = getEconomyInfra();

  const mine = await db('matchday_predictions')
    .where({ user_id: userId, event_id: eventId })
    .orderBy('created_at', 'asc');

  const pools = await db('matchday_predictions')
    .where({ event_id: eventId })
    .select('market')
    .sum<{ pool: string; market: string; entrants: string }[]>({ pool: 'stake_coins' })
    .count({ entrants: '*' })
    .groupBy('market');

  return {
    eventId,
    predictions: mine.map(serializePrediction),
    pools: pools.map((p: any) => ({ market: p.market, poolCoins: Number(p.pool ?? 0), entrants: Number(p.entrants ?? 0) })),
  };
}

function winningSelectionFor(market: string, result: MatchdayPredictionSettleInput['result']): string | null {
  if (market === 'RESULT') return result.winner ?? null;
  if (market === 'SCORELINE') {
    if (result.homeScore == null || result.awayScore == null) return null;
    return `${result.homeScore}-${result.awayScore}`;
  }
  if (market === 'FIRST_SCORER') {
    return result.firstScorer ? String(result.firstScorer).trim().toLowerCase() : null;
  }
  return null;
}

function selectionMatches(market: string, selection: string, winning: string): boolean {
  if (market === 'FIRST_SCORER') return String(selection).trim().toLowerCase() === winning;
  return String(selection).trim().toUpperCase() === String(winning).toUpperCase();
}

// Idempotent per event. Pari-mutuel: each market's pool is split among correct
// selections proportional to stake. VOID/abandoned matches refund all stakes.
export async function settleMatchdayPredictions(userId: string, input: MatchdayPredictionSettleInput) {
  const { db } = getEconomyInfra();
  const { eventId, idempotencyKey, result } = input;

  const out = await db.transaction(async (trx) => {
    const settled = await trx('matchday_settlements').where({ event_id: eventId }).first();
    if (settled) {
      return { kind: 'replay' as const, response: settled.response_json };
    }

    const open = await trx('matchday_predictions')
      .where({ event_id: eventId, status: 'OPEN' })
      .orderBy('created_at', 'asc');

    const voidAll = result.status === 'VOID';
    const byMarket = new Map<string, any[]>();
    for (const p of open) {
      const list = byMarket.get(p.market) || [];
      list.push(p);
      byMarket.set(p.market, list);
    }

    const settledMarkets: any[] = [];

    for (const [market, preds] of byMarket.entries()) {
      const pool = preds.reduce((acc, p) => acc + BigInt(p.stake_coins), 0n);
      const winning = voidAll ? null : winningSelectionFor(market, result);

      // Refund the whole market when the match is void, the market is unresolvable,
      // or nobody backed the winning selection.
      let winners: any[] = [];
      if (!voidAll && winning != null) {
        winners = preds.filter((p) => selectionMatches(market, p.selection, winning));
      }
      const winnerStakeTotal = winners.reduce((acc, p) => acc + BigInt(p.stake_coins), 0n);

      if (voidAll || winning == null || winnerStakeTotal === 0n) {
        for (const p of preds) {
          await creditBonus(
            trx,
            p.user_id,
            BigInt(p.stake_coins),
            `${idempotencyKey}:refund:${p.prediction_id}`,
            'MATCHDAY_PREDICTION_REFUND',
            'MATCHDAY_PREDICTION',
            p.prediction_id,
            { eventId, market, reason: voidAll ? 'void' : 'no_winners' }
          );
          await trx('matchday_predictions').where({ prediction_id: p.prediction_id }).update({
            status: 'REFUNDED',
            payout_coins: p.stake_coins,
            settled_at: nowIso(),
          });
        }
        settledMarkets.push({ market, poolCoins: Number(pool), outcome: 'REFUNDED', winners: 0 });
        continue;
      }

      let distributed = 0n;
      for (let i = 0; i < winners.length; i++) {
        const p = winners[i];
        const isLast = i === winners.length - 1;
        const share = isLast ? pool - distributed : (pool * BigInt(p.stake_coins)) / winnerStakeTotal;
        distributed += share;
        await creditBonus(
          trx,
          p.user_id,
          share,
          `${idempotencyKey}:payout:${p.prediction_id}`,
          'MATCHDAY_PREDICTION_PAYOUT',
          'MATCHDAY_PREDICTION',
          p.prediction_id,
          { eventId, market }
        );
        await trx('matchday_predictions').where({ prediction_id: p.prediction_id }).update({
          status: 'WON',
          payout_coins: share.toString(),
          settled_at: nowIso(),
        });
      }
      const winnerIds = new Set(winners.map((w) => w.prediction_id));
      for (const p of preds) {
        if (winnerIds.has(p.prediction_id)) continue;
        await trx('matchday_predictions').where({ prediction_id: p.prediction_id }).update({
          status: 'LOST',
          payout_coins: '0',
          settled_at: nowIso(),
        });
      }
      settledMarkets.push({ market, poolCoins: Number(pool), outcome: 'SETTLED', winners: winners.length });
    }

    const response = {
      eventId,
      status: voidAll ? 'VOID' : 'COMPLETED',
      settledBy: userId,
      result,
      markets: settledMarkets,
      settledAt: nowIso(),
    };

    await trx('matchday_settlements').insert({
      settlement_id: randomUUID(),
      event_id: eventId,
      settled_by: userId,
      idempotency_key: idempotencyKey,
      response_json: response,
      created_at: nowIso(),
    });

    return { kind: 'ok' as const, response };
  });

  emitMatchdayEvent(eventId, { type: 'matchday_settled', eventId, status: out.response.status });
  return out;
}

export async function getMatchdayLeaderboard(eventId?: string) {
  const { db } = getEconomyInfra();

  const q = db('matchday_predictions')
    .select('user_id')
    .sum<{ user_id: string; staked: string; won: string; plays: string }[]>({ staked: 'stake_coins' })
    .sum({ won: 'payout_coins' })
    .count({ plays: '*' })
    .whereIn('status', ['WON', 'LOST', 'REFUNDED'])
    .groupBy('user_id')
    .limit(50);

  if (eventId) q.andWhere({ event_id: eventId });

  const rows = await q;
  const entries = rows
    .map((r: any) => ({
      userId: r.user_id,
      staked: Number(r.staked ?? 0),
      won: Number(r.won ?? 0),
      net: Number(r.won ?? 0) - Number(r.staked ?? 0),
      plays: Number(r.plays ?? 0),
    }))
    .sort((a, b) => b.net - a.net || b.won - a.won)
    .slice(0, 50)
    .map((e, idx) => ({ rank: idx + 1, ...e }));

  return { eventId: eventId ?? null, scope: eventId ? 'match' : 'season', entries };
}

export async function reactMatchday(userId: string, eventId: string, emoji: string) {
  const payload = {
    type: 'matchday_reaction' as const,
    eventId,
    emoji,
    userId,
    ts: Date.now(),
  };
  emitMatchdayEvent(eventId, payload);
  return { ok: true, ...payload };
}
