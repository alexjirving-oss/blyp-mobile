import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { ensureEconomySchema } from '../../economy/schema';
import { getEconomyInfra } from '../../economy/infra';
import { planPaidOnlyCoinDebit } from '../../economy/paidOnlyCoinDebit';
import { EconomyError } from '../../economy/economyErrors';
import {
  GRID9_MAX_ESCROW_RESERVE_COINS,
  GRID9_MIN_ESCROW_RESERVE_COINS,
} from './constants';
import { grid9CanonicalIntentHash } from './canonical';
import { commitGrid9Aggregate } from './grid9AtomicScript';
import {
  emptyGrid9Escrow,
  grid9NonceDigest,
  readGrid9Aggregate,
  readGrid9IntentReceipt,
} from './grid9AggregateStore';
import { Grid9Error } from './grid9Errors';
import type {
  Grid9EscrowWallet,
  Grid9LedgerEntry,
  Grid9LedgerReceipt,
  Grid9WalletReservationRecord,
} from './ledger';
import type {
  Grid9ReserveCoinsIntent,
  Grid9EscrowUpdatedPayload,
} from './protocol';
import {
  grid9AggregateFields,
  grid9RedisKeys,
  type Grid9ConsumedNonceRecord,
  type Grid9IntentReceiptRecord,
} from './redisKeys';

