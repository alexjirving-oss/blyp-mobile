/**
 * Server-authoritative Marble Race rooms.
 * Redis state + in-process tick loop; mutations under a short Redis lock.
 */
import { randomUUID } from 'crypto';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../../admin/firestoreAdmin';
import { listGuests } from '../../live/guestSlotStore';
import { emitMarbleGameEvent } from '../../realtime/realtimeBus';
import {
  createRaceState,
  stepRace,
  hostNextHeat,
  applyCheerBoost,
  setPick,
  seedFromString,
  TICK_MS,
  MAX_RACERS,
  type MarbleRaceState,
} from './engine';

const TTL_SECONDS = 60 * 60 * 2;
const stateKey = (sessionId: string) => `marble:race:${sessionId}`;
const lockKey = (sessionId: string) => `marble:lock:${sessionId}`;

export interface MarbleRoom {
  sessionId: string;
  hostUserId: string;
  state: MarbleRaceState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const tickHandles = new Map<string, ReturnType<typeof setInterval>>();

function redis() {
  return getEconomyInfra().redis;
}

async function loadRoom(sessionId: string): Promise<MarbleRoom | null> {
  const raw = await redis().get(stateKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MarbleRoom;
  } catch {
    return null;
  }
}

async function saveRoom(room: MarbleRoom): Promise<void> {
  room.updatedAt = new Date().toISOString();
  await redis().set(stateKey(room.sessionId), JSON.stringify(room), 'EX', TTL_SECONDS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


/** Best-effort Firestore evidence for badge_marble_podium mint (Cloud Functions). */
async function recordMarblePodiumEvidence(room: MarbleRoom): Promise<void> {
  try {
    const fs = getFirestore();
    if (!fs) return;
    const points = room.state.placePoints || {};
    let winnerId = '';
    let best = -1;
    for (const [uid, pts] of Object.entries(points)) {
      const n = Number(pts) || 0;
      if (n > best) {
        best = n;
        winnerId = uid;
      }
    }
    if (!winnerId || best < 1) return;
    const batch = fs.batch();
    const userRef = fs.collection('users').doc(winnerId);
    batch.set(
      userRef,
      {
        marblePodiumWins: FieldValue.increment(1),
        marblePodiumCount: FieldValue.increment(1),
        marblePodiumLastSessionId: room.sessionId,
        marblePodiumLastAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const evidenceRef = fs.collection('marblePodiumResults').doc(winnerId);
    batch.set(
      evidenceRef,
      {
        uid: winnerId,
        sessionId: room.sessionId,
        placePoints: best,
        lastAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
  } catch (e: any) {
    logger.warn(
      { sessionId: room.sessionId, err: e?.message || String(e) },
      '[marble] podium evidence write failed (non-fatal)',
    );
  }
}

async function withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(sessionId);
  const token = randomUUID();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const ok = await redis().set(key, token, 'PX', 5000, 'NX');
    if (ok) {
      try {
        return await fn();
      } finally {
        try {
          const cur = await redis().get(key);
          if (cur === token) await redis().del(key);
        } catch (e) {
          logger.warn({ sessionId, err: (e as any)?.message }, '[marble] lock release failed');
        }
      }
    }
    await sleep(40);
  }
  const err: any = new Error('GAME_BUSY');
  err.code = 'GAME_BUSY';
  throw err;
}

export function publicEvent(
  room: MarbleRoom,
  type: 'PHASE' | 'SNAPSHOT' | 'BOOST' | 'FINISH' | 'PODIUM' | 'ENDED' = 'SNAPSHOT',
) {
  return {
    game: 'marble' as const,
    sessionId: room.sessionId,
    type,
    version: room.version,
    hostUserId: room.hostUserId,
    state: room.state,
  };
}

function stopTicks(sessionId: string) {
  const h = tickHandles.get(sessionId);
  if (h) {
    clearInterval(h);
    tickHandles.delete(sessionId);
  }
}

function ensureTicks(sessionId: string) {
  if (tickHandles.has(sessionId)) return;
  const handle = setInterval(() => {
    void tickOnce(sessionId).catch((e) => {
      logger.warn({ sessionId, err: e?.message || String(e) }, '[marble] tick failed');
    });
  }, TICK_MS);
  try {
    (handle as any).unref?.();
  } catch {
    // ignore
  }
  tickHandles.set(sessionId, handle);
}

async function tickOnce(sessionId: string) {
  await withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room) {
      stopTicks(sessionId);
      return;
    }
    if (room.state.phase === 'ended') {
      stopTicks(sessionId);
      return;
    }
    const prevPhase = room.state.phase;
    const prevHeat = room.state.heatIndex;
    const nextState = stepRace(room.state);
    room.state = nextState;
    room.version += 1;
    await saveRoom(room);

    const phaseChanged = prevPhase !== nextState.phase || prevHeat !== nextState.heatIndex;
    let type: 'PHASE' | 'SNAPSHOT' | 'PODIUM' | 'ENDED' | 'FINISH' = 'SNAPSHOT';
    if (nextState.phase === 'ended') type = 'ENDED';
    else if (nextState.phase === 'podium' && prevPhase === 'heat') type = 'PODIUM';
    else if (phaseChanged) type = 'PHASE';
    else if (nextState.tick % 2 === 0) {
      if (nextState.phase !== 'heat' && nextState.tick % 5 !== 0) return;
    }

    emitMarbleGameEvent(sessionId, publicEvent(room, type));
    if (nextState.phase === 'ended') {
      void recordMarblePodiumEvidence(room);
      stopTicks(sessionId);
    }
  });
}

export async function resolveRacers(sessionId: string, hostUserId: string, hostName?: string) {
  const guests = await listGuests(sessionId);
  const live = guests.filter((g) => g.state === 'LIVE').slice(0, MAX_RACERS - 1);
  if (live.length < 1) {
    const err: any = new Error('NEED_GUESTS');
    err.code = 'NEED_GUESTS';
    throw err;
  }
  return [
    { userId: hostUserId, displayName: hostName || 'Host' },
    ...live.map((g, i) => ({ userId: g.userId, displayName: `Guest ${i + 1}` })),
  ].slice(0, MAX_RACERS);
}

export async function startRace(args: {
  sessionId: string;
  hostUserId: string;
  hostName?: string;
  racers?: Array<{ userId: string; displayName: string }>;
}): Promise<MarbleRoom> {
  const { sessionId, hostUserId } = args;
  return withLock(sessionId, async () => {
    const existing = await loadRoom(sessionId);
    if (existing && existing.state.phase !== 'ended') {
      ensureTicks(sessionId);
      return existing;
    }

    const racers =
      args.racers && args.racers.length >= 2
        ? args.racers.slice(0, MAX_RACERS)
        : await resolveRacers(sessionId, hostUserId, args.hostName);

    if (racers.length < 2) {
      const err: any = new Error('NEED_GUESTS');
      err.code = 'NEED_GUESTS';
      throw err;
    }

    const seed = seedFromString(`${sessionId}:${Date.now()}`);
    const state = createRaceState({ seed, racers });
    const now = new Date().toISOString();
    const room: MarbleRoom = {
      sessionId,
      hostUserId,
      state,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await saveRoom(room);
    ensureTicks(sessionId);
    emitMarbleGameEvent(sessionId, publicEvent(room, 'PHASE'));
    return room;
  });
}

export async function nextHeat(args: { sessionId: string; hostUserId: string }): Promise<MarbleRoom> {
  const { sessionId, hostUserId } = args;
  return withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room) {
      const err: any = new Error('RACE_NOT_FOUND');
      err.code = 'RACE_NOT_FOUND';
      throw err;
    }
    if (room.hostUserId !== hostUserId) {
      const err: any = new Error('NOT_HOST');
      err.code = 'NOT_HOST';
      throw err;
    }
    if (room.state.phase === 'ended') {
      const err: any = new Error('RACE_ENDED');
      err.code = 'RACE_ENDED';
      throw err;
    }
    room.state = hostNextHeat(room.state);
    room.version += 1;
    await saveRoom(room);
    ensureTicks(sessionId);
    emitMarbleGameEvent(sessionId, publicEvent(room, 'PHASE'));
    return room;
  });
}

