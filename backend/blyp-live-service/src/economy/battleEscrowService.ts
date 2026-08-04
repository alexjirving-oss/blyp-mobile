/**
 * Battle escrow — the attendance bond for staked battles.
 *
 * Money rules (from product):
 *  - Both sides stake the SAME number of coins. The deposit is an ATTENDANCE
 *    bond, not a wager on who wins.
 *  - Settled in COINS at face value (never gems — gem conversion only ever
 *    happens on gifting). Credited to the spendable coin balance.
 *  - both turn up   -> each gets their own stake back
 *  - one turns up   -> that person takes the whole pot
 *  - neither turns up -> the platform keeps it
 *
 * Authoritative + idempotent: the live-service owns the wallet AND records who
 * actually went live, so it alone decides the payout. Every credit/debit is a
 * ledger row with a unique idempotency key; settlement is one-shot per battle.
 */

import { randomUUID } from 'crypto';
import { getEconomyInfra } from './infra';
import { EconomyError } from './economyErrors';
import { ensureEconomySchema } from './schema';
import type { Knex } from 'knex';
import type { BattleDepositInput } from './economySchemas';

function nowIso() {
  return new Date().toISOString();
}

type EscrowRow = {
  battle_id: string;
  creator_uid: string;
  opponent_uid: string;
  stake_coins: string;
  pool_coins: string;
  creator_paid: boolean;
  opponent_paid: boolean;
  creator_paid_coins: string;
  opponent_paid_coins: string;
  creator_joined: boolean;
  opponent_joined: boolean;
  status: string;
  settlement_json: any;
};

function sideOf(row: { creator_uid: string; opponent_uid: string }, uid: string): 'creator' | 'opponent' | null {
  if (row.creator_uid === uid) return 'creator';
  if (row.opponent_uid === uid) return 'opponent';
  return null;
}

/** Credit COINS (face value) to a user's spendable balance with a ledger row. */
async function creditCoins(
  trx: Knex.Transaction,
  userId: string,
  amount: bigint,
  battleId: string,
  idempotencyKey: string,
  role: string
): Promise<void> {
  if (amount <= 0n) return;
  await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
  const w = await trx('wallets').where({ user_id: userId }).forUpdate().first();
  if (!w) throw new EconomyError('INTERNAL', 500, 'Wallet missing');
  await trx('wallets').where({ user_id: userId }).update({
    coin_balance: (BigInt(w.coin_balance) + amount).toString(),
    updated_at: trx.fn.now(),
  });
  await trx('ledger_entries').insert({
    ledger_id: randomUUID(),
    user_id: userId,
    entry_type: 'BATTLE_PAYOUT',
    currency: 'COIN',
    amount: amount.toString(),
    status: 'POSTED',
    reference_type: 'BATTLE',
    reference_id: battleId,
    idempotency_key: idempotencyKey,
    metadata: { battleId, role },
  });
}

/**
 * Caller deposits their stake into the battle escrow (bonus-first like the
 * live-games entry path). Idempotent per (battle, side).
 */
