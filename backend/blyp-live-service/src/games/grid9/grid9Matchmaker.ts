import {
  createHash,
  randomBytes,
  randomUUID,
} from 'crypto';
import type { Server } from 'socket.io';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import { GRID9_MATCH_TTL_SECONDS } from './constants';
import { grid9CanonicalOperationHash } from './canonical';
import {
  activateGrid9InitializedMatch,
  createGrid9Match,
  seatGrid9HumanInOpenLobby,
  type Grid9Identity,
  type Grid9OpeningRollover,
} from './grid9Engine';
import {
  commitGrid9ServerMutation,
  createGrid9Aggregate,
  grid9NonceDigest,
  newGrid9ServerOperationReceipt,
  readGrid9State,
} from './grid9AggregateStore';
import { Grid9Error } from './grid9Errors';
import {
  createGrid9PrivateEvent,
  createGrid9RoomEvent,
  emitGrid9Room,
  emitGrid9ToConnection,
} from './grid9Broadcast';
import { timerOutboxForState } from './grid9MatchService';
import { toGrid9PublicGameState } from './grid9Projection';
import type {
  Grid9QueueJoinIntent,
  Grid9QueueLeaveIntent,
  Grid9QueueStatusPayload,
} from './protocol';
import {
  GRID9_ASSIGNMENT_TTL_SECONDS,
  GRID9_QUEUE_ENTRY_TTL_SECONDS,
  grid9RegionalAggregateFields,
  grid9RedisKeys,
  type Grid9MatchAssignment,
} from './redisKeys';
import type {
  Grid9QueueEntry,
  Grid9RolloverClaim,
  Grid9RolloverPool,
  Grid9SponsorPass,
} from './state';

/** Short delay so near-simultaneous Joins land in one Redis queue batch. */
const MATCHMAKING_WINDOW_MS = 400;
const REGION_LOCK_MS = 15_000;

async function readOpenPublicLobbyMatchId(
  region: string,
): Promise<string | null> {
  const raw = await redis().hget(
    grid9RedisKeys.regionalAggregate(region),
    grid9RegionalAggregateFields.openPublicLobby,
  );
  return raw && raw.length > 0 ? raw : null;
}

export async function setOpenPublicLobbyMatchId(
  region: string,
  matchId: string,
): Promise<void> {
  await redis().hset(
    grid9RedisKeys.regionalAggregate(region),
    grid9RegionalAggregateFields.openPublicLobby,
    matchId,
  );
}

export async function clearOpenPublicLobbyMatchId(
  region: string,
  matchId?: string,
): Promise<void> {
  const key = grid9RedisKeys.regionalAggregate(region);
  const field = grid9RegionalAggregateFields.openPublicLobby;
  if (!matchId) {
    await redis().hdel(key, field);
    return;
  }
  const current = await redis().hget(key, field);
  if (current === matchId) {
    await redis().hdel(key, field);
  }
}

const SPONSOR_PASS_RESERVE_LUA = `
local key = KEYS[1]
local field = ARGV[1]
local userId = ARGV[2]
local region = ARGV[3]
local ticketId = ARGV[4]
local nowIso = ARGV[5]
local raw = redis.call('HGET', key, field)
if not raw then return 'MISSING' end
local pass = cjson.decode(raw)
if pass.userId ~= userId or pass.region ~= region then return 'OWNER' end
if pass.status ~= 'available' then
  if pass.status == 'reserved' and pass.reservedForTicketId == ticketId then return raw end
  return 'STATUS'
end
if pass.expiresAt == nil or pass.expiresAt <= nowIso then return 'EXPIRED' end
pass.status = 'reserved'
pass.reservedForTicketId = ticketId
redis.call('HSET', key, field, cjson.encode(pass))
return cjson.encode(pass)
`;

const SPONSOR_PASS_UPDATE_LUA = `
local key = KEYS[1]
local field = ARGV[1]
local ticketId = ARGV[2]
local nextStatus = ARGV[3]
local matchId = ARGV[4]
local raw = redis.call('HGET', key, field)
if not raw then return 'MISSING' end
local pass = cjson.decode(raw)
if pass.reservedForTicketId ~= ticketId then return 'CONFLICT' end
pass.status = nextStatus
if nextStatus == 'available' then
  pass.reservedForTicketId = cjson.null
elseif nextStatus == 'consumed' then
  pass.consumedByMatchId = matchId
end
redis.call('HSET', key, field, cjson.encode(pass))
return cjson.encode(pass)
`;

