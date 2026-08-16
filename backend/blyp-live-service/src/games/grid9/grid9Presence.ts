import { getEconomyInfra } from '../../economy/infra';
import { GRID9_DISCONNECT_GRACE_MS } from './constants';
import {
  GRID9_PRESENCE_TTL_SECONDS,
  grid9RedisKeys,
  type Grid9PresenceEntry,
} from './redisKeys';

export interface Grid9UserPresence {
  schemaVersion: 1;
  userId: string;
  sockets: Record<string, Grid9PresenceEntry>;
}

function redis() {
  return getEconomyInfra().redis;
}

async function readUserPresence(
  matchId: string,
  userId: string,
): Promise<Grid9UserPresence | null> {
  const raw = await redis().get(grid9RedisKeys.presenceUser(matchId, userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Grid9UserPresence;
  } catch {
    return null;
  }
}

async function writeUserPresence(
  matchId: string,
  presence: Grid9UserPresence,
): Promise<void> {
  const socketIds = Object.keys(presence.sockets);
  const userKey = grid9RedisKeys.presenceUser(matchId, presence.userId);
  const indexKey = grid9RedisKeys.presenceIndex(matchId);
  if (socketIds.length === 0) {
    await redis().multi().del(userKey).srem(indexKey, presence.userId).exec();
    return;
  }
  await redis()
    .multi()
    .set(userKey, JSON.stringify(presence), 'EX', GRID9_PRESENCE_TTL_SECONDS)
    .sadd(indexKey, presence.userId)
    .exec();
}

export async function upsertGrid9Presence(args: {
  matchId: string;
  socketId: string;
  userId: string;
  role: 'player' | 'audience';
  slotIndex: number | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const current =
    (await readUserPresence(args.matchId, args.userId)) ?? {
      schemaVersion: 1,
      userId: args.userId,
      sockets: {},
    };
  const previous = current.sockets[args.socketId];
  current.sockets[args.socketId] = {
    schemaVersion: 1,
    connectionId: args.socketId,
    userId: args.userId,
    role: args.role,
    slotIndex: args.slotIndex as Grid9PresenceEntry['slotIndex'],
    connectedAt: previous?.connectedAt ?? now,
    lastSeenAt: now,
  };
  await writeUserPresence(args.matchId, current);
  await cancelGrid9DisconnectTimeout(args.matchId, args.userId);
}

export async function refreshGrid9Presence(
  matchId: string,
  socketId: string,
  userId: string,
): Promise<void> {
  const current = await readUserPresence(matchId, userId);
  const entry = current?.sockets[socketId];
  if (!current || !entry) return;
  entry.lastSeenAt = new Date().toISOString();
  await writeUserPresence(matchId, current);
}

export async function removeGrid9PresenceSocket(
  matchId: string,
  userId: string,
  socketId: string,
): Promise<boolean> {
  const current = await readUserPresence(matchId, userId);
  if (!current) return false;
  delete current.sockets[socketId];
  await writeUserPresence(matchId, current);
  return Object.keys(current.sockets).length > 0;
}

export async function hasOtherGrid9UserPresence(
  matchId: string,
  userId: string,
): Promise<boolean> {
  const current = await readUserPresence(matchId, userId);
  return current !== null && Object.keys(current.sockets).length > 0;
}

export async function scheduleGrid9DisconnectTimeout(
  matchId: string,
  userId: string,
): Promise<void> {
  await redis().zadd(
    grid9RedisKeys.presenceTimeouts(),
    Date.now() + GRID9_DISCONNECT_GRACE_MS,
    grid9RedisKeys.presenceTimeoutMember(matchId, userId),
  );
}

export async function cancelGrid9DisconnectTimeout(
  matchId: string,
  userId: string,
): Promise<void> {
  await redis().zrem(
    grid9RedisKeys.presenceTimeouts(),
    grid9RedisKeys.presenceTimeoutMember(matchId, userId),
  );
}

export async function claimDueGrid9DisconnectTimeouts(
  limit = 24,
): Promise<Array<{ matchId: string; userId: string }>> {
  const members = await redis().zrangebyscore(
    grid9RedisKeys.presenceTimeouts(),
    '-inf',
    Date.now(),
    'LIMIT',
    0,
    limit,
  );
  const claimed: Array<{ matchId: string; userId: string }> = [];
  for (const member of members) {
    const removed = await redis().zrem(
      grid9RedisKeys.presenceTimeouts(),
      member,
    );
    if (removed !== 1) continue;
    const [matchId, userId] = member.split('|');
    if (!matchId || !userId) continue;
    claimed.push({ matchId, userId });
  }
  return claimed;
}

export async function ensureGrid9DisconnectTimeout(
  matchId: string,
  userId: string,
): Promise<void> {
  const member = grid9RedisKeys.presenceTimeoutMember(matchId, userId);
  const existing = await redis().zscore(
    grid9RedisKeys.presenceTimeouts(),
    member,
  );
  if (existing !== null) return;
  await redis().zadd(
    grid9RedisKeys.presenceTimeouts(),
    'NX',
    Date.now() + GRID9_DISCONNECT_GRACE_MS,
    member,
  );
}

export async function clearGrid9MatchPresence(matchId: string): Promise<void> {
  const indexKey = grid9RedisKeys.presenceIndex(matchId);
  const userIds = await redis().smembers(indexKey);
  if (userIds.length === 0) {
    await redis().del(indexKey);
    return;
  }
  const multi = redis().multi();
  for (const userId of userIds) {
    multi.del(grid9RedisKeys.presenceUser(matchId, userId));
    multi.zrem(
      grid9RedisKeys.presenceTimeouts(),
      grid9RedisKeys.presenceTimeoutMember(matchId, userId),
    );
  }
  multi.del(indexKey);
  await multi.exec();
}
