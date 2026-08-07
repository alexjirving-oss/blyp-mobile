/**
 * Frenemies — server-authoritative TikTok-style live party game.
 * Redis state + in-process tick for spin / choose / challenge timeouts.
 */
import { randomUUID, createHash } from 'crypto';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import { listGuests, leaveGuestSession } from '../../live/guestSlotStore';
import { MAX_GUEST_SLOTS } from '../../live/guestSlotAllocator';
import { emitFrenemiesGameEvent, emitRoomEvent } from '../../realtime/realtimeBus';
import { creditCoinsAdmin } from '../../economy/economyService';
import { BOOTSTRAP_STAFF_ROLES } from '../../admin/adminRbac';
import { getAdminEnv } from '../../config/adminEnv';
import { pickQuiz, pickPhrase } from './questions';

const TTL_SECONDS = 60 * 60 * 2;
const stateKey = (sessionId: string) => `frenemies:game:${sessionId}`;
const lockKey = (sessionId: string) => `frenemies:lock:${sessionId}`;
const engageKey = (sessionId: string) => `frenemies:engage:${sessionId}`;

/** Default spin 30s; override with FRENEMIES_SPIN_MS for demos. */
export const SPIN_MS = Math.max(
  5_000,
  Number(process.env.FRENEMIES_SPIN_MS || 30_000) || 30_000,
);
export const CHOOSE_MS = Math.max(5_000, Number(process.env.FRENEMIES_CHOOSE_MS || 20_000) || 20_000);
export const CHALLENGE_MS = Math.max(5_000, Number(process.env.FRENEMIES_CHALLENGE_MS || 20_000) || 20_000);
export const HOUSE_COINS = 25;
export const LIKES_TARGET = Math.max(5, Number(process.env.FRENEMIES_LIKES_TARGET || 50) || 50);

export type FrenemiesPhase =
  | 'idle'
  | 'spinning'
  | 'challenge'
  | 'choosing'
  | 'resolving'
  | 'ended';

export type ChallengeType = 'quiz' | 'chat' | 'likes';

export interface SlotOccupant {
  userId: string;
  displayName: string;
  slotIndex: number;
}

export interface ChallengePublic {
  type: ChallengeType;
  /** Quiz prompt (no correct answer). */
  question?: string;
  choices?: string[];
  /** Chat phrase to type. */
  phrase?: string;
  /** Likes needed. */
  likesTarget?: number;
  likeProgress?: Record<string, number>;
  frozenUserIds?: string[];
  endsAt: string;
}

export interface FrenemiesState {
  phase: FrenemiesPhase;
  roundId: string;
  roundIndex: number;
  spinStartedAt: string | null;
  spinEndsAt: string | null;
  /** Deterministic landing slot 1..MAX_GUEST_SLOTS once spin resolves. */
  targetSlot: number | null;
  landedSlot: number | null;
  landedOccupied: boolean;
  chooserUserId: string | null;
  chooserDisplayName: string | null;
  chooseEndsAt: string | null;
  challenge: ChallengePublic | null;
  /** Server-only quiz answer index — stripped in publicEvent. */
  challengeCorrectIndex?: number | null;
  lastResult: {
    kind: string;
    text: string;
    kickedUserId?: string | null;
    coinUserId?: string | null;
    coins?: number;
  } | null;
  active: boolean;
}

export interface FrenemiesRoom {
  sessionId: string;
  hostUserId: string;
  startedByUserId: string;
  state: FrenemiesState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type SessionEngagement = {
  likes: number;
  shares: number;
  comments: number;
  coinsSpent: number;
  coinsReceived: number;
};

const tickHandles = new Map<string, ReturnType<typeof setInterval>>();
const TICK_MS = 500;

function redis() {
  return getEconomyInfra().redis;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function isFrenemiesAdmin(userId: string): boolean {
  if (!userId) return false;
  if (BOOTSTRAP_STAFF_ROLES[userId]) return true;
  try {
    const { allowlistSubs } = getAdminEnv();
    if (allowlistSubs.includes(userId)) return true;
  } catch {
    // ignore
  }
  return false;
}

async function loadRoom(sessionId: string): Promise<FrenemiesRoom | null> {
  const raw = await redis().get(stateKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FrenemiesRoom;
  } catch {
    return null;
  }
}

async function saveRoom(room: FrenemiesRoom): Promise<void> {
  room.updatedAt = nowIso();
  await redis().set(stateKey(room.sessionId), JSON.stringify(room), 'EX', TTL_SECONDS);
}

async function withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const key = lockKey(sessionId);
  const token = randomUUID();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ok = await redis().set(key, token, 'PX', 8000, 'NX');
    if (ok) {
      try {
        return await fn();
      } finally {
        try {
          const cur = await redis().get(key);
          if (cur === token) await redis().del(key);
        } catch (e) {
          logger.warn({ sessionId, err: (e as any)?.message }, '[frenemies] lock release failed');
        }
      }
    }
    await sleep(40);
  }
  const err: any = new Error('GAME_BUSY');
  err.code = 'GAME_BUSY';
  throw err;
}