const ROLLOVER_CLAIM_LUA = `
local key = KEYS[1]
local rolloverField = ARGV[1]
local claimField = ARGV[2]
local claimId = ARGV[3]
local region = ARGV[4]
local matchId = ARGV[5]
local nowIso = ARGV[6]
local leaseExpiresAt = ARGV[7]
local raw = redis.call('HGET', key, rolloverField)
if not raw then return '' end
local pool = cjson.decode(raw)
if pool.status ~= 'available' or tonumber(pool.availableCoins) <= 0 then return '' end
local fenceToken = tonumber(pool.version) + 1
local claim = {
  schemaVersion = 1,
  claimId = claimId,
  idempotencyKey = 'grid9:rollover-claim:' .. region .. ':' .. matchId,
  region = region,
  sourceMatchId = pool.sourceMatchId,
  targetMatchId = matchId,
  coins = tonumber(pool.availableCoins),
  fenceToken = fenceToken,
  leaseExpiresAt = leaseExpiresAt,
  status = 'reserved',
  reservedAt = nowIso,
  consumedAt = cjson.null,
  releasedAt = cjson.null
}
pool.reservedCoins = tonumber(pool.availableCoins)
pool.availableCoins = 0
pool.status = 'reserved'
pool.reservedByClaimId = claimId
pool.reservedForMatchId = matchId
pool.reservedAt = nowIso
pool.version = fenceToken
pool.updatedAt = nowIso
redis.call('HSET', key, rolloverField, cjson.encode(pool), claimField, cjson.encode(claim))
return cjson.encode(claim)
`;

const ROLLOVER_FINALIZE_LUA = `
local key = KEYS[1]
local rolloverField = ARGV[1]
local claimField = ARGV[2]
local matchId = ARGV[3]
local fenceToken = tonumber(ARGV[4])
local nowIso = ARGV[5]
local poolRaw = redis.call('HGET', key, rolloverField)
local claimRaw = redis.call('HGET', key, claimField)
if not poolRaw or not claimRaw then return 'MISSING' end
local pool = cjson.decode(poolRaw)
local claim = cjson.decode(claimRaw)
if claim.status ~= 'reserved'
  or claim.targetMatchId ~= matchId
  or tonumber(claim.fenceToken) ~= fenceToken
  or pool.reservedByClaimId ~= claim.claimId
  or claim.leaseExpiresAt <= nowIso then return 'CONFLICT' end
claim.status = 'consumed'
claim.consumedAt = nowIso
pool.reservedCoins = math.max(0, tonumber(pool.reservedCoins) - tonumber(claim.coins))
if pool.reservedCoins > 0 then pool.status = 'reserved' else pool.status = 'available' end
pool.reservedByClaimId = cjson.null
pool.reservedForMatchId = cjson.null
pool.reservedAt = cjson.null
pool.version = tonumber(pool.version) + 1
pool.updatedAt = nowIso
redis.call('HSET', key, rolloverField, cjson.encode(pool), claimField, cjson.encode(claim))
return 'OK'
`;

const ROLLOVER_RELEASE_LUA = `
local key = KEYS[1]
local rolloverField = ARGV[1]
local claimField = ARGV[2]
local matchId = ARGV[3]
local fenceToken = tonumber(ARGV[4])
local nowIso = ARGV[5]
local poolRaw = redis.call('HGET', key, rolloverField)
local claimRaw = redis.call('HGET', key, claimField)
if not poolRaw or not claimRaw then return 'MISSING' end
local pool = cjson.decode(poolRaw)
local claim = cjson.decode(claimRaw)
if claim.status ~= 'reserved'
  or claim.targetMatchId ~= matchId
  or tonumber(claim.fenceToken) ~= fenceToken
  or claim.leaseExpiresAt > nowIso then return 'CONFLICT' end
claim.status = 'released'
claim.releasedAt = nowIso
pool.availableCoins = tonumber(pool.availableCoins) + tonumber(claim.coins)
pool.reservedCoins = math.max(0, tonumber(pool.reservedCoins) - tonumber(claim.coins))
if pool.reservedCoins > 0 then pool.status = 'reserved' else pool.status = 'available' end
pool.reservedByClaimId = cjson.null
pool.reservedForMatchId = cjson.null
pool.reservedAt = cjson.null
pool.version = tonumber(pool.version) + 1
pool.updatedAt = nowIso
redis.call('HSET', key, rolloverField, cjson.encode(pool), claimField, cjson.encode(claim))
return 'OK'
`;

