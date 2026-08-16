import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../../economy/infra';
import { ensureEconomySchema } from '../../economy/schema';
import { logger } from '../../config/logger';
import { grid9CanonicalOperationHash } from './canonical';
import {
  commitGrid9ServerMutation,
  newGrid9ServerOperationReceipt,
  readGrid9Escrows,
  removeGrid9ActiveMatch,
} from './grid9AggregateStore';
import {
  createGrid9RoomEvent,
  emitGrid9Room,
} from './grid9Broadcast';
import type { Grid9EscrowWallet } from './ledger';
import {
  grid9RedisKeys,
  grid9RegionalAggregateFields,
} from './redisKeys';
import { parseGrid9GameState } from './schemas';
import type {
  Grid9GameState,
  Grid9RolloverPool,
  Grid9SponsorPass,
} from './state';
import { toGrid9PublicGameState } from './grid9Projection';
import { creditGrid9VictoryTokens } from '../../economy/tokenWalletService';

type ReservationRow = {
  reservation_id: string;
  user_id: string;
  amount_coins: string;
  captured_coins: string;
  released_coins: string;
  status: string;
};

const REGIONAL_SETTLEMENT_LUA = `
local key = KEYS[1]
local receiptField = ARGV[1]
local existing = redis.call('HGET', key, receiptField)
if existing then return existing end

local rolloverField = ARGV[2]
local region = ARGV[3]
local amount = tonumber(ARGV[4])
local matchId = ARGV[5]
local nowIso = ARGV[6]
local receiptJson = ARGV[7]
local passField = ARGV[8]
local passJson = ARGV[9]

local rolloverJson = redis.call('HGET', key, rolloverField)
local rollover
if rolloverJson then
  rollover = cjson.decode(rolloverJson)
else
  rollover = {
    schemaVersion = 1,
    region = region,
    availableCoins = 0,
    reservedCoins = 0,
    sourceMatchId = matchId,
    status = 'available',
    reservedByClaimId = cjson.null,
    reservedForMatchId = cjson.null,
    reservedAt = cjson.null,
    version = 0,
    updatedAt = nowIso
  }
end
rollover.availableCoins = tonumber(rollover.availableCoins) + amount
rollover.sourceMatchId = matchId
rollover.version = tonumber(rollover.version) + 1
rollover.updatedAt = nowIso
if tonumber(rollover.reservedCoins) > 0 then
  rollover.status = 'reserved'
else
  rollover.status = 'available'
end

if passField ~= '' and passJson ~= '' then
  redis.call('HSET', key,
    rolloverField, cjson.encode(rollover),
    receiptField, receiptJson,
    passField, passJson)
else
  redis.call('HSET', key,
    rolloverField, cjson.encode(rollover),
    receiptField, receiptJson)
end
return receiptJson
`;

function redis() {
  return getEconomyInfra().redis;
}

