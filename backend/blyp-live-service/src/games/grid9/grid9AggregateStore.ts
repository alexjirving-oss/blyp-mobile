import { createHash, randomUUID } from 'crypto';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import {
  GRID9_LEDGER_TTL_SECONDS,
  GRID9_MATCH_TTL_SECONDS,
} from './constants';
import { commitGrid9Aggregate } from './grid9AtomicScript';
import { Grid9Error } from './grid9Errors';
import type {
  Grid9EscrowWallet,
  Grid9LedgerEntry,
  Grid9LedgerReceipt,
  Grid9ServerOperationReceipt,
} from './ledger';
import type {
  Grid9ClientIntent,
  Grid9ErrorCode,
  Grid9RoomServerEvent,
} from './protocol';
import {
  grid9AggregateFields,
  grid9RedisKeys,
  type Grid9ConsumedNonceRecord,
  type Grid9IntentReceiptRecord,
  type Grid9TimerOutboxRecord,
} from './redisKeys';
import { parseGrid9GameState } from './schemas';
import type { Grid9GameState } from './state';
import { clearGrid9MatchPresence } from './grid9Presence';

export type Grid9AggregateSnapshot = {
  state: Grid9GameState;
  stateJson: string;
  escrow: Grid9EscrowWallet | null;
  escrowJson: string | null;
};

export type Grid9PaidCommitResult =
  | { status: 'committed'; receipt: Grid9IntentReceiptRecord }
  | { status: 'replay'; receipt: Grid9IntentReceiptRecord };

export type Grid9ServerCommitResult =
  | { status: 'committed'; receipt: Grid9ServerOperationReceipt }
  | { status: 'replay'; receipt: Grid9ServerOperationReceipt };

function redis() {
  return getEconomyInfra().redis;
}