type ReservationRow = {
  reservation_id: string;
  match_id: string;
  user_id: string;
  intent_id: string;
  amount_coins: string;
  captured_coins: string;
  released_coins: string;
  status: string;
  platform_ledger_entry_id: string | null;
  redis_applied_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const RESERVATION_INTENT_CLAIM_LUA = `
local key = KEYS[1]
local expectedVersion = tonumber(ARGV[1])
local intentField = ARGV[2]
local nonceField = ARGV[3]
local canonicalHash = ARGV[4]
local intentId = ARGV[5]
local pendingJson = ARGV[6]
local nonceJson = ARGV[7]

local stateJson = redis.call('HGET', key, 'state')
if not stateJson then return cjson.encode({ status = 'REJECTED', code = 'MATCH_NOT_FOUND' }) end
local state = cjson.decode(stateJson)
if state.phase ~= 'countdown' and state.phase ~= 'combat' then
  return cjson.encode({ status = 'REJECTED', code = 'MATCH_NOT_ACTIVE' })
end
if tonumber(state.authority.stateVersion) ~= expectedVersion then
  return cjson.encode({ status = 'REJECTED', code = 'STALE_STATE' })
end

local existingIntentJson = redis.call('HGET', key, intentField)
if existingIntentJson then
  local existingIntent = cjson.decode(existingIntentJson)
  if existingIntent.canonicalIntentHash ~= canonicalHash then
    return cjson.encode({ status = 'REJECTED', code = 'INTENT_CONFLICT' })
  end
  if existingIntent.status == 'committed' then
    return cjson.encode({ status = 'COMMITTED', detail = existingIntentJson })
  end
  if existingIntent.status == 'rejected' then
    return cjson.encode({ status = 'REJECTED', code = existingIntent.errorCode })
  end
end

local existingNonceJson = redis.call('HGET', key, nonceField)
if existingNonceJson then
  local existingNonce = cjson.decode(existingNonceJson)
  if existingNonce.intentId ~= intentId then
    return cjson.encode({ status = 'REJECTED', code = 'NONCE_REPLAY' })
  end
else
  redis.call('HSET', key, nonceField, nonceJson)
end
redis.call('HSET', key, intentField, pendingJson)
return cjson.encode({ status = 'CLAIMED' })
`;

function rowToRecord(row: ReservationRow): Grid9WalletReservationRecord {
  const status =
    row.status === 'SETTLED'
      ? 'settled'
      : BigInt(row.captured_coins || 0) > 0n ||
          BigInt(row.released_coins || 0) > 0n
        ? 'partially_settled'
        : 'reserved';
  return {
    schemaVersion: 1,
    reservationId: row.reservation_id,
    idempotencyKey: `grid9:reserve:${row.match_id}:${row.user_id}:${row.intent_id}`,
    matchId: row.match_id,
    userId: row.user_id,
    amountCoins: Number(row.amount_coins),
    platformLedgerEntryId: row.platform_ledger_entry_id || '',
    capturedCoins: Number(row.captured_coins || 0),
    releasedCoins: Number(row.released_coins || 0),
    status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function claimReservationIntent(args: {
  intent: Grid9ReserveCoinsIntent;
  userId: string;
  canonicalIntentHash: string;
  privateMessageId: string;
}): Promise<'claimed' | 'committed'> {
  const now = new Date().toISOString();
  const nonceDigest = grid9NonceDigest(args.intent.nonce);
  const nonceField = grid9AggregateFields.nonce(args.userId, nonceDigest);
  const intentField = grid9AggregateFields.intent(
    args.userId,
    args.intent.intentId,
  );
  const pending: Grid9IntentReceiptRecord = {
    schemaVersion: 1,
    intentId: args.intent.intentId,
    matchId: args.intent.matchId,
    userId: args.userId,
    commandType: 'RESERVE_COINS',
    canonicalIntentHash: args.canonicalIntentHash,
    status: 'pending',
    stateVersion: args.intent.expectedStateVersion,
    ledgerEntryId: null,
    privateReceipt: null,
    errorCode: null,
    serverMessageId: args.privateMessageId,
    replayEvent: {
      type: 'ESCROW_UPDATED',
      messageId: args.privateMessageId,
      payloadJson: '{}',
      stateVersion: args.intent.expectedStateVersion,
      sequence: null,
    },
    recordedAt: now,
  };
  const nonceRecord: Grid9ConsumedNonceRecord = {
    schemaVersion: 1,
    nonceDigest,
    intentId: args.intent.intentId,
    userId: args.userId,
    connectionSessionId: args.intent.connectionSessionId,
    consumedAt: now,
  };
  const raw = (await getEconomyInfra().redis.eval(
    RESERVATION_INTENT_CLAIM_LUA,
    1,
    grid9RedisKeys.matchAggregate(args.intent.matchId),
    args.intent.expectedStateVersion,
    intentField,
    nonceField,
    args.canonicalIntentHash,
    args.intent.intentId,
    JSON.stringify(pending),
    JSON.stringify(nonceRecord),
  )) as string;
  const result = JSON.parse(raw) as {
    status: 'CLAIMED' | 'COMMITTED' | 'REJECTED';
    code?: string;
  };
  if (result.status === 'COMMITTED') return 'committed';
  if (result.status === 'REJECTED') {
    throw new Grid9Error(
      (result.code as any) || 'WALLET_RESERVATION_FAILED',
      'Grid 9 reservation rejected',
      {
        retryable:
          result.code === 'STALE_STATE' ||
          result.code === 'INTERNAL_ERROR',
        stateVersion: args.intent.expectedStateVersion,
      },
    );
  }
  return 'claimed';
}

async function reservationByIntent(args: {
  matchId: string;
  userId: string;
  intentId: string;
}): Promise<Grid9WalletReservationRecord | null> {
  const { db } = getEconomyInfra();
  const row = (await db('grid9_wallet_reservations')
    .where({
      match_id: args.matchId,
      user_id: args.userId,
      intent_id: args.intentId,
    })
    .first()) as ReservationRow | undefined;
  return row ? rowToRecord(row) : null;
}

async function createPaidReservation(args: {
  matchId: string;
  userId: string;
  intentId: string;
  amountCoins: number;
}): Promise<Grid9WalletReservationRecord> {
  if (
    !Number.isSafeInteger(args.amountCoins) ||
    args.amountCoins < GRID9_MIN_ESCROW_RESERVE_COINS ||
    args.amountCoins > GRID9_MAX_ESCROW_RESERVE_COINS
  ) {
    throw new Grid9Error(
      'INVALID_RESERVE_AMOUNT',
      `Reserve ${GRID9_MIN_ESCROW_RESERVE_COINS}-${GRID9_MAX_ESCROW_RESERVE_COINS} whole coins`,
    );
  }
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  return db.transaction(async (trx: Knex.Transaction) => {
    await trx('grid9_wallet_reservations')
      .insert({
        reservation_id: randomUUID(),
        match_id: args.matchId,
        user_id: args.userId,
        intent_id: args.intentId,
        amount_coins: String(args.amountCoins),
        status: 'PENDING',
      })
      .onConflict(['match_id', 'user_id', 'intent_id'])
      .ignore();
    const row = (await trx('grid9_wallet_reservations')
      .where({
        match_id: args.matchId,
        user_id: args.userId,
        intent_id: args.intentId,
      })
      .forUpdate()
      .first()) as ReservationRow | undefined;
    if (!row) {
      throw new EconomyError(
        'INTERNAL',
        500,
        'Grid 9 reservation row missing',
      );
    }
    if (Number(row.amount_coins) !== args.amountCoins) {
      throw new Grid9Error(
        'INTENT_CONFLICT',
        'Grid 9 reservation amount changed',
      );
    }
    if (row.status !== 'PENDING') return rowToRecord(row);

    await trx('wallets')
      .insert({ user_id: args.userId })
      .onConflict('user_id')
      .ignore();
    const wallet = await trx('wallets')
      .where({ user_id: args.userId })
      .forUpdate()
      .first();
    if (!wallet) {
      throw new EconomyError('INTERNAL', 500, 'Wallet missing');
    }
    const debit = planPaidOnlyCoinDebit(
      BigInt(wallet.coin_balance),
      BigInt(args.amountCoins),
      'paid coins for Grid 9',
    );
    const ledgerId = randomUUID();
    const idempotencyKey = `grid9:reserve:${args.matchId}:${args.userId}:${args.intentId}`;
    await trx('ledger_entries').insert({
      ledger_id: ledgerId,
      user_id: args.userId,
      entry_type: 'GRID9_ESCROW_RESERVE',
      currency: 'COIN',
      amount: (-debit.usePaid).toString(),
      status: 'POSTED',
      reference_type: 'GRID9_MATCH',
      reference_id: args.matchId,
      idempotency_key: idempotencyKey,
      metadata: {
        matchId: args.matchId,
        reservationId: row.reservation_id,
        intentId: args.intentId,
      },
    });
    await trx('wallets')
      .where({ user_id: args.userId })
      .update({
        coin_balance: (
          BigInt(wallet.coin_balance) - debit.usePaid
        ).toString(),
        updated_at: trx.fn.now(),
      });
    const updated = (await trx('grid9_wallet_reservations')
      .where({ reservation_id: row.reservation_id })
      .update({
        status: 'RESERVED',
        platform_ledger_entry_id: ledgerId,
        updated_at: trx.fn.now(),
      })
      .returning('*')) as ReservationRow[];
    return rowToRecord(updated[0]);
  });
}

async function markReservationApplied(reservationId: string): Promise<void> {
  const { db } = getEconomyInfra();
  await db('grid9_wallet_reservations')
    .where({ reservation_id: reservationId })
    .update({ redis_applied_at: db.fn.now(), updated_at: db.fn.now() });
}

async function refundUnappliedReservation(
  reservation: Grid9WalletReservationRecord,
): Promise<void> {
  const { db } = getEconomyInfra();
  await db.transaction(async (trx) => {
    const row = (await trx('grid9_wallet_reservations')
      .where({ reservation_id: reservation.reservationId })
      .forUpdate()
      .first()) as ReservationRow | undefined;
    if (!row || row.status !== 'RESERVED' || row.redis_applied_at) return;
    await trx('wallets')
      .insert({ user_id: reservation.userId })
      .onConflict('user_id')
      .ignore();
    const wallet = await trx('wallets')
      .where({ user_id: reservation.userId })
      .forUpdate()
      .first();
    if (!wallet) throw new Error('Grid 9 refund wallet missing');
    await trx('ledger_entries')
      .insert({
        ledger_id: randomUUID(),
        user_id: reservation.userId,
        entry_type: 'GRID9_ESCROW_RESERVE_REFUND',
        currency: 'COIN',
        amount: String(reservation.amountCoins),
        status: 'POSTED',
        reference_type: 'GRID9_MATCH',
        reference_id: reservation.matchId,
        idempotency_key: `grid9:reserve-refund:${reservation.reservationId}`,
        metadata: {
          matchId: reservation.matchId,
          reservationId: reservation.reservationId,
        },
      })
      .onConflict('idempotency_key')
      .ignore();
    await trx('wallets')
      .where({ user_id: reservation.userId })
      .update({
        coin_balance: (
          BigInt(wallet.coin_balance) + BigInt(reservation.amountCoins)
        ).toString(),
        updated_at: trx.fn.now(),
      });
    await trx('grid9_wallet_reservations')
      .where({ reservation_id: reservation.reservationId })
      .update({
        released_coins: String(reservation.amountCoins),
        status: 'SETTLED',
        updated_at: trx.fn.now(),
      });
  });
}

async function refundUnlessApplied(
  reservation: Grid9WalletReservationRecord,
): Promise<void> {
  try {
    const snapshot = await readGrid9Aggregate(
      reservation.matchId,
      reservation.userId,
    );
    if (
      snapshot.escrow?.reservationIds.includes(reservation.reservationId)
    ) {
      await markReservationApplied(reservation.reservationId);
      return;
    }
  } catch (error) {
    if (
      !(error instanceof Grid9Error) ||
      error.code !== 'MATCH_NOT_FOUND'
    ) {
      throw error;
    }
  }
  await refundUnappliedReservation(reservation);
}

export async function reserveGrid9Coins(args: {
  intent: Grid9ReserveCoinsIntent;
  userId: string;
  connectionSessionId: string;
  privateMessageId: string;
}): Promise<{
  wallet: Grid9EscrowWallet;
  reservation: Grid9WalletReservationRecord;
  receipt: Grid9LedgerReceipt;
  replay: boolean;
}> {
  const canonicalIntentHash = grid9CanonicalIntentHash({
    authenticatedUserId: args.userId,
    matchId: args.intent.matchId,
    type: args.intent.type,
    payload: args.intent.payload,
  });
  const claim = await claimReservationIntent({
    intent: args.intent,
    userId: args.userId,
    canonicalIntentHash,
    privateMessageId: args.privateMessageId,
  });
  if (claim === 'committed') {
    const [reservation, snapshot, receipt] = await Promise.all([
      reservationByIntent({
        matchId: args.intent.matchId,
        userId: args.userId,
        intentId: args.intent.intentId,
      }),
      readGrid9Aggregate(args.intent.matchId, args.userId),
      readGrid9IntentReceipt(
        args.intent.matchId,
        args.userId,
        args.intent.intentId,
      ),
    ]);
    if (!reservation || !snapshot.escrow || !receipt?.privateReceipt) {
      throw new Grid9Error(
        'INTERNAL_ERROR',
        'Grid 9 reservation replay is incomplete',
        { retryable: true },
      );
    }
    return {
      wallet: snapshot.escrow,
      reservation,
      receipt: receipt.privateReceipt,
      replay: true,
    };
  }
  const reservation = await createPaidReservation({
    matchId: args.intent.matchId,
    userId: args.userId,
    intentId: args.intent.intentId,
    amountCoins: args.intent.payload.amountCoins,
  });

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const snapshot = await readGrid9Aggregate(
      args.intent.matchId,
      args.userId,
    );
    const current =
      snapshot.escrow ??
      emptyGrid9Escrow(args.intent.matchId, args.userId);
    if (current.reservationIds.includes(reservation.reservationId)) {
      await markReservationApplied(reservation.reservationId);
      return {
        wallet: current,
        reservation,
        receipt: {
          entryId: reservation.platformLedgerEntryId,
          intentId: args.intent.intentId,
          kind: 'escrow_reserved',
          debitCoins: 0,
          creditCoins: reservation.amountCoins,
          jackpotContributionCoins: 0,
          availableCoinsAfter: current.availableCoins,
          stateVersion: snapshot.state.authority.stateVersion,
          committedAt: reservation.updatedAt,
        },
        replay: true,
      };
    }
    const now = new Date().toISOString();
    const next: Grid9EscrowWallet = {
      ...current,
      platformReservedCoins:
        current.platformReservedCoins + reservation.amountCoins,
      availableCoins: current.availableCoins + reservation.amountCoins,
      reservationIds: [
        ...current.reservationIds,
        reservation.reservationId,
      ],
      version: current.version + 1,
      updatedAt: now,
    };
    const receipt: Grid9LedgerReceipt = {
      entryId: reservation.platformLedgerEntryId,
      intentId: args.intent.intentId,
      kind: 'escrow_reserved',
      debitCoins: 0,
      creditCoins: reservation.amountCoins,
      jackpotContributionCoins: 0,
      availableCoinsAfter: next.availableCoins,
      stateVersion: snapshot.state.authority.stateVersion,
      committedAt: now,
    };
    const payload: Grid9EscrowUpdatedPayload = {
      wallet: next,
      reservation,
    };
    const nonceDigest = grid9NonceDigest(args.intent.nonce);
    const nonceField = grid9AggregateFields.nonce(
      args.userId,
      nonceDigest,
    );
    const intentField = grid9AggregateFields.intent(
      args.userId,
      args.intent.intentId,
    );
    const nonceRecord: Grid9ConsumedNonceRecord = {
      schemaVersion: 1,
      nonceDigest,
      intentId: args.intent.intentId,
      userId: args.userId,
      connectionSessionId: args.connectionSessionId,
      consumedAt: now,
    };
    const intentReceipt: Grid9IntentReceiptRecord = {
      schemaVersion: 1,
      intentId: args.intent.intentId,
      matchId: args.intent.matchId,
      userId: args.userId,
      commandType: 'RESERVE_COINS',
      canonicalIntentHash,
      status: 'committed',
      stateVersion: snapshot.state.authority.stateVersion,
      ledgerEntryId: reservation.platformLedgerEntryId,
      privateReceipt: receipt,
      errorCode: null,
      serverMessageId: args.privateMessageId,
      replayEvent: {
        type: 'ESCROW_UPDATED',
        messageId: args.privateMessageId,
        payloadJson: JSON.stringify(payload),
        stateVersion: snapshot.state.authority.stateVersion,
        sequence: null,
      },
      recordedAt: now,
    };
    const redisLedger: Grid9LedgerEntry = {
      schemaVersion: 1,
      entryId: reservation.platformLedgerEntryId,
      intentId: args.intent.intentId,
      matchId: args.intent.matchId,
      kind: 'escrow_reserved',
      actorUserId: args.userId,
      beneficiaryUserId: args.userId,
      sourceSlotIndex: null,
      targetSlotIndex: null,
      itemId: null,
      fundingSource: 'platform_wallet_reservation',
      fundingBreakdown: {
        platformReservationCoins: reservation.amountCoins,
        microDropCoins: 0,
        mercenaryBankrollCoins: 0,
        jackpotPoolCoins: 0,
      },
      serverOperationId: null,
      canonicalPayloadHash: canonicalIntentHash,
      debitCoins: 0,
      creditCoins: reservation.amountCoins,
      jackpotDeltaCoins: 0,
      escrowBalanceBefore: current.availableCoins,
      escrowBalanceAfter: next.availableCoins,
      stateVersionBefore: snapshot.state.authority.stateVersion,
      stateVersionAfter: snapshot.state.authority.stateVersion,
      createdAt: now,
    };
    const aggregateKey = grid9RedisKeys.matchAggregate(args.intent.matchId);
    const escrowField = grid9AggregateFields.escrow(args.userId);
    const result = await commitGrid9Aggregate(
      getEconomyInfra().redis,
      aggregateKey,
      {
        matchId: args.intent.matchId,
        intentId: args.intent.intentId,
        authenticatedUserId: args.userId,
        commandType: 'RESERVE_COINS',
        canonicalIntentHash,
        canonicalOperationHash: null,
        expectedStateVersion: snapshot.state.authority.stateVersion,
        stateVersionDelta: 0,
        escrowField,
        expectedEscrowJson: snapshot.escrowJson,
        escrowDelta: reservation.amountCoins,
        nonceField,
        intentField,
        operationField: null,
        paidValidation: null,
        fields: [
          [grid9AggregateFields.state, snapshot.stateJson],
          [escrowField, JSON.stringify(next)],
          [nonceField, JSON.stringify(nonceRecord)],
          [intentField, JSON.stringify(intentReceipt)],
          [
            grid9AggregateFields.ledger(redisLedger.entryId),
            JSON.stringify(redisLedger),
          ],
        ],
      },
    );
    if (result.status === 'COMMITTED') {
      await markReservationApplied(reservation.reservationId);
      return { wallet: next, reservation, receipt, replay: false };
    }
    if (result.status === 'REPLAY') {
      const latest = await readGrid9Aggregate(
        args.intent.matchId,
        args.userId,
      );
      if (!latest.escrow) {
        throw new Grid9Error(
          'INTERNAL_ERROR',
          'Grid 9 reservation replay missing escrow',
          { retryable: true },
        );
      }
      await markReservationApplied(reservation.reservationId);
      return {
        wallet: latest.escrow,
        reservation,
        receipt,
        replay: true,
      };
    }
    if (result.code !== 'STALE_STATE') {
      await refundUnlessApplied(reservation);
      throw new Grid9Error(
        (result.code as any) || 'WALLET_RESERVATION_FAILED',
        'Could not apply Grid 9 reservation',
        { retryable: true },
      );
    }
  }
  await refundUnlessApplied(reservation);
  throw new Grid9Error(
    'WALLET_RESERVATION_FAILED',
    'Grid 9 reservation is busy; retry',
    { retryable: true },
  );
}
