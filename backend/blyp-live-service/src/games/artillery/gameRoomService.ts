/**
 * Server-authoritative Blyp Artillery match rooms.
 *
 * Match state lives in Redis (shared across Cloud Run instances) keyed by the
 * live `sessionId` (== the realtime room id `stream:{sessionId}`). All mutations
 * run the pure deterministic engine on the server and are guarded by a short
 * Redis lock so a fire and a revive-gift can't clobber each other.
 *
 * Authority rules:
 *  - Only the player whose turn it is may fire, and only with one of their units.
 *  - Revives are applied to the gift RECEIVER's team (the creator a viewer backs).
 *  - Clients never mutate state directly; they render what the server returns.
 */
import { randomUUID } from 'crypto';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import {
  createMatch,
  simulateShot,
  applyOutcome,
  reviveUnit,
  seedFromString,
  WEAPONS,
  type MatchState,
  type Outcome,
  type FireInput,
} from './engine';

const TTL_SECONDS = 60 * 60 * 3; // matches live for up to 3 hours
const REVIVE_CAP = 5;

const stateKey = (sessionId: string) => `artillery:match:${sessionId}`;
const lockKey = (sessionId: string) => `artillery:lock:${sessionId}`;

export interface GameRoom {
  sessionId: string;
  battleId: string | null;
  players: { '0': string | null; '1': string | null };
  state: MatchState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function redis() {
  return getEconomyInfra().redis;
}

async function loadRoom(sessionId: string): Promise<GameRoom | null> {
  const raw = await redis().get(stateKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GameRoom;
  } catch {
    return null;
  }
}

async function saveRoom(room: GameRoom): Promise<void> {
  room.updatedAt = new Date().toISOString();
  await redis().set(stateKey(room.sessionId), JSON.stringify(room), 'EX', TTL_SECONDS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` while holding a short per-session lock (SET NX PX + token release). */
async function withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(sessionId);
  const token = randomUUID();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    // ioredis: set(key, val, 'PX', ms, 'NX')
    const ok = await redis().set(key, token, 'PX', 5000, 'NX');
    if (ok) {
      try {
        return await fn();
      } finally {
        try {
          const cur = await redis().get(key);
          if (cur === token) await redis().del(key);
        } catch (e) {
          logger.warn({ sessionId, err: (e as any)?.message }, '[artillery] lock release failed');
        }
      }
    }
    await sleep(60);
  }
  const err: any = new Error('GAME_BUSY');
  err.code = 'GAME_BUSY';
  throw err;
}

/**
 * Start (or fetch) the match for a session. Idempotent: if a match already
 * exists it is returned unchanged so a reconnecting creator never wipes state.
 * The seed is derived from the sessionId so the same battle is reproducible.
 */
export async function startMatch(args: {
  sessionId: string;
  battleId?: string | null;
  hostUserId: string;
  unitsPerTeam?: number;
  creatorName?: string;
  opponentName?: string;
}): Promise<GameRoom> {
  const { sessionId, battleId = null, hostUserId } = args;
  return withLock(sessionId, async () => {
    const existing = await loadRoom(sessionId);
    if (existing) return existing;
    const state = createMatch({
      seed: seedFromString(sessionId),
      unitsPerTeam: args.unitsPerTeam ?? 3,
      teamNames: [args.creatorName || 'Creator', args.opponentName || 'Opponent'],
    });
    const now = new Date().toISOString();
    const room: GameRoom = {
      sessionId,
      battleId,
      players: { '0': hostUserId, '1': null },
      state,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await saveRoom(room);
    return room;
  });
}

/** Register the opponent as team 1 (first non-host participant to join). */
export async function joinMatch(args: { sessionId: string; userId: string }): Promise<GameRoom> {
  const { sessionId, userId } = args;
  return withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room) {
      const err: any = new Error('MATCH_NOT_FOUND');
      err.code = 'MATCH_NOT_FOUND';
      throw err;
    }
    if (room.players['0'] === userId) return room; // host
    if (room.players['1'] && room.players['1'] !== userId) return room; // seat taken
    if (!room.players['1']) {
      room.players['1'] = userId;
      await saveRoom(room);
    }
    return room;
  });
}

export async function getRoom(sessionId: string): Promise<GameRoom | null> {
  return loadRoom(sessionId);
}

/**
 * Validate + apply a fire intent. Throws coded errors the route maps to HTTP.
 * Returns the resulting room plus the outcome (trajectories/blasts) to broadcast.
 */
export async function fire(args: {
  sessionId: string;
  userId: string;
  input: FireInput;
}): Promise<{ room: GameRoom; outcome: Outcome }> {
  const { sessionId, userId, input } = args;
  return withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room) {
      const err: any = new Error('MATCH_NOT_FOUND');
      err.code = 'MATCH_NOT_FOUND';
      throw err;
    }
    const { state } = room;
    if (state.status === 'ended') {
      const err: any = new Error('MATCH_ENDED');
      err.code = 'MATCH_ENDED';
      throw err;
    }
    const turnUserId = room.players[String(state.turnTeam) as '0' | '1'];
    if (!turnUserId || turnUserId !== userId) {
      const err: any = new Error('NOT_YOUR_TURN');
      err.code = 'NOT_YOUR_TURN';
      throw err;
    }
    if (!WEAPONS[input.weaponId]) {
      const err: any = new Error('BAD_WEAPON');
      err.code = 'BAD_WEAPON';
      throw err;
    }
    const unit = state.units.find((u) => u.id === input.unitId);
    if (!unit || !unit.alive || unit.team !== state.turnTeam) {
      const err: any = new Error('BAD_UNIT');
      err.code = 'BAD_UNIT';
      throw err;
    }
    const outcome = simulateShot(state, {
      unitId: input.unitId,
      weaponId: input.weaponId,
      angleDeg: input.angleDeg,
      power: input.power,
    });
    if (!outcome) {
      const err: any = new Error('BAD_SHOT');
      err.code = 'BAD_SHOT';
      throw err;
    }
    room.state = applyOutcome(state, outcome);
    room.version += 1;
    await saveRoom(room);
    return { room, outcome };
  });
}

/**
 * Apply a revive to the team owned by `receiverUserId` (the creator a viewer
 * backed with a revive gift). No-op (returns null) if the receiver isn't a
 * registered player or the match is over / not found.
 */
export async function applyReviveForReceiver(args: {
  sessionId: string;
  receiverUserId: string;
}): Promise<GameRoom | null> {
  const { sessionId, receiverUserId } = args;
  return withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room) return null;
    if (room.state.status === 'ended') return null;
    let team = -1;
    if (room.players['0'] === receiverUserId) team = 0;
    else if (room.players['1'] === receiverUserId) team = 1;
    if (team < 0) return null;
    const before = room.state.revivesUsed[team];
    room.state = reviveUnit(room.state, team, { cap: REVIVE_CAP });
    if (room.state.revivesUsed[team] === before) return null; // cap reached, no change
    room.version += 1;
    await saveRoom(room);
    return room;
  });
}