export async function depositBattle(userId: string, input: BattleDepositInput) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const { battleId, role, stakeCoins, creatorUid, opponentUid, idempotencyKey } = input;

  // The caller can only pay their own side.
  const expectedUid = role === 'creator' ? creatorUid : opponentUid;
  if (userId !== expectedUid) throw new EconomyError('INVALID_INPUT', 400, 'Caller is not this battle side');

  const stake = BigInt(stakeCoins);

  const result = await db.transaction(async (trx) => {
    await trx('battle_escrows')
      .insert({
        battle_id: battleId,
        creator_uid: creatorUid,
        opponent_uid: opponentUid,
        stake_coins: stake.toString(),
        pool_coins: '0',
        status: 'OPEN',
        created_at: nowIso(),
        updated_at: trx.fn.now(),
      })
      .onConflict('battle_id')
      .ignore();

    const row: EscrowRow = await trx('battle_escrows').where({ battle_id: battleId }).forUpdate().first();
    if (!row) throw new EconomyError('INTERNAL', 500, 'Escrow missing');
    if (row.status !== 'OPEN') throw new EconomyError('CONFLICT', 409, 'Battle escrow is closed');
    if (BigInt(row.stake_coins) !== stake) throw new EconomyError('INVALID_INPUT', 400, 'Stake mismatch');

    const alreadyPaid = role === 'creator' ? row.creator_paid : row.opponent_paid;
    if (alreadyPaid) {
      return {
        kind: 'replay' as const,
        response: {
          battleId, role, stakeCoins: Number(stake), poolCoins: Number(row.pool_coins),
          newBalances: await balancesFor(trx, userId),
        },
      };
    }

    // Debit caller, bonus-first.
    await trx('wallets').insert({ user_id: userId }).onConflict('user_id').ignore();
    const wallet = await trx('wallets').where({ user_id: userId }).forUpdate().first();
    if (!wallet) throw new EconomyError('INTERNAL', 500, 'Wallet missing');
    const bonus = BigInt(wallet.bonus_coin_balance);
    const paid = BigInt(wallet.coin_balance);
    const useBonus = bonus >= stake ? stake : bonus;
    const usePaid = stake - useBonus;
    if (paid < usePaid) throw new EconomyError('INSUFFICIENT_FUNDS', 409, 'Insufficient funds');

    if (usePaid > 0n) {
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(), user_id: userId, entry_type: 'BATTLE_DEPOSIT', currency: 'COIN',
        amount: (-usePaid).toString(), status: 'POSTED', reference_type: 'BATTLE', reference_id: battleId,
        idempotency_key: `${idempotencyKey}:COIN`, metadata: { battleId, role },
      });
    }
    if (useBonus > 0n) {
      await trx('ledger_entries').insert({
        ledger_id: randomUUID(), user_id: userId, entry_type: 'BATTLE_DEPOSIT', currency: 'BONUS_COIN',
        amount: (-useBonus).toString(), status: 'POSTED', reference_type: 'BATTLE', reference_id: battleId,
        idempotency_key: `${idempotencyKey}:BONUS`, metadata: { battleId, role },
      });
    }
    await trx('wallets').where({ user_id: userId }).update({
      coin_balance: (paid - usePaid).toString(),
      bonus_coin_balance: (bonus - useBonus).toString(),
      lifetime_spend_coins: (BigInt(wallet.lifetime_spend_coins) + stake).toString(),
      updated_at: trx.fn.now(),
    });

    const patch: any = { pool_coins: (BigInt(row.pool_coins) + stake).toString(), updated_at: trx.fn.now() };
    if (role === 'creator') { patch.creator_paid = true; patch.creator_paid_coins = stake.toString(); }
    else { patch.opponent_paid = true; patch.opponent_paid_coins = stake.toString(); }
    await trx('battle_escrows').where({ battle_id: battleId }).update(patch);

    const updated = await trx('battle_escrows').where({ battle_id: battleId }).first();
    return {
      kind: 'success' as const,
      response: {
        battleId, role, stakeCoins: Number(stake), poolCoins: Number(updated.pool_coins),
        newBalances: await balancesFor(trx, userId),
      },
    };
  });

  return result;
}

async function balancesFor(trx: Knex.Transaction, userId: string) {
  const w = await trx('wallets').where({ user_id: userId }).first();
  return { coinBalance: Number(w?.coin_balance || 0), bonusCoinBalance: Number(w?.bonus_coin_balance || 0) };
}

/** Refund all paid stakes (in coins) before the battle is settled. Idempotent. */
export async function cancelRefundBattle(userId: string, input: { battleId: string; idempotencyKey: string }) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const { battleId, idempotencyKey } = input;

  return db.transaction(async (trx) => {
    const row: EscrowRow = await trx('battle_escrows').where({ battle_id: battleId }).forUpdate().first();
    if (!row) {
      return { kind: 'success' as const, response: { battleId, refunded: false, outcome: 'no_escrow' } };
    }
    if (sideOf(row, userId) == null) throw new EconomyError('INVALID_INPUT', 400, 'Not a battle participant');
    if (row.status === 'SETTLED') throw new EconomyError('CONFLICT', 409, 'Battle already settled');
    if (row.status === 'REFUNDED') {
      return { kind: 'replay' as const, response: { battleId, refunded: true, outcome: 'refunded', ...row.settlement_json } };
    }

    const coinsTo: Record<string, number> = {};
    if (row.creator_paid && BigInt(row.creator_paid_coins) > 0n) {
      await creditCoins(trx, row.creator_uid, BigInt(row.creator_paid_coins), battleId, `${idempotencyKey}:REFUND:creator`, 'refund_creator');
      coinsTo[row.creator_uid] = Number(row.creator_paid_coins);
    }
    if (row.opponent_paid && BigInt(row.opponent_paid_coins) > 0n) {
      await creditCoins(trx, row.opponent_uid, BigInt(row.opponent_paid_coins), battleId, `${idempotencyKey}:REFUND:opponent`, 'refund_opponent');
      coinsTo[row.opponent_uid] = Number(row.opponent_paid_coins);
    }

    const settlement = { outcome: 'refunded', coinsTo, paidAt: nowIso() };
    await trx('battle_escrows').where({ battle_id: battleId }).update({
      status: 'REFUNDED', pool_coins: '0', settlement_json: settlement, updated_at: trx.fn.now(),
    });
    return { kind: 'success' as const, response: { battleId, refunded: true, ...settlement } };
  });
}

/**
 * Settle from recorded attendance. COINS at face value:
 *  both joined -> refund each their stake; one joined -> full pot; neither -> platform keeps.
 * One-shot per battle (idempotent).
 */