function redis() {
  return getEconomyInfra().redis;
}

async function reserveSponsorPass(args: {
  passId: string;
  userId: string;
  region: string;
  ticketId: string;
}): Promise<Grid9SponsorPass> {
  const result = (await redis().eval(
    SPONSOR_PASS_RESERVE_LUA,
    1,
    grid9RedisKeys.regionalAggregate(args.region),
    grid9RegionalAggregateFields.sponsorPass(args.passId),
    args.userId,
    args.region,
    args.ticketId,
    new Date().toISOString(),
  )) as string;
  if (
    result === 'MISSING' ||
    result === 'OWNER' ||
    result === 'STATUS' ||
    result === 'EXPIRED'
  ) {
    throw new Grid9Error(
      'NOT_ELIGIBLE',
      'Sponsor’s Pass is invalid, expired, or already used',
    );
  }
  return JSON.parse(result) as Grid9SponsorPass;
}

async function updateSponsorPass(args: {
  passId: string;
  region: string;
  ticketId: string;
  status: 'available' | 'consumed';
  matchId?: string;
}): Promise<void> {
  const result = (await redis().eval(
    SPONSOR_PASS_UPDATE_LUA,
    1,
    grid9RedisKeys.regionalAggregate(args.region),
    grid9RegionalAggregateFields.sponsorPass(args.passId),
    args.ticketId,
    args.status,
    args.matchId ?? '',
  )) as string;
  if (result === 'MISSING' || result === 'CONFLICT') {
    throw new Grid9Error(
      'INTENT_CONFLICT',
      'Sponsor’s Pass reservation changed',
    );
  }
}

async function claimOpeningRollover(
  region: string,
  matchId: string,
): Promise<Grid9OpeningRollover | null> {
  const key = grid9RedisKeys.regionalAggregate(region);
  const nowMs = Date.now();
  const claimId = randomUUID();
  const raw = (await redis().eval(
    ROLLOVER_CLAIM_LUA,
    1,
    key,
    grid9RegionalAggregateFields.rollover,
    grid9RegionalAggregateFields.rolloverClaim(claimId),
    claimId,
    region,
    matchId,
    new Date(nowMs).toISOString(),
    new Date(nowMs + 30_000).toISOString(),
  )) as string;
  if (!raw) return null;
  const claim = JSON.parse(raw) as Grid9RolloverClaim;
  return {
    coins: claim.coins,
    claimId,
    fenceToken: claim.fenceToken,
    sourceMatchId: claim.sourceMatchId,
    claimStatus: 'reserved',
  };
}

async function finalizeOpeningRollover(
  rollover: Grid9OpeningRollover,
  region: string,
  matchId: string,
): Promise<void> {
  const key = grid9RedisKeys.regionalAggregate(region);
  const result = (await redis().eval(
    ROLLOVER_FINALIZE_LUA,
    1,
    key,
    grid9RegionalAggregateFields.rollover,
    grid9RegionalAggregateFields.rolloverClaim(rollover.claimId),
    matchId,
    rollover.fenceToken,
    new Date().toISOString(),
  )) as string;
  if (result !== 'OK') {
    throw new Grid9Error(
      'INTENT_CONFLICT',
      'Grid 9 rollover reservation expired',
    );
  }
}

export async function consumeGrid9ConnectionNonce(
  connectionSessionId: string,
  nonce: string,
): Promise<void> {
  const accepted = await redis().set(
    grid9RedisKeys.connectionNonce(
      connectionSessionId,
      grid9NonceDigest(nonce),
    ),
    new Date().toISOString(),
    'EX',
    10 * 60,
    'NX',
  );
  if (accepted !== 'OK') {
    throw new Grid9Error('NONCE_REPLAY', 'Grid 9 nonce already consumed');
  }
}