async function settleReservations(
  trx: Knex.Transaction,
  state: Grid9GameState,
  escrows: Grid9EscrowWallet[],
): Promise<void> {
  const rows = (await trx('grid9_wallet_reservations')
    .where({ match_id: state.matchId })
    .orderBy('created_at', 'asc')
    .forUpdate()) as ReservationRow[];
  const byUser = new Map<string, ReservationRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row);
    byUser.set(row.user_id, list);
  }
  for (const [userId, reservations] of byUser) {
    const escrow = escrows.find((wallet) => wallet.userId === userId);
    let remainingCapture = escrow?.spentPlatformCoins ?? 0;
    await trx('wallets')
      .insert({ user_id: userId })
      .onConflict('user_id')
      .ignore();
    const wallet = await trx('wallets')
      .where({ user_id: userId })
      .forUpdate()
      .first();
    if (!wallet) throw new Error('Grid 9 settlement wallet missing');
    let totalRelease = 0n;
    let totalCapture = 0n;
    for (const reservation of reservations) {
      if (reservation.status === 'SETTLED') {
        remainingCapture = Math.max(
          0,
          remainingCapture - Number(reservation.captured_coins || 0),
        );
        continue;
      }
      const amount = Number(reservation.amount_coins);
      const capture = Math.min(remainingCapture, amount);
      const release = amount - capture;
      remainingCapture -= capture;
      totalCapture += BigInt(capture);
      totalRelease += BigInt(release);
      if (release > 0) {
        await trx('ledger_entries')
          .insert({
            ledger_id: randomUUID(),
            user_id: userId,
            entry_type: 'GRID9_ESCROW_RELEASE',
            currency: 'COIN',
            amount: String(release),
            status: 'POSTED',
            reference_type: 'GRID9_MATCH',
            reference_id: state.matchId,
            idempotency_key: `grid9:release:${reservation.reservation_id}`,
            metadata: {
              matchId: state.matchId,
              reservationId: reservation.reservation_id,
            },
          })
          .onConflict('idempotency_key')
          .ignore();
      }
      await trx('grid9_wallet_reservations')
        .where({ reservation_id: reservation.reservation_id })
        .update({
          captured_coins: String(capture),
          released_coins: String(release),
          status: 'SETTLED',
          updated_at: trx.fn.now(),
        });
    }
    if (totalRelease > 0n) {
      await trx('wallets')
        .where({ user_id: userId })
        .update({
          coin_balance: (
            BigInt(wallet.coin_balance) + totalRelease
          ).toString(),
          lifetime_spend_coins: (
            BigInt(wallet.lifetime_spend_coins || 0) + totalCapture
          ).toString(),
          updated_at: trx.fn.now(),
        });
    } else if (totalCapture > 0n) {
      await trx('wallets')
        .where({ user_id: userId })
        .update({
          lifetime_spend_coins: (
            BigInt(wallet.lifetime_spend_coins || 0) + totalCapture
          ).toString(),
          updated_at: trx.fn.now(),
        });
    }
  }
}

async function payHumanWinner(
  trx: Knex.Transaction,
  state: Grid9GameState,
): Promise<void> {
  const winnerUserId = state.outcome?.winnerUserId;
  const jackpotCoins = state.outcome?.jackpotCoins ?? 0;
  if (!winnerUserId || jackpotCoins <= 0) return;
  // Victory pays Tokens @ 50% of jackpot (not raw coins) — Instant convert is the monetization boundary.
  await creditGrid9VictoryTokens(trx, {
    userId: winnerUserId,
    matchId: state.matchId,
    jackpotCoins,
    winnerSlotIndex: state.outcome?.winnerSlotIndex ?? null,
  });
}

async function applySentinelRollover(state: Grid9GameState): Promise<void> {
  const amount = state.outcome?.jackpotCoins ?? 0;
  if (amount <= 0) return;
  const now = new Date().toISOString();
  const settlementId =
    state.settlement.settlementId ?? `settlement-${state.matchId}`;
  const receipt = {
    schemaVersion: 1,
    settlementId,
    matchId: state.matchId,
    region: state.region,
    rolloverCoinsBefore: 0,
    rolloverCoinsAfter: amount,
    sponsorPassId: state.outcome?.sponsorPass?.passId ?? null,
    appliedAt: now,
  };
  const sponsor = state.outcome?.sponsorPass;
  const pass: Grid9SponsorPass | null = sponsor
    ? {
        schemaVersion: 1,
        passId: sponsor.passId,
        userId: sponsor.userId,
        region: sponsor.region,
        sourceMatchId: sponsor.sourceMatchId,
        sponsoredSentinelId: sponsor.sponsoredSentinelId,
        status: 'available',
        issuedAt: sponsor.issuedAt,
        expiresAt: sponsor.expiresAt,
        reservedForTicketId: null,
        consumedByMatchId: null,
      }
    : null;
  await redis().eval(
    REGIONAL_SETTLEMENT_LUA,
    1,
    grid9RedisKeys.regionalAggregate(state.region),
    grid9RegionalAggregateFields.settlementReceipt(settlementId),
    grid9RegionalAggregateFields.rollover,
    state.region,
    amount,
    state.matchId,
    now,
    JSON.stringify(receipt),
    pass ? grid9RegionalAggregateFields.sponsorPass(pass.passId) : '',
    pass ? JSON.stringify(pass) : '',
  );
}