function stripPrivate(state: FrenemiesState): FrenemiesState {
  const copy = { ...state };
  delete copy.challengeCorrectIndex;
  return copy;
}

export function publicEvent(
  room: FrenemiesRoom,
  type: 'PHASE' | 'SNAPSHOT' | 'RESULT' | 'ENDED' = 'SNAPSHOT',
) {
  return {
    game: 'frenemies' as const,
    sessionId: room.sessionId,
    type,
    version: room.version,
    hostUserId: room.hostUserId,
    startedByUserId: room.startedByUserId,
    state: stripPrivate(room.state),
    spinMs: SPIN_MS,
    chooseMs: CHOOSE_MS,
    challengeMs: CHALLENGE_MS,
    houseCoins: HOUSE_COINS,
    maxSlots: MAX_GUEST_SLOTS,
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
      logger.warn({ sessionId, err: e?.message || String(e) }, '[frenemies] tick failed');
    });
  }, TICK_MS);
  try {
    (handle as any).unref?.();
  } catch {
    // ignore
  }
  tickHandles.set(sessionId, handle);
}

async function liveOccupants(sessionId: string): Promise<SlotOccupant[]> {
  const guests = await listGuests(sessionId);
  return guests
    .filter((g) => g.state === 'LIVE' && typeof g.slotIndex === 'number' && g.slotIndex >= 1 && g.slotIndex <= MAX_GUEST_SLOTS)
    .map((g) => {
      // Guest slot store has no profile fields; prefer a stable human label.
      // Clients overlay real roster names/avatars from the live guest mirror.
      const anyName = (g as any)?.displayName || (g as any)?.name || (g as any)?.username;
      return {
        userId: g.userId,
        displayName: typeof anyName === 'string' && anyName.trim() ? anyName.trim() : `Box ${g.slotIndex}`,
        slotIndex: g.slotIndex as number,
      };
    });
}

function hashSeed(s: string): number {
  const h = createHash('sha256').update(s).digest();
  return h.readUInt32BE(0);
}

/** Pick landing slot 1..11 (any). Empty vs occupied handled after land. */
function pickTargetSlot(roundId: string): number {
  const seed = hashSeed(roundId);
  return (seed % MAX_GUEST_SLOTS) + 1;
}

function pickChallengeType(roundId: string): ChallengeType {
  const types: ChallengeType[] = ['quiz', 'chat', 'likes'];
  return types[hashSeed(`${roundId}:ch`) % types.length];
}

async function forceKick(sessionId: string, guestUserId: string): Promise<void> {
  try {
    await leaveGuestSession(sessionId, guestUserId, nowIso(), { force: true });
    emitRoomEvent(sessionId, { type: 'guest.kicked', guestUserId });
  } catch (e: any) {
    logger.warn({ sessionId, guestUserId, err: e?.message }, '[frenemies] forceKick failed');
  }
}

async function grantHouseCoins(userId: string, roundId: string, reason: string): Promise<void> {
  try {
    await creditCoinsAdmin('system:frenemies', {
      targetUserId: userId,
      coins: HOUSE_COINS,
      idempotencyKey: `frenemies:${roundId}:${userId}`,
      reason,
    });
  } catch (e: any) {
    logger.error({ userId, roundId, err: e?.message || String(e) }, '[frenemies] coin grant failed');
  }
}

function beginSpin(room: FrenemiesRoom): void {
  const roundId = randomUUID();
  const now = Date.now();
  room.state = {
    phase: 'spinning',
    roundId,
    roundIndex: (room.state.roundIndex || 0) + 1,
    spinStartedAt: new Date(now).toISOString(),
    spinEndsAt: new Date(now + SPIN_MS).toISOString(),
    targetSlot: pickTargetSlot(roundId),
    landedSlot: null,
    landedOccupied: false,
    chooserUserId: null,
    chooserDisplayName: null,
    chooseEndsAt: null,
    challenge: null,
    challengeCorrectIndex: null,
    lastResult: null,
    active: true,
  };
  room.version += 1;
}