export async function enqueueGrid9Player(args: {
  io: Server;
  intent: Grid9QueueJoinIntent;
  identity: Grid9Identity;
  connectionSessionId: string;
}): Promise<Grid9QueueStatusPayload> {
  await consumeGrid9ConnectionNonce(
    args.connectionSessionId,
    args.intent.nonce,
  );
  const nowMs = Date.now();
  const entry: Grid9QueueEntry = {
    schemaVersion: 1,
    ticketId: args.intent.intentId,
    userId: args.identity.userId,
    publicProfileId: args.identity.publicProfileId,
    displayName: args.identity.displayName,
    avatarUrl: args.identity.avatarUrl,
    connectionSessionId: args.connectionSessionId,
    region: args.intent.payload.region,
    sponsorPassId: args.intent.payload.sponsorPassId,
    priority: args.intent.payload.sponsorPassId
      ? 'sponsor_pass'
      : 'standard',
    enqueuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(
      nowMs + GRID9_QUEUE_ENTRY_TTL_SECONDS * 1000,
    ).toISOString(),
  };
  const score =
    (entry.priority === 'sponsor_pass' ? 0 : 1) +
    nowMs / 1_000_000_000_000_000;
  if (entry.sponsorPassId) {
    await reserveSponsorPass({
      passId: entry.sponsorPassId,
      userId: entry.userId,
      region: entry.region,
      ticketId: entry.ticketId,
    });
  }
  await redis()
    .multi()
    .set(
      grid9RedisKeys.queueEntry(entry.region, entry.ticketId),
      JSON.stringify(entry),
      'EX',
      GRID9_QUEUE_ENTRY_TTL_SECONDS,
    )
    .zadd(grid9RedisKeys.queue(entry.region), score, entry.ticketId)
    .exec();
  const rank = await redis().zrank(
    grid9RedisKeys.queue(entry.region),
    entry.ticketId,
  );
  setTimeout(() => {
    void processGrid9RegionQueue(args.io, entry.region);
  }, MATCHMAKING_WINDOW_MS);
  return {
    status: 'queued',
    entry,
    position: rank === null ? null : rank + 1,
    estimatedWaitMs: MATCHMAKING_WINDOW_MS,
  };
}

export async function leaveGrid9Queue(args: {
  intent: Grid9QueueLeaveIntent;
  userId: string;
  connectionSessionId: string;
}): Promise<Grid9QueueStatusPayload> {
  await consumeGrid9ConnectionNonce(
    args.connectionSessionId,
    args.intent.nonce,
  );
  const key = grid9RedisKeys.queueEntry(
    args.intent.payload.region,
    args.intent.payload.ticketId,
  );
  const raw = await redis().get(key);
  if (!raw) {
    return {
      status: 'left',
      entry: null,
      position: null,
      estimatedWaitMs: null,
    };
  }
  const entry = JSON.parse(raw) as Grid9QueueEntry;
  if (entry.userId !== args.userId) {
    throw new Grid9Error('NOT_ELIGIBLE', 'Queue ticket belongs to another user');
  }
  if (entry.sponsorPassId) {
    await updateSponsorPass({
      passId: entry.sponsorPassId,
      region: entry.region,
      ticketId: entry.ticketId,
      status: 'available',
    });
  }
  await redis()
    .multi()
    .del(key)
    .zrem(
      grid9RedisKeys.queue(args.intent.payload.region),
      args.intent.payload.ticketId,
    )
    .exec();
  return {
    status: 'left',
    entry: null,
    position: null,
    estimatedWaitMs: null,
  };
}

async function releaseLock(key: string, token: string): Promise<void> {
  await redis().eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
    1,
    key,
    token,
  );
}