function settledState(
  current: Grid9GameState,
  now: string,
  escrowReleaseCoins: number,
): Grid9GameState {
  const next = JSON.parse(JSON.stringify(current)) as Grid9GameState;
  const jackpotBefore = next.jackpot.currentCoins;
  next.jackpot.currentCoins = 0;
  next.jackpot.status =
    next.outcome?.winnerKind === 'human' ? 'paid' : 'rolled_over';
  next.settlement.status = 'completed';
  next.settlement.completedAt = now;
  next.settlement.lastAttemptAt = now;
  next.settlement.attemptCount += 1;
  next.settlement.escrowReleaseCoins = escrowReleaseCoins;
  next.authority.stateVersion += 1;
  next.authority.eventSequence += 1;
  next.authority.mutationCount += 1;
  next.authority.lastMutationAt = now;
  next.updatedAt = now;
  if (jackpotBefore < 0) throw new Error('Invalid Grid 9 jackpot');
  return parseGrid9GameState(next);
}

export async function settleGrid9Match(
  io: Server,
  current: Grid9GameState,
): Promise<Grid9GameState> {
  if (
    (current.phase !== 'completed' && current.phase !== 'cancelled') ||
    !current.outcome ||
    current.settlement.status === 'completed'
  ) {
    return current;
  }
  const { db } = getEconomyInfra();
  await ensureEconomySchema(db);
  const escrows = await readGrid9Escrows(current.matchId);
  await db.transaction(async (trx) => {
    await settleReservations(trx, current, escrows);
    if (current.outcome?.winnerKind === 'human') {
      await payHumanWinner(trx, current);
    }
  });
  if (current.outcome.winnerKind !== 'human') {
    await applySentinelRollover(current);
  }
  const now = new Date().toISOString();
  const escrowUpdates = escrows.map((wallet) => {
    const platformAvailable = Math.max(
      0,
      wallet.platformReservedCoins -
        (wallet.spentPlatformCoins - wallet.refundedPlatformCoins) -
        wallet.releasedCoins,
    );
    const microDropAvailable = Math.max(
      0,
      wallet.microDropCreditCoins -
        (wallet.spentMicroDropCoins - wallet.refundedMicroDropCoins) -
        wallet.expiredMicroDropCoins,
    );
    return {
      userId: wallet.userId,
      current: wallet,
      next: {
        ...wallet,
        status: 'settled' as const,
        availableCoins: 0,
        releasedCoins: wallet.releasedCoins + platformAvailable,
        expiredMicroDropCoins:
          wallet.expiredMicroDropCoins + microDropAvailable,
        version: wallet.version + 1,
        updatedAt: now,
        settledAt: now,
      },
    };
  });
  const totalReleaseCoins = escrowUpdates.reduce(
    (sum, update) =>
      sum + (update.next.releasedCoins - update.current.releasedCoins),
    0,
  );
  const next = settledState(current, now, totalReleaseCoins);
  const operationId = `settlement-${current.matchId}`;
  const operationHash = grid9CanonicalOperationHash({
    matchId: current.matchId,
    operationId,
    kind: 'match_settlement',
    payload: {
      outcome: current.outcome,
      settlementId: current.settlement.settlementId,
    },
  });
  const event = createGrid9RoomEvent({
    type: 'JACKPOT_CHANGED',
    matchId: current.matchId,
    sequence: next.authority.eventSequence,
    stateVersion: next.authority.stateVersion,
    causationIntentId: null,
    payload: {
      jackpot: toGrid9PublicGameState(next).jackpot,
      deltaCoins: -current.jackpot.currentCoins,
      reason:
        current.outcome.winnerKind === 'human' ? 'payout' : 'rollover',
    },
  });
  const committed = await commitGrid9ServerMutation({
    currentState: current,
    nextState: next,
    operationReceipt: newGrid9ServerOperationReceipt({
      matchId: current.matchId,
      operationId,
      kind: 'match_settlement',
      canonicalOperationHash: operationHash,
      stateVersion: next.authority.stateVersion,
      result: event.payload,
      recordedAt: now,
    }),
    escrowUpdates,
  });
  if (committed.status === 'committed') {
    emitGrid9Room(io, current.matchId, event);
  }
  await removeGrid9ActiveMatch(current.matchId);
  try {
    const { clearOpenPublicLobbyMatchId } = await import('./grid9Matchmaker');
    await clearOpenPublicLobbyMatchId(current.region, current.matchId);
  } catch {
    /* best-effort open-lobby clear */
  }
  logger.info(
    { matchId: current.matchId, winnerKind: current.outcome.winnerKind },
    '[grid9] match settlement complete',
  );
  return next;
}