async function resolveSpinLand(room: FrenemiesRoom): Promise<void> {
  const slot = room.state.targetSlot || pickTargetSlot(room.state.roundId);
  const occ = await liveOccupants(room.sessionId);
  const atSlot = occ.find((o) => o.slotIndex === slot) || null;

  room.state.landedSlot = slot;
  room.state.landedOccupied = !!atSlot;
  room.state.spinEndsAt = nowIso();

  if (atSlot) {
    // Occupied: that guest becomes chooser.
    enterChoosing(room, atSlot.userId, atSlot.displayName);
    return;
  }

  // Empty box → everyone sees a challenge.
  const ctype = pickChallengeType(room.state.roundId);
  const endsAt = new Date(Date.now() + CHALLENGE_MS).toISOString();
  const seed = hashSeed(room.state.roundId);

  if (ctype === 'quiz') {
    const q = pickQuiz(seed);
    room.state.challengeCorrectIndex = q.correctIndex;
    room.state.challenge = {
      type: 'quiz',
      question: q.question,
      choices: [...q.choices],
      frozenUserIds: [],
      endsAt,
    };
  } else if (ctype === 'chat') {
    room.state.challenge = {
      type: 'chat',
      phrase: pickPhrase(seed),
      endsAt,
    };
  } else {
    room.state.challenge = {
      type: 'likes',
      likesTarget: LIKES_TARGET,
      likeProgress: {},
      endsAt,
    };
  }
  room.state.phase = 'challenge';
  room.version += 1;
}

function enterChoosing(room: FrenemiesRoom, userId: string, displayName: string): void {
  room.state.phase = 'choosing';
  room.state.chooserUserId = userId;
  room.state.chooserDisplayName = displayName;
  room.state.chooseEndsAt = new Date(Date.now() + CHOOSE_MS).toISOString();
  room.state.challenge = null;
  room.state.challengeCorrectIndex = null;
  room.version += 1;
}

async function afterChooserReady(room: FrenemiesRoom, userId: string, displayName: string): Promise<void> {
  const occ = await liveOccupants(room.sessionId);
  const throwable = occ.filter((o) => o.userId !== userId);
  if (throwable.length === 0) {
    // No one to throw — grant coins and next spin.
    await grantHouseCoins(userId, room.state.roundId, 'Frenemies empty-box win (no guests to throw)');
    room.state.lastResult = {
      kind: 'solo_win',
      text: `${displayName} wins 25 HOUSE coins — no guests to throw!`,
      coinUserId: userId,
      coins: HOUSE_COINS,
    };
    room.state.phase = 'resolving';
    room.version += 1;
    // Brief pause then next spin handled in tick.
    room.state.chooseEndsAt = new Date(Date.now() + 2500).toISOString();
    return;
  }
  enterChoosing(room, userId, displayName);
}

async function onChooseTimeout(room: FrenemiesRoom): Promise<void> {
  const chooser = room.state.chooserUserId;
  if (!chooser) {
    beginSpin(room);
    return;
  }
  await forceKick(room.sessionId, chooser);
  room.state.lastResult = {
    kind: 'timeout_kick',
    text: `${room.state.chooserDisplayName || 'Chooser'} ran out of time — thrown out with no coins.`,
    kickedUserId: chooser,
  };
  room.state.phase = 'resolving';
  room.state.chooseEndsAt = new Date(Date.now() + 2500).toISOString();
  room.version += 1;
}

async function onChallengeTimeout(room: FrenemiesRoom): Promise<void> {
  room.state.lastResult = {
    kind: 'challenge_timeout',
    text: 'Nobody won the empty-box challenge — spinning again.',
  };
  room.state.phase = 'resolving';
  room.state.challenge = null;
  room.state.chooseEndsAt = new Date(Date.now() + 2500).toISOString();
  room.version += 1;
}

async function tickOnce(sessionId: string) {
  await withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room || !room.state.active || room.state.phase === 'ended' || room.state.phase === 'idle') {
      stopTicks(sessionId);
      return;
    }

    const now = Date.now();
    let emitType: 'PHASE' | 'SNAPSHOT' | 'RESULT' = 'SNAPSHOT';
    const prevPhase = room.state.phase;

    if (room.state.phase === 'spinning' && room.state.spinEndsAt) {
      if (now >= Date.parse(room.state.spinEndsAt)) {
        await resolveSpinLand(room);
        emitType = 'PHASE';
      }
    } else if (room.state.phase === 'choosing' && room.state.chooseEndsAt) {
      if (now >= Date.parse(room.state.chooseEndsAt)) {
        await onChooseTimeout(room);
        emitType = 'RESULT';
      }
    } else if (room.state.phase === 'challenge' && room.state.challenge?.endsAt) {
      if (now >= Date.parse(room.state.challenge.endsAt)) {
        await onChallengeTimeout(room);
        emitType = 'RESULT';
      }
    } else if (room.state.phase === 'resolving' && room.state.chooseEndsAt) {
      if (now >= Date.parse(room.state.chooseEndsAt)) {
        beginSpin(room);
        emitType = 'PHASE';
      }
    }

    await saveRoom(room);
    if (emitType !== 'SNAPSHOT' || room.state.phase !== prevPhase || room.version % 4 === 0) {
      emitFrenemiesGameEvent(sessionId, publicEvent(room, emitType));
    }
  });
}