async function assignQueueEntryToMatch(args: {
  io: Server;
  region: string;
  entry: Grid9QueueEntry;
  matchId: string;
  liveSessionId: string;
  slotIndex: number;
  stateVersion: number;
}): Promise<void> {
  const assignmentId = randomUUID();
  const assignmentToken = randomBytes(32).toString('base64url');
  const assignment: Grid9MatchAssignment = {
    schemaVersion: 1,
    assignmentId,
    region: args.region,
    assignmentTokenHash: createHash('sha256')
      .update(assignmentToken, 'utf8')
      .digest('hex'),
    matchId: args.matchId,
    liveSessionId: args.liveSessionId,
    ticketId: args.entry.ticketId,
    userId: args.entry.userId,
    connectionSessionId: args.entry.connectionSessionId,
    sponsorPassId: args.entry.sponsorPassId,
    slotIndex: args.slotIndex as Grid9MatchAssignment['slotIndex'],
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(
      Date.now() + GRID9_ASSIGNMENT_TTL_SECONDS * 1000,
    ).toISOString(),
    consumedAt: null,
  };
  await redis()
    .multi()
    .set(
      grid9RedisKeys.userMatch(args.entry.userId),
      args.matchId,
      'EX',
      GRID9_MATCH_TTL_SECONDS,
    )
    .set(
      grid9RedisKeys.assignment(args.region, assignmentId),
      JSON.stringify(assignment),
      'EX',
      GRID9_ASSIGNMENT_TTL_SECONDS,
    )
    .del(grid9RedisKeys.queueEntry(args.region, args.entry.ticketId))
    .zrem(grid9RedisKeys.queue(args.region), args.entry.ticketId)
    .exec();
  emitGrid9ToConnection(
    args.io,
    args.entry.connectionSessionId,
    createGrid9PrivateEvent({
      type: 'MATCH_ASSIGNED',
      connectionSessionId: args.entry.connectionSessionId,
      matchId: args.matchId,
      stateVersion: args.stateVersion,
      causationIntentId: args.entry.ticketId,
      payload: {
        assignmentId,
        matchId: args.matchId,
        liveSessionId: args.liveSessionId,
        slotIndex: args.slotIndex as Grid9MatchAssignment['slotIndex'],
        assignmentToken,
        assignmentExpiresAt: assignment.expiresAt,
      },
    }),
  );
}

/**
 * Prefer seating into the region's open public lobby_waiting match so same-window
 * Joins share one room. Private rooms are untouched (code join).
 */