export async function settleBattle(userId: string, input: { battleId: string; idempotencyKey: string }) {
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const { battleId, idempotencyKey } = input;

  return db.transaction(async (trx) => {
    const row: EscrowRow = await trx('battle_escrows').where({ battle_id: battleId }).forUpdate().first();
    if (!row) {
      return { kind: 'success' as const, response: { battleId, outcome: 'none_staked', settlement: { outcome: 'none_staked' } } };
    }
    if (sideOf(row, userId) == null) throw new EconomyError('INVALID_INPUT', 400, 'Not a battle participant');
    if (row.status === 'SETTLED') {
      return { kind: 'replay' as const, response: { battleId, outcome: row.settlement_json?.outcome || 'settled', settlement: row.settlement_json } };
    }
    if (row.status === 'REFUNDED') {
      return { kind: 'replay' as const, response: { battleId, outcome: 'refunded', settlement: row.settlement_json } };
    }

    const pool = BigInt(row.pool_coins);
    const creatorStake = BigInt(row.creator_paid_coins);
    const opponentStake = BigInt(row.opponent_paid_coins);
    const coinsTo: Record<string, number> = {};
    let outcome: string;

    if (row.creator_joined && row.opponent_joined) {
      outcome = 'both';
      if (creatorStake > 0n) { await creditCoins(trx, row.creator_uid, creatorStake, battleId, `${idempotencyKey}:both:creator`, 'refund_creator'); coinsTo[row.creator_uid] = Number(creatorStake); }
      if (opponentStake > 0n) { await creditCoins(trx, row.opponent_uid, opponentStake, battleId, `${idempotencyKey}:both:opponent`, 'refund_opponent'); coinsTo[row.opponent_uid] = Number(opponentStake); }
    } else if (row.creator_joined && !row.opponent_joined) {
      outcome = 'creator_only';
      if (pool > 0n) { await creditCoins(trx, row.creator_uid, pool, battleId, `${idempotencyKey}:pot:creator`, 'pot_creator'); coinsTo[row.creator_uid] = Number(pool); }
    } else if (!row.creator_joined && row.opponent_joined) {
      outcome = 'opponent_only';
      if (pool > 0n) { await creditCoins(trx, row.opponent_uid, pool, battleId, `${idempotencyKey}:pot:opponent`, 'pot_opponent'); coinsTo[row.opponent_uid] = Number(pool); }
    } else {
      outcome = 'none'; // nobody turned up — platform keeps the pot
    }

    const settlement = { outcome, coinsTo, poolCoins: Number(pool), paidAt: nowIso() };
    await trx('battle_escrows').where({ battle_id: battleId }).update({
      status: 'SETTLED', settlement_json: settlement, updated_at: trx.fn.now(),
    });
    return { kind: 'success' as const, response: { battleId, outcome, settlement } };
  });
}

/**
 * Record that a participant actually went live (attendance source of truth for
 * settlement). Called by the battle live-stage path when a publish token is
 * minted. No-op if there's no escrow (free battle) or it's already closed.
 */
export async function markBattleAttendance(battleId: string, userId: string): Promise<void> {
  const { db } = getEconomyInfra();
  try {
    await ensureEconomySchema(db);
    await db.transaction(async (trx) => {
      const row: EscrowRow = await trx('battle_escrows').where({ battle_id: battleId }).forUpdate().first();
      if (!row || row.status !== 'OPEN') return;
      const side = sideOf(row, userId);
      if (!side) return;
      const patch: any = { updated_at: trx.fn.now() };
      patch[side === 'creator' ? 'creator_joined' : 'opponent_joined'] = true;
      await trx('battle_escrows').where({ battle_id: battleId }).update(patch);
    });
  } catch {
    // Attendance is best-effort here; settlement also reads the latest flags.
  }
}

function battleForbidden(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'FORBIDDEN';
  return err;
}

/** Only the battle creator may start the shared IVS stage. */
export async function assertBattleCreator(battleId: string, userId: string): Promise<void> {
  const db = getEconomyInfra().db;
  await ensureEconomySchema(db);
  const rs = await db.raw(
    `SELECT creator_uid, opponent_uid FROM battle_escrows WHERE battle_id = ? LIMIT 1`,
    [battleId],
  );
  const row = (rs as any)?.rows?.[0] as { creator_uid?: string; opponent_uid?: string } | undefined;
  if (!row) {
    throw battleForbidden('Battle not found');
  }
  if (row.creator_uid !== userId) {
    throw battleForbidden('Only the battle creator can start this stage');
  }
}

/** Only escrow participants may join a battle stage with publish rights. */
export async function assertBattleParticipant(battleId: string, userId: string): Promise<void> {
  const db = getEconomyInfra().db;
  await ensureEconomySchema(db);
  const rs = await db.raw(
    `SELECT creator_uid, opponent_uid FROM battle_escrows WHERE battle_id = ? LIMIT 1`,
    [battleId],
  );
  const row = (rs as any)?.rows?.[0] as { creator_uid?: string; opponent_uid?: string } | undefined;
  if (!row) {
    throw battleForbidden('Battle not found');
  }
  if (row.creator_uid !== userId && row.opponent_uid !== userId) {
    throw battleForbidden('Only battle participants can join this stage');
  }
}