export async function getRoom(sessionId: string): Promise<FrenemiesRoom | null> {
  return loadRoom(sessionId);
}

export async function resumeTicksIfNeeded(sessionId: string): Promise<void> {
  const room = await loadRoom(sessionId);
  if (room?.state?.active && room.state.phase !== 'ended' && room.state.phase !== 'idle') {
    ensureTicks(sessionId);
  }
}

export async function startGame(args: {
  sessionId: string;
  hostUserId: string;
  starterUserId: string;
}): Promise<FrenemiesRoom> {
  const { sessionId, hostUserId, starterUserId } = args;
  if (!isFrenemiesAdmin(starterUserId)) {
    const err: any = new Error('NOT_ADMIN');
    err.code = 'NOT_ADMIN';
    throw err;
  }

  return withLock(sessionId, async () => {
    let room = await loadRoom(sessionId);
    if (room && room.state.active && room.state.phase !== 'ended') {
      ensureTicks(sessionId);
      return room;
    }

    room = {
      sessionId,
      hostUserId,
      startedByUserId: starterUserId,
      state: {
        phase: 'idle',
        roundId: '',
        roundIndex: 0,
        spinStartedAt: null,
        spinEndsAt: null,
        targetSlot: null,
        landedSlot: null,
        landedOccupied: false,
        chooserUserId: null,
        chooserDisplayName: null,
        chooseEndsAt: null,
        challenge: null,
        challengeCorrectIndex: null,
        lastResult: null,
        active: true,
      },
      version: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    beginSpin(room);
    await saveRoom(room);
    ensureTicks(sessionId);
    emitFrenemiesGameEvent(sessionId, publicEvent(room, 'PHASE'));
    return room;
  });
}

export async function endGame(args: {
  sessionId: string;
  userId: string;
}): Promise<FrenemiesRoom | null> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room) return null;
    if (!isFrenemiesAdmin(args.userId) && room.hostUserId !== args.userId && room.startedByUserId !== args.userId) {
      const err: any = new Error('NOT_ADMIN');
      err.code = 'NOT_ADMIN';
      throw err;
    }
    room.state.phase = 'ended';
    room.state.active = false;
    room.version += 1;
    await saveRoom(room);
    stopTicks(args.sessionId);
    emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'ENDED'));
    return room;
  });
}

export async function throwGuest(args: {
  sessionId: string;
  chooserUserId: string;
  targetUserId: string;
}): Promise<FrenemiesRoom> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || !room.state.active) {
      const err: any = new Error('GAME_NOT_FOUND');
      err.code = 'GAME_NOT_FOUND';
      throw err;
    }
    if (room.state.phase !== 'choosing') {
      const err: any = new Error('NOT_CHOOSING');
      err.code = 'NOT_CHOOSING';
      throw err;
    }
    if (room.state.chooserUserId !== args.chooserUserId) {
      const err: any = new Error('NOT_CHOOSER');
      err.code = 'NOT_CHOOSER';
      throw err;
    }
    if (args.targetUserId === args.chooserUserId) {
      const err: any = new Error('BAD_TARGET');
      err.code = 'BAD_TARGET';
      throw err;
    }

    const occ = await liveOccupants(args.sessionId);
    const target = occ.find((o) => o.userId === args.targetUserId);
    if (!target) {
      const err: any = new Error('TARGET_NOT_ON_STAGE');
      err.code = 'TARGET_NOT_ON_STAGE';
      throw err;
    }

    await forceKick(args.sessionId, args.targetUserId);
    await grantHouseCoins(
      args.chooserUserId,
      room.state.roundId,
      'Frenemies throw reward',
    );

    room.state.lastResult = {
      kind: 'throw',
      text: `${room.state.chooserDisplayName || 'Chooser'} threw out Box ${target.slotIndex} and earned 25 HOUSE coins!`,
      kickedUserId: args.targetUserId,
      coinUserId: args.chooserUserId,
      coins: HOUSE_COINS,
    };
    room.state.phase = 'resolving';
    room.state.chooseEndsAt = new Date(Date.now() + 2500).toISOString();
    room.version += 1;
    await saveRoom(room);
    emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'RESULT'));
    return room;
  });
}