async function tryAdmitEntriesToOpenPublicLobby(args: {
  io: Server;
  region: string;
  entries: Grid9QueueEntry[];
}): Promise<Grid9QueueEntry[]> {
  const openMatchId = await readOpenPublicLobbyMatchId(args.region);
  if (!openMatchId) return args.entries;

  let state: Awaited<ReturnType<typeof readGrid9State>>;
  try {
    state = await readGrid9State(openMatchId);
  } catch (error) {
    if (error instanceof Grid9Error && error.code === 'MATCH_NOT_FOUND') {
      await clearOpenPublicLobbyMatchId(args.region, openMatchId);
      return args.entries;
    }
    throw error;
  }

  if (
    state.roomMode !== 'public' ||
    (state.phase !== 'lobby_waiting' && state.phase !== 'countdown')
  ) {
    await clearOpenPublicLobbyMatchId(args.region, openMatchId);
    return args.entries;
  }

  const remaining: Grid9QueueEntry[] = [];
  let working = state;
  for (const entry of args.entries) {
    const openSeats = working.players.filter((p) => p.kind === 'sentinel').length;
    if (openSeats <= 0) {
      remaining.push(entry);
      continue;
    }
    try {
      const seated = seatGrid9HumanInOpenLobby(working, {
        userId: entry.userId,
        publicProfileId: entry.publicProfileId,
        displayName: entry.displayName,
        avatarUrl: entry.avatarUrl,
        queueTicketId: entry.ticketId,
        sponsorPassId: entry.sponsorPassId,
      });
      if (seated.state === working) {
        await assignQueueEntryToMatch({
          io: args.io,
          region: args.region,
          entry,
          matchId: working.matchId,
          liveSessionId: working.liveSessionId,
          slotIndex: seated.slotIndex,
          stateVersion: working.authority.stateVersion,
        });
        continue;
      }
      const operationId = `lobby-admit-${working.matchId}-${entry.ticketId}`;
      const publicAfter = toGrid9PublicGameState(seated.state);
      const replacementPlayer = publicAfter.players[seated.slotIndex];
      const roomEvent = createGrid9RoomEvent({
        type: 'PLAYER_CONNECTION_CHANGED',
        matchId: working.matchId,
        sequence: seated.state.authority.eventSequence,
        stateVersion: seated.state.authority.stateVersion,
        causationIntentId: entry.ticketId,
        payload: {
          slotIndex: seated.slotIndex,
          connectionState: 'connected',
          replacementPlayer,
          audienceCount: publicAfter.audienceCount,
        },
      });
      const operationHash = grid9CanonicalOperationHash({
        matchId: working.matchId,
        operationId,
        kind: 'phase_transition',
        payload: {
          stateVersion: working.authority.stateVersion,
          admittedUserId: entry.userId,
          slotIndex: seated.slotIndex,
        },
      });
      const committed = await commitGrid9ServerMutation({
        currentState: working,
        nextState: seated.state,
        operationReceipt: newGrid9ServerOperationReceipt({
          matchId: working.matchId,
          operationId,
          kind: 'phase_transition',
          canonicalOperationHash: operationHash,
          stateVersion: seated.state.authority.stateVersion,
          result: { slotIndex: seated.slotIndex, userId: entry.userId },
          recordedAt: roomEvent.sentAt,
        }),
        timerOutbox: timerOutboxForState(seated.state),
      });
      if (committed.status !== 'committed') {
        remaining.push(entry);
        working = await readGrid9State(openMatchId);
        continue;
      }
      working = seated.state;
      emitGrid9Room(args.io, working.matchId, roomEvent);
      await assignQueueEntryToMatch({
        io: args.io,
        region: args.region,
        entry,
        matchId: working.matchId,
        liveSessionId: working.liveSessionId,
        slotIndex: seated.slotIndex,
        stateVersion: working.authority.stateVersion,
      });
    } catch (error: any) {
      if (
        error instanceof Grid9Error &&
        (error.code === 'NOT_ELIGIBLE' || error.code === 'MATCH_NOT_ACTIVE')
      ) {
        remaining.push(entry);
        continue;
      }
      logger.warn(
        {
          region: args.region,
          matchId: openMatchId,
          err: error?.message || String(error),
        },
        '[grid9] open lobby admit failed',
      );
      remaining.push(entry);
    }
  }

  if (working.players.every((p) => p.kind === 'human')) {
    await clearOpenPublicLobbyMatchId(args.region, openMatchId);
  }
  return remaining;
}