export async function endRace(args: { sessionId: string; hostUserId: string }): Promise<MarbleRoom | null> {
  const { sessionId, hostUserId } = args;
  return withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room) return null;
    if (room.hostUserId !== hostUserId) {
      const err: any = new Error('NOT_HOST');
      err.code = 'NOT_HOST';
      throw err;
    }
    room.state = { ...room.state, phase: 'ended', phaseEndsAtTick: room.state.tick };
    room.version += 1;
    await saveRoom(room);
    stopTicks(sessionId);
    emitMarbleGameEvent(sessionId, publicEvent(room, 'ENDED'));
    void recordMarblePodiumEvidence(room);
    setTimeout(() => {
      void redis().del(stateKey(sessionId)).catch(() => undefined);
    }, 30_000);
    return room;
  });
}

export async function pickMarble(args: {
  sessionId: string;
  pickerUserId: string;
  racerUserId: string;
}): Promise<MarbleRoom> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room) {
      const err: any = new Error('RACE_NOT_FOUND');
      err.code = 'RACE_NOT_FOUND';
      throw err;
    }
    if (room.state.phase !== 'lobby') {
      const err: any = new Error('PICKS_LOCKED');
      err.code = 'PICKS_LOCKED';
      throw err;
    }
    room.state = setPick(room.state, args.pickerUserId, args.racerUserId);
    room.version += 1;
    await saveRoom(room);
    emitMarbleGameEvent(args.sessionId, publicEvent(room, 'SNAPSHOT'));
    return room;
  });
}

export async function getRoom(sessionId: string): Promise<MarbleRoom | null> {
  return loadRoom(sessionId);
}

export async function applyCheerForReceiver(args: {
  sessionId: string;
  receiverUserId: string;
  senderUserId: string;
}): Promise<MarbleRoom | null> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || room.state.phase === 'ended') return null;
    const result = applyCheerBoost(room.state, args.receiverUserId);
    if (!result.applied) return null;
    room.state = {
      ...result.state,
      lastCheer: {
        racerUserId: args.receiverUserId,
        senderUserId: args.senderUserId,
        atTick: result.state.tick,
      },
    };
    room.version += 1;
    await saveRoom(room);
    emitMarbleGameEvent(args.sessionId, publicEvent(room, 'BOOST'));
    return room;
  });
}

export async function resumeTicksIfNeeded(sessionId: string): Promise<void> {
  const room = await loadRoom(sessionId);
  if (room && room.state.phase !== 'ended') ensureTicks(sessionId);
}