export function grid9NonceDigest(nonce: string): string {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

export function emptyGrid9Escrow(
  matchId: string,
  userId: string,
  now = new Date().toISOString(),
): Grid9EscrowWallet {
  return {
    schemaVersion: 1,
    matchId,
    userId,
    currency: 'coins',
    status: 'open',
    platformReservedCoins: 0,
    microDropCreditCoins: 0,
    availableCoins: 0,
    spentCoins: 0,
    spentPlatformCoins: 0,
    spentMicroDropCoins: 0,
    refundedCoins: 0,
    refundedPlatformCoins: 0,
    refundedMicroDropCoins: 0,
    releasedCoins: 0,
    expiredMicroDropCoins: 0,
    reservationIds: [],
    version: 1,
    openedAt: now,
    updatedAt: now,
    settledAt: null,
  };
}

export async function createGrid9Aggregate(
  state: Grid9GameState,
): Promise<boolean> {
  const parsed = parseGrid9GameState(state);
  const key = grid9RedisKeys.matchAggregate(parsed.matchId);
  const created = await redis().hsetnx(
    key,
    grid9AggregateFields.state,
    JSON.stringify(parsed),
  );
  if (created !== 1) return false;
  await redis()
    .multi()
    .hset(key, grid9AggregateFields.sequence, String(parsed.authority.eventSequence))
    .expire(key, GRID9_LEDGER_TTL_SECONDS)
    .exec();
  await redis().sadd(grid9RedisKeys.activeMatches(), parsed.matchId);
  for (const player of parsed.players) {
    if (player.kind === 'human') {
      await redis().set(
        grid9RedisKeys.userMatch(player.userId),
        parsed.matchId,
        'EX',
        GRID9_MATCH_TTL_SECONDS,
      );
    }
  }
  return true;
}

export async function readGrid9State(
  matchId: string,
): Promise<Grid9GameState> {
  const stateJson = await redis().hget(
    grid9RedisKeys.matchAggregate(matchId),
    grid9AggregateFields.state,
  );
  if (!stateJson) {
    throw new Grid9Error('MATCH_NOT_FOUND', 'Grid 9 match not found');
  }
  return parseGrid9GameState(JSON.parse(stateJson));
}

export async function readGrid9Aggregate(
  matchId: string,
  userId: string | null,
): Promise<Grid9AggregateSnapshot> {
  const key = grid9RedisKeys.matchAggregate(matchId);
  const escrowField = userId ? grid9AggregateFields.escrow(userId) : null;
  const values = escrowField
    ? await redis().hmget(key, grid9AggregateFields.state, escrowField)
    : [await redis().hget(key, grid9AggregateFields.state), null];
  const stateJson = values[0];
  if (!stateJson) {
    throw new Grid9Error('MATCH_NOT_FOUND', 'Grid 9 match not found');
  }
  const escrowJson = values[1];
  return {
    state: parseGrid9GameState(JSON.parse(stateJson)),
    stateJson,
    escrow: escrowJson
      ? (JSON.parse(escrowJson) as Grid9EscrowWallet)
      : null,
    escrowJson,
  };
}

export async function readGrid9IntentReceipt(
  matchId: string,
  userId: string,
  intentId: string,
): Promise<Grid9IntentReceiptRecord | null> {
  const raw = await redis().hget(
    grid9RedisKeys.matchAggregate(matchId),
    grid9AggregateFields.intent(userId, intentId),
  );
  return raw ? (JSON.parse(raw) as Grid9IntentReceiptRecord) : null;
}

const REPLAY_NONCE_LUA = `
local key = KEYS[1]
local intentField = ARGV[1]
local nonceField = ARGV[2]
local intentId = ARGV[3]
local userId = ARGV[4]
local canonicalHash = ARGV[5]
local nonceJson = ARGV[6]
local receiptJson = redis.call('HGET', key, intentField)
if not receiptJson then return 'MISSING' end
local receipt = cjson.decode(receiptJson)
if receipt.status ~= 'committed'
  or receipt.intentId ~= intentId
  or receipt.userId ~= userId
  or receipt.canonicalIntentHash ~= canonicalHash then
  return 'CONFLICT'
end
local existingNonceJson = redis.call('HGET', key, nonceField)
if existingNonceJson then
  local existingNonce = cjson.decode(existingNonceJson)
  if existingNonce.intentId ~= intentId then return 'NONCE_REPLAY' end
  return 'OK'
end
redis.call('HSET', key, nonceField, nonceJson)
return 'OK'
`;

export async function consumeGrid9ReplayNonce(args: {
  matchId: string;
  userId: string;
  intentId: string;
  connectionSessionId: string;
  nonce: string;
  canonicalIntentHash: string;
}): Promise<void> {
  const digest = grid9NonceDigest(args.nonce);
  const nonceRecord: Grid9ConsumedNonceRecord = {
    schemaVersion: 1,
    nonceDigest: digest,
    intentId: args.intentId,
    userId: args.userId,
    connectionSessionId: args.connectionSessionId,
    consumedAt: new Date().toISOString(),
  };
  const result = (await redis().eval(
    REPLAY_NONCE_LUA,
    1,
    grid9RedisKeys.matchAggregate(args.matchId),
    grid9AggregateFields.intent(args.userId, args.intentId),
    grid9AggregateFields.nonce(args.userId, digest),
    args.intentId,
    args.userId,
    args.canonicalIntentHash,
    JSON.stringify(nonceRecord),
  )) as string;
  if (result === 'OK') return;
  if (result === 'NONCE_REPLAY') {
    throw new Grid9Error('NONCE_REPLAY', 'Grid 9 nonce already consumed');
  }
  throw new Grid9Error(
    'INTENT_CONFLICT',
    'Grid 9 replay does not match the committed intent',
  );
}

function rejection(
  code: string | null,
  detail: string | null,
  stateVersion: number,
): never {
  const allowed: Grid9ErrorCode[] = [
    'AUTH_REQUIRED',
    'BAD_PROTOCOL_VERSION',
    'INVALID_PAYLOAD',
    'INVALID_NONCE',
    'NONCE_REPLAY',
    'INTENT_CONFLICT',
    'STALE_STATE',
    'RATE_LIMITED',
    'QUEUE_ENTRY_NOT_FOUND',
    'MATCH_NOT_FOUND',
    'MATCH_NOT_ACTIVE',
    'PLAYER_NOT_FOUND',
    'NOT_ELIGIBLE',
    'UNAUTHORIZED_HOST_ACTION',
    'TARGET_NOT_ALIVE',
    'TARGET_SELF',
    'ITEM_NOT_FOUND',
    'COOLDOWN_ACTIVE',
    'INSUFFICIENT_FUNDS',
    'INVALID_RESERVE_AMOUNT',
    'WALLET_RESERVATION_FAILED',
    'ESCROW_FROZEN',
    'INVALID_FUND_AMOUNT',
    'SETTLEMENT_IN_PROGRESS',
    'INTERNAL_ERROR',
  ];
  const normalized = allowed.includes(code as Grid9ErrorCode)
    ? (code as Grid9ErrorCode)
    : 'INTERNAL_ERROR';
  throw new Grid9Error(
    normalized,
    normalized === 'STALE_STATE'
      ? 'Grid 9 state changed; resync required'
      : normalized === 'INSUFFICIENT_FUNDS'
        ? 'Insufficient Grid 9 escrow balance'
        : 'Grid 9 action rejected',
    {
      retryable: normalized === 'STALE_STATE' || normalized === 'INTERNAL_ERROR',
      stateVersion,
    },
  );
}

async function projectLedger(
  matchId: string,
  ledger: Grid9LedgerEntry | null,
): Promise<void> {
  if (!ledger) return;
  try {
    const key = grid9RedisKeys.ledgerProjection(matchId);
    await redis()
      .multi()
      .xadd(key, '*', 'entry', JSON.stringify(ledger))
      .expire(key, GRID9_LEDGER_TTL_SECONDS)
      .exec();
  } catch (error: any) {
    logger.warn(
      { matchId, err: error?.message || String(error) },
      '[grid9] ledger projection failed',
    );
  }
}

export async function projectGrid9Timer(
  record: Grid9TimerOutboxRecord | null,
): Promise<void> {
  if (!record) return;
  try {
    const member = `${record.matchId}|${record.reason}|${record.stateVersion}`;
    await redis().zadd(
      grid9RedisKeys.timersProjection(),
      Date.parse(record.dueAt),
      member,
    );
  } catch (error: any) {
    logger.warn(
      { matchId: record.matchId, err: error?.message || String(error) },
      '[grid9] timer projection failed',
    );
  }
}

export async function commitGrid9PaidMutation(args: {
  snapshot: Grid9AggregateSnapshot;
  nextState: Grid9GameState;
  nextEscrow: Grid9EscrowWallet;
  intent: Grid9ClientIntent;
  authenticatedUserId: string;
  canonicalIntentHash: string;
  ledger: Grid9LedgerEntry;
  privateReceipt: Grid9LedgerReceipt;
  roomEvent: Grid9RoomServerEvent;
  timerOutbox: Grid9TimerOutboxRecord | null;
  fundingSource?: 'actor_escrow' | 'inventory' | 'free_drop' | 'mercenary_bankroll';
}): Promise<Grid9PaidCommitResult> {
  const nextState = parseGrid9GameState(args.nextState);
  const key = grid9RedisKeys.matchAggregate(nextState.matchId);
  const escrowField = grid9AggregateFields.escrow(args.authenticatedUserId);
  const nonceField = grid9AggregateFields.nonce(
    args.authenticatedUserId,
    grid9NonceDigest(args.intent.nonce),
  );
  const intentField = grid9AggregateFields.intent(
    args.authenticatedUserId,
    args.intent.intentId,
  );
  const nonceRecord: Grid9ConsumedNonceRecord = {
    schemaVersion: 1,
    nonceDigest: grid9NonceDigest(args.intent.nonce),
    intentId: args.intent.intentId,
    userId: args.authenticatedUserId,
    connectionSessionId: args.intent.connectionSessionId,
    consumedAt: args.privateReceipt.committedAt,
  };
  const intentReceipt: Grid9IntentReceiptRecord = {
    schemaVersion: 1,
    intentId: args.intent.intentId,
    matchId: nextState.matchId,
    userId: args.authenticatedUserId,
    commandType: args.intent.type,
    canonicalIntentHash: args.canonicalIntentHash,
    status: 'committed',
    stateVersion: nextState.authority.stateVersion,
    ledgerEntryId: args.ledger.entryId,
    privateReceipt: args.privateReceipt,
    errorCode: null,
    serverMessageId: args.roomEvent.messageId,
    replayEvent: {
      type: args.roomEvent.type,
      messageId: args.roomEvent.messageId,
      payloadJson: JSON.stringify(args.roomEvent.payload),
      stateVersion: args.roomEvent.stateVersion,
      sequence: args.roomEvent.sequence,
    },
    recordedAt: args.privateReceipt.committedAt,
  };
  const ledgerField = grid9AggregateFields.ledger(args.ledger.entryId);
  const fields: Array<[string, string]> = [
    [grid9AggregateFields.state, JSON.stringify(nextState)],
    [grid9AggregateFields.sequence, String(nextState.authority.eventSequence)],
    [escrowField, JSON.stringify(args.nextEscrow)],
    [nonceField, JSON.stringify(nonceRecord)],
    [intentField, JSON.stringify(intentReceipt)],
    [ledgerField, JSON.stringify(args.ledger)],
  ];
  if (args.timerOutbox) {
    fields.push([
      grid9AggregateFields.timerOutbox(args.timerOutbox.stateVersion),
      JSON.stringify(args.timerOutbox),
    ]);
  }
  const currentAvailable = args.snapshot.escrow?.availableCoins ?? 0;
  const result = await commitGrid9Aggregate(redis(), key, {
    matchId: nextState.matchId,
    intentId: args.intent.intentId,
    authenticatedUserId: args.authenticatedUserId,
    commandType: args.intent.type,
    canonicalIntentHash: args.canonicalIntentHash,
    canonicalOperationHash: null,
    expectedStateVersion: args.snapshot.state.authority.stateVersion,
    stateVersionDelta: 1,
    escrowField,
    expectedEscrowJson: args.snapshot.escrowJson,
    escrowDelta: args.nextEscrow.availableCoins - currentAvailable,
    nonceField,
    intentField,
    operationField: null,
    paidValidation:
      args.intent.type === 'FIRE_WEAPON'
        ? {
            ledgerField,
            itemId: args.intent.payload.weaponId,
            targetSlotIndex: args.intent.payload.targetSlotIndex,
            fundingSource: args.fundingSource ?? 'actor_escrow',
          }
        : args.intent.type === 'PURCHASE_SHIELD'
          ? {
              ledgerField,
              itemId: args.intent.payload.shieldId,
              targetSlotIndex:
                args.intent.payload.beneficiarySlotIndex,
              fundingSource: args.fundingSource ?? 'actor_escrow',
            }
          : args.intent.type === 'FUND_MERCENARY'
            ? {
                ledgerField,
                itemId: null,
                targetSlotIndex:
                  args.intent.payload.beneficiarySlotIndex,
              }
            : args.intent.type === 'SEND_ARSENAL_GIFT'
              ? {
                  ledgerField,
                  itemId: args.intent.payload.itemId,
                  targetSlotIndex: args.intent.payload.recipientSlotIndex,
                }
              : args.intent.type === 'BUY_INVENTORY_ITEM'
                ? {
                    ledgerField,
                    itemId: args.intent.payload.itemId,
                    targetSlotIndex:
                      args.nextState.players.find(
                        (player) =>
                          player.kind === 'human' &&
                          player.userId === args.authenticatedUserId,
                      )?.slotIndex ?? 0,
                  }
                : args.intent.type === 'BUYBACK'
                  ? {
                      ledgerField,
                      itemId: null,
                      targetSlotIndex:
                        args.nextState.players.find(
                          (player) =>
                            player.kind === 'human' &&
                            player.userId === args.authenticatedUserId,
                        )?.slotIndex ?? 0,
                    }
                  : null,
    fields,
  });
  if (result.status === 'REJECTED') {
    rejection(
      result.code,
      result.detail,
      args.snapshot.state.authority.stateVersion,
    );
  }
  if (result.status === 'REPLAY') {
    return {
      status: 'replay',
      receipt: JSON.parse(result.detail || '{}') as Grid9IntentReceiptRecord,
    };
  }
  await Promise.all([
    projectLedger(nextState.matchId, args.ledger),
    projectGrid9Timer(args.timerOutbox),
    redis().expire(key, GRID9_LEDGER_TTL_SECONDS),
  ]);
  return { status: 'committed', receipt: intentReceipt };
}

export async function commitGrid9ServerMutation(args: {
  currentState: Grid9GameState;
  nextState: Grid9GameState;
  operationReceipt: Grid9ServerOperationReceipt;
  ledger?: Grid9LedgerEntry | null;
  escrowUserId?: string | null;
  currentEscrow?: Grid9EscrowWallet | null;
  nextEscrow?: Grid9EscrowWallet | null;
  escrowUpdates?: Array<{
    userId: string;
    current: Grid9EscrowWallet;
    next: Grid9EscrowWallet;
  }>;
  timerOutbox?: Grid9TimerOutboxRecord | null;
}): Promise<Grid9ServerCommitResult> {
  const currentState = parseGrid9GameState(args.currentState);
  const nextState = parseGrid9GameState(args.nextState);
  const key = grid9RedisKeys.matchAggregate(currentState.matchId);
  const operationField = grid9AggregateFields.operation(
    args.operationReceipt.operationId,
  );
  const fields: Array<[string, string]> = [
    [grid9AggregateFields.state, JSON.stringify(nextState)],
    [grid9AggregateFields.sequence, String(nextState.authority.eventSequence)],
    [operationField, JSON.stringify(args.operationReceipt)],
  ];
  let escrowField: string | null = null;
  if (args.escrowUserId && args.nextEscrow) {
    escrowField = grid9AggregateFields.escrow(args.escrowUserId);
    fields.push([escrowField, JSON.stringify(args.nextEscrow)]);
  }
  for (const update of args.escrowUpdates ?? []) {
    fields.push([
      grid9AggregateFields.escrow(update.userId),
      JSON.stringify(update.next),
    ]);
  }
  if (args.ledger) {
    fields.push([
      grid9AggregateFields.ledger(args.ledger.entryId),
      JSON.stringify(args.ledger),
    ]);
  }
  if (args.timerOutbox) {
    fields.push([
      grid9AggregateFields.timerOutbox(args.timerOutbox.stateVersion),
      JSON.stringify(args.timerOutbox),
    ]);
  }
  const result = await commitGrid9Aggregate(redis(), key, {
    matchId: currentState.matchId,
    intentId: null,
    authenticatedUserId: null,
    commandType: null,
    canonicalIntentHash: null,
    canonicalOperationHash: args.operationReceipt.canonicalOperationHash,
    expectedStateVersion: currentState.authority.stateVersion,
    stateVersionDelta: 1,
    escrowField,
    expectedEscrowJson: args.currentEscrow
      ? JSON.stringify(args.currentEscrow)
      : null,
    escrowDelta:
      (args.nextEscrow?.availableCoins ?? 0) -
      (args.currentEscrow?.availableCoins ?? 0),
    nonceField: null,
    intentField: null,
    operationField,
    paidValidation: null,
    fields,
  });
  if (result.status === 'REJECTED') {
    rejection(
      result.code,
      result.detail,
      currentState.authority.stateVersion,
    );
  }
  if (result.status === 'REPLAY') {
    return {
      status: 'replay',
      receipt: JSON.parse(result.detail || '{}') as Grid9ServerOperationReceipt,
    };
  }
  await Promise.all([
    projectLedger(currentState.matchId, args.ledger ?? null),
    projectGrid9Timer(args.timerOutbox ?? null),
  ]);
  return { status: 'committed', receipt: args.operationReceipt };
}

export async function readGrid9Escrows(
  matchId: string,
): Promise<Grid9EscrowWallet[]> {
  const all = await redis().hgetall(grid9RedisKeys.matchAggregate(matchId));
  return Object.entries(all)
    .filter(([field]) => field.startsWith('escrow:'))
    .map(([, value]) => JSON.parse(value) as Grid9EscrowWallet);
}

export async function removeGrid9ActiveMatch(matchId: string): Promise<void> {
  await Promise.all([
    redis().srem(grid9RedisKeys.activeMatches(), matchId),
    clearGrid9MatchPresence(matchId),
  ]);
}

export function newGrid9ServerOperationReceipt(args: {
  matchId: string;
  kind: Grid9ServerOperationReceipt['kind'];
  canonicalOperationHash: string;
  stateVersion: number;
  ledgerEntryId?: string | null;
  result: unknown;
  operationId?: string;
  recordedAt?: string;
}): Grid9ServerOperationReceipt {
  return {
    schemaVersion: 1,
    operationId: args.operationId ?? randomUUID(),
    canonicalOperationHash: args.canonicalOperationHash,
    matchId: args.matchId,
    kind: args.kind,
    status: 'committed',
    stateVersion: args.stateVersion,
    ledgerEntryId: args.ledgerEntryId ?? null,
    resultJson: JSON.stringify(args.result),
    recordedAt: args.recordedAt ?? new Date().toISOString(),
  };
}