export async function processGrid9RegionQueue(
  io: Server,
  region: string,
): Promise<void> {
  const lockKey = grid9RedisKeys.regionalLock(region);
  const lockToken = randomUUID();
  const locked = await redis().set(
    lockKey,
    lockToken,
    'PX',
    REGION_LOCK_MS,
    'NX',
  );
  if (locked !== 'OK') return;
  try {
    const ticketIds = await redis().zrange(
      grid9RedisKeys.queue(region),
      0,
      8,
    );
    if (ticketIds.length === 0) return;
    const raws = await redis().mget(
      ...ticketIds.map((ticketId) =>
        grid9RedisKeys.queueEntry(region, ticketId),
      ),
    );
    let entries: Grid9QueueEntry[] = [];
    for (let index = 0; index < ticketIds.length; index += 1) {
      const raw = raws[index];
      if (!raw) {
        await redis().zrem(grid9RedisKeys.queue(region), ticketIds[index]);
        continue;
      }
      const entry = JSON.parse(raw) as Grid9QueueEntry;
      if (Date.parse(entry.expiresAt) <= Date.now()) {
        if (entry.sponsorPassId) {
          await updateSponsorPass({
            passId: entry.sponsorPassId,
            region: entry.region,
            ticketId: entry.ticketId,
            status: 'available',
          });
        }
        await redis()
          .multi()
          .del(grid9RedisKeys.queueEntry(region, entry.ticketId))
          .zrem(grid9RedisKeys.queue(region), entry.ticketId)
          .exec();
        continue;
      }
      if (!entries.some((candidate) => candidate.userId === entry.userId)) {
        entries.push(entry);
      }
    }
    if (entries.length === 0) return;

    entries = await tryAdmitEntriesToOpenPublicLobby({ io, region, entries });
    if (entries.length === 0) return;

    const claimField = grid9RegionalAggregateFields.matchmakingClaim(
      entries[0].ticketId,
    );
    const existingClaimRaw = await redis().hget(
      grid9RedisKeys.regionalAggregate(region),
      claimField,
    );
    let matchId: string;
    if (existingClaimRaw) {
      const claim = JSON.parse(existingClaimRaw) as {
        matchId: string;
        entries: Grid9QueueEntry[];
      };
      matchId = claim.matchId;
      entries = claim.entries;
    } else {
      matchId = randomUUID();
      const claimed = await redis().hsetnx(
        grid9RedisKeys.regionalAggregate(region),
        claimField,
        JSON.stringify({ matchId, entries }),
      );
      if (claimed !== 1) {
        const racedRaw = await redis().hget(
          grid9RedisKeys.regionalAggregate(region),
          claimField,
        );
        if (!racedRaw) return;
        const raced = JSON.parse(racedRaw) as {
          matchId: string;
          entries: Grid9QueueEntry[];
        };
        matchId = raced.matchId;
        entries = raced.entries;
      }
    }

    let state: ReturnType<typeof createGrid9Match> | null = null;
    try {
      state = await readGrid9State(matchId);
    } catch (error) {
      if (
        !(error instanceof Grid9Error) ||
        error.code !== 'MATCH_NOT_FOUND'
      ) {
        throw error;
      }
    }
    if (!state) {
      const openingRollover = await claimOpeningRollover(region, matchId);
      state = createGrid9Match({
        matchId,
        liveSessionId: matchId,
        region,
        openingRollover,
        humans: entries.map((entry) => ({
          userId: entry.userId,
          publicProfileId: entry.publicProfileId,
          displayName: entry.displayName,
          avatarUrl: entry.avatarUrl,
          queueTicketId: entry.ticketId,
          sponsorPassId: entry.sponsorPassId,
        })),
      });
      if (!(await createGrid9Aggregate(state))) {
        state = await readGrid9State(matchId);
      }
      if (openingRollover && state.phase === 'initializing') {
        await finalizeOpeningRollover(openingRollover, region, matchId);
        state = activateGrid9InitializedMatch(state);
        await redis().hset(
          grid9RedisKeys.matchAggregate(matchId),
          'state',
          JSON.stringify(state),
          'sequence',
          String(state.authority.eventSequence),
        );
      }
    }
    if (state.phase === 'initializing') {
      const recovered = await recoverGrid9InitializingMatch(state);
      if (!recovered) return;
      state = recovered;
    }
    if (state.phase === 'lobby_waiting' || state.phase === 'countdown') {
      await setOpenPublicLobbyMatchId(region, state.matchId);
    }
    await redis().zadd(
      grid9RedisKeys.timersProjection(),
      Date.parse(state.phaseEndsAt as string),
      `${state.matchId}|lobby_waiting_end|${state.authority.stateVersion}`,
    );

    for (const entry of entries) {
      const slot = state.players.find(
        (player) =>
          player.kind === 'human' && player.userId === entry.userId,
      );
      if (!slot) continue;
      await assignQueueEntryToMatch({
        io,
        region,
        entry,
        matchId: state.matchId,
        liveSessionId: state.liveSessionId,
        slotIndex: slot.slotIndex,
        stateVersion: state.authority.stateVersion,
      });
    }
    await redis().hdel(
      grid9RedisKeys.regionalAggregate(region),
      claimField,
    );
  } catch (error: any) {
    logger.error(
      { region, err: error?.message || String(error) },
      '[grid9] regional matchmaking failed',
    );
  } finally {
    await releaseLock(lockKey, lockToken);
  }
}

const ASSIGNMENT_CONSUME_LUA = `
local key = KEYS[1]
local userId = ARGV[1]
local matchId = ARGV[2]
local tokenHash = ARGV[3]
local nowIso = ARGV[4]
local ttlSeconds = tonumber(ARGV[5])
local raw = redis.call('GET', key)
if not raw then return 'MISSING' end
local assignment = cjson.decode(raw)
if assignment.consumedAt ~= cjson.null and assignment.consumedAt ~= nil then
  return 'CONSUMED'
end
if assignment.userId ~= userId
  or assignment.matchId ~= matchId
  or assignment.assignmentTokenHash ~= tokenHash
  or assignment.expiresAt <= nowIso then
  return 'INVALID'
end
assignment.consumedAt = nowIso
redis.call('SET', key, cjson.encode(assignment), 'EX', ttlSeconds)
return cjson.encode(assignment)
`;