export async function submitQuizAnswer(args: {
  sessionId: string;
  userId: string;
  displayName?: string;
  choiceIndex: number;
}): Promise<FrenemiesRoom> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || room.state.phase !== 'challenge' || room.state.challenge?.type !== 'quiz') {
      const err: any = new Error('NO_QUIZ');
      err.code = 'NO_QUIZ';
      throw err;
    }
    const frozen = room.state.challenge.frozenUserIds || [];
    if (frozen.includes(args.userId)) {
      const err: any = new Error('FROZEN');
      err.code = 'FROZEN';
      throw err;
    }
    const correct = room.state.challengeCorrectIndex;
    if (args.choiceIndex !== correct) {
      room.state.challenge.frozenUserIds = [...frozen, args.userId];
      room.version += 1;
      await saveRoom(room);
      emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'SNAPSHOT'));
      return room;
    }

    const name = args.displayName || 'Winner';
    await afterChooserReady(room, args.userId, name);
    await saveRoom(room);
    emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'PHASE'));
    return room;
  });
}

export async function submitChatPhrase(args: {
  sessionId: string;
  userId: string;
  displayName?: string;
  text: string;
}): Promise<FrenemiesRoom | null> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || room.state.phase !== 'challenge' || room.state.challenge?.type !== 'chat') {
      return room;
    }
    const phrase = String(room.state.challenge.phrase || '')
      .trim()
      .toLowerCase();
    const text = String(args.text || '')
      .trim()
      .toLowerCase();
    if (!phrase || !text.includes(phrase)) {
      return room;
    }
    const name = args.displayName || 'Winner';
    await afterChooserReady(room, args.userId, name);
    await saveRoom(room);
    emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'PHASE'));
    return room;
  });
}

export async function reportLikes(args: {
  sessionId: string;
  userId: string;
  displayName?: string;
  count?: number;
}): Promise<FrenemiesRoom | null> {
  const add = Math.max(1, Math.min(20, Number(args.count) || 1));
  // Always record session engagement.
  await bumpEngagement(args.sessionId, args.userId, { likes: add });

  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || room.state.phase !== 'challenge' || room.state.challenge?.type !== 'likes') {
      return room;
    }
    const progress = { ...(room.state.challenge.likeProgress || {}) };
    progress[args.userId] = (progress[args.userId] || 0) + add;
    room.state.challenge.likeProgress = progress;
    room.version += 1;

    const target = room.state.challenge.likesTarget || LIKES_TARGET;
    if (progress[args.userId] >= target) {
      const name = args.displayName || 'Winner';
      await afterChooserReady(room, args.userId, name);
      await saveRoom(room);
      emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'PHASE'));
      return room;
    }

    await saveRoom(room);
    emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'SNAPSHOT'));
    return room;
  });
}

// ── Session engagement tallies (Guest Control sheet + Frenemies likes) ──

export async function bumpEngagement(
  sessionId: string,
  userId: string,
  delta: Partial<SessionEngagement>,
): Promise<SessionEngagement> {
  const key = engageKey(sessionId);
  const field = userId;
  const raw = await redis().hget(key, field);
  let cur: SessionEngagement = { likes: 0, shares: 0, comments: 0, coinsSpent: 0, coinsReceived: 0 };
  if (raw) {
    try {
      cur = { ...cur, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
  }
  cur.likes += Number(delta.likes) || 0;
  cur.shares += Number(delta.shares) || 0;
  cur.comments += Number(delta.comments) || 0;
  cur.coinsSpent += Number(delta.coinsSpent) || 0;
  cur.coinsReceived += Number(delta.coinsReceived) || 0;
  await redis().hset(key, field, JSON.stringify(cur));
  await redis().expire(key, TTL_SECONDS);
  return cur;
}

export async function getSessionEngagement(sessionId: string): Promise<Record<string, SessionEngagement>> {
  const raw = await redis().hgetall(engageKey(sessionId));
  const out: Record<string, SessionEngagement> = {};
  for (const [uid, v] of Object.entries(raw || {})) {
    try {
      out[uid] = { likes: 0, shares: 0, comments: 0, coinsSpent: 0, coinsReceived: 0, ...JSON.parse(v) };
    } catch {
      // skip
    }
  }
  return out;
}

export { loadRoom };