export async function consumeGrid9Assignment(args: {
  region: string;
  assignmentId: string;
  assignmentToken: string;
  matchId: string;
  userId: string;
}): Promise<Grid9MatchAssignment> {
  const key = grid9RedisKeys.assignment(args.region, args.assignmentId);
  const tokenHash = createHash('sha256')
    .update(args.assignmentToken, 'utf8')
    .digest('hex');
  const raw = (await redis().eval(
    ASSIGNMENT_CONSUME_LUA,
    1,
    key,
    args.userId,
    args.matchId,
    tokenHash,
    new Date().toISOString(),
    String(GRID9_ASSIGNMENT_TTL_SECONDS),
  )) as string;
  if (raw === 'MISSING') {
    throw new Grid9Error('QUEUE_ENTRY_NOT_FOUND', 'Match assignment expired');
  }
  if (raw === 'CONSUMED') {
    throw new Grid9Error(
      'NOT_ELIGIBLE',
      'Grid 9 assignment already consumed',
    );
  }
  if (raw === 'INVALID') {
    throw new Grid9Error('NOT_ELIGIBLE', 'Invalid Grid 9 assignment');
  }
  const assignment = JSON.parse(raw) as Grid9MatchAssignment;
  if (assignment.sponsorPassId) {
    await updateSponsorPass({
      passId: assignment.sponsorPassId,
      region: assignment.region,
      ticketId: assignment.ticketId,
      status: 'consumed',
      matchId: assignment.matchId,
    });
  }
  return assignment;
}

export async function recoverGrid9InitializingMatch(
  state: ReturnType<typeof createGrid9Match>,
): Promise<ReturnType<typeof createGrid9Match> | null> {
  if (state.phase !== 'initializing') return state;
  const claimId = state.jackpot.openingRolloverClaimId;
  const fenceToken = state.jackpot.openingRolloverFenceToken;
  if (!claimId || fenceToken === null) {
    const activated = activateGrid9InitializedMatch(state);
    await redis().hset(
      grid9RedisKeys.matchAggregate(state.matchId),
      'state',
      JSON.stringify(activated),
      'sequence',
      String(activated.authority.eventSequence),
    );
    return activated;
  }
  const regionalKey = grid9RedisKeys.regionalAggregate(state.region);
  const claimRaw = await redis().hget(
    regionalKey,
    grid9RegionalAggregateFields.rolloverClaim(claimId),
  );
  if (!claimRaw) {
    throw new Grid9Error(
      'INTERNAL_ERROR',
      'Grid 9 rollover claim is missing',
    );
  }
  const claim = JSON.parse(claimRaw) as Grid9RolloverClaim;
  if (claim.status === 'reserved' && Date.parse(claim.leaseExpiresAt) > Date.now()) {
    await finalizeOpeningRollover(
      {
        coins: claim.coins,
        claimId,
        fenceToken,
        sourceMatchId: claim.sourceMatchId,
        claimStatus: 'reserved',
      },
      state.region,
      state.matchId,
    );
  } else if (claim.status === 'reserved') {
    await redis().eval(
      ROLLOVER_RELEASE_LUA,
      1,
      regionalKey,
      grid9RegionalAggregateFields.rollover,
      grid9RegionalAggregateFields.rolloverClaim(claimId),
      state.matchId,
      fenceToken,
      new Date().toISOString(),
    );
    await redis().del(grid9RedisKeys.matchAggregate(state.matchId));
    await redis().srem(grid9RedisKeys.activeMatches(), state.matchId);
    return null;
  } else if (claim.status !== 'consumed') {
    return null;
  }
  const activated = activateGrid9InitializedMatch(state);
  await redis().hset(
    grid9RedisKeys.matchAggregate(state.matchId),
    'state',
    JSON.stringify(activated),
    'sequence',
    String(activated.authority.eventSequence),
  );
  return activated;
}
