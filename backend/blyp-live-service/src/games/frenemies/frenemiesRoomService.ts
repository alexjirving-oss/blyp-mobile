/**
 * Frenemies — server-authoritative host-conducted live party game (EA v1).
 * Ready → host Spin → land → challenge|throw → result → Ready (auto-continue OFF).
 */
import { randomUUID, createHash } from 'crypto';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import { listGuests, leaveGuestSession } from '../../live/guestSlotStore';
import { MAX_GUEST_SLOTS } from '../../live/guestSlotAllocator';
import { emitFrenemiesGameEvent, emitRoomEvent } from '../../realtime/realtimeBus';
import { BOOTSTRAP_STAFF_ROLES } from '../../admin/adminRbac';
import { getAdminEnv } from '../../config/adminEnv';
import { pickQuiz, pickPhrase } from './questions';
import { EconomyError } from '../../economy/economyErrors';
import {
  getSpendableCoins,
  holdHostPrize,
  releaseHostHold,
  settlePrizeAward,
  type PrizeHold,
} from './frenemiesEconomy';
import {
  SPIN_OPTIONS_MS,
  DEFAULT_SPIN_MS,
  DEFAULT_CHOOSE_MS,
  DEFAULT_CHALLENGE_MS,
  DEFAULT_RESULT_MS,
  DEFAULT_COINS,
  DEFAULT_LIKES,
  MAX_COINS,
  defaultSettings,
  maxPrizeForSettings,
  nearestSpinMs,
  type FrenemiesSettings,
} from './frenemiesSettings';

const TTL_SECONDS = 60 * 60 * 2;
const stateKey = (sessionId: string) => `frenemies:game:${sessionId}`;
const lockKey = (sessionId: string) => `frenemies:lock:${sessionId}`;
const engageKey = (sessionId: string) => `frenemies:engage:${sessionId}`;

export { defaultSettings, maxPrizeForSettings, type FrenemiesSettings };

export type FrenemiesPhase =
  | 'idle'
  | 'ready'
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
  question?: string;
  choices?: string[];
  phrase?: string;
  likesTarget?: number;
  likeProgress?: Record<string, number>;
  frozenUserIds?: string[];
  endsAt: string;
}

export interface SessionStats {
  rounds: number;
  throws: number;
  challengeWins: number;
  coinsAwarded: number;
  coinsSpentByHost: number;
  topWinners: { userId: string; displayName: string; coins: number }[];
}

export interface FrenemiesState {
  phase: FrenemiesPhase;
  roundId: string;
  roundIndex: number;
  spinStartedAt: string | null;
  spinEndsAt: string | null;
  targetSlot: number | null;
  landedSlot: number | null;
  landedOccupied: boolean;
  chooserUserId: string | null;
  chooserDisplayName: string | null;
  chooseEndsAt: string | null;
  challenge: ChallengePublic | null;
  challengeCorrectIndex?: number | null;
  lastResult: {
    kind: string;
    text: string;
    kickedUserId?: string | null;
    coinUserId?: string | null;
    coins?: number;
    payer?: 'host' | 'house' | null;
  } | null;
  active: boolean;
  /** After result, auto-spin at this time when autoContinue ON. */
  nextSpinAt: string | null;
  prizeHold: PrizeHold | null;
  prizePreview: number;
  payer: 'host' | 'house';
}

export interface FrenemiesRoom {
  sessionId: string;
  hostUserId: string;
  startedByUserId: string;
  settings: FrenemiesSettings;
  stats: SessionStats;
  winnerCoins: Record<string, { displayName: string; coins: number }>;
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

function emptyStats(): SessionStats {
  return {
    rounds: 0,
    throws: 0,
    challengeWins: 0,
    coinsAwarded: 0,
    coinsSpentByHost: 0,
    topWinners: [],
  };
}

function payerFor(room: FrenemiesRoom): 'host' | 'house' {
  return room.settings.housePays ? 'house' : 'host';
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
    const room = JSON.parse(raw) as FrenemiesRoom;
    if (!room.settings) room.settings = defaultSettings();
    else room.settings = defaultSettings(room.settings);
    if (!room.stats) room.stats = emptyStats();
    if (!room.winnerCoins) room.winnerCoins = {};
    if (!room.state.prizeHold) room.state.prizeHold = null;
    if (room.state.nextSpinAt === undefined) room.state.nextSpinAt = null;
    if (!room.state.payer) room.state.payer = payerFor(room);
    if (typeof room.state.prizePreview !== 'number') {
      room.state.prizePreview = maxPrizeForSettings(room.settings);
    }
    // Migrate legacy idle+active auto-loop rooms.
    if (room.state.active && room.state.phase === 'idle') {
      room.state.phase = 'ready';
    }
    return room;
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
  // Never expose debit breakdown details beyond amount/payer.
  if (copy.prizeHold) {
    copy.prizeHold = {
      amount: copy.prizeHold.amount,
      roundId: copy.prizeHold.roundId,
      paidBy: copy.prizeHold.paidBy,
      hostUserId: copy.prizeHold.hostUserId,
      coinDebited: 0,
      bonusDebited: 0,
    };
  }
  return copy;
}

function buildTopWinners(room: FrenemiesRoom): SessionStats['topWinners'] {
  return Object.entries(room.winnerCoins || {})
    .map(([userId, v]) => ({
      userId,
      displayName: v.displayName || 'Winner',
      coins: v.coins || 0,
    }))
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 5);
}

export function publicEvent(
  room: FrenemiesRoom,
  type: 'PHASE' | 'SNAPSHOT' | 'RESULT' | 'ENDED' = 'SNAPSHOT',
) {
  const s = room.settings;
  const stats = { ...room.stats, topWinners: buildTopWinners(room) };
  return {
    game: 'frenemies' as const,
    sessionId: room.sessionId,
    type,
    version: room.version,
    hostUserId: room.hostUserId,
    startedByUserId: room.startedByUserId,
    state: stripPrivate(room.state),
    settings: { ...s },
    stats,
    spinMs: s.spinMs,
    chooseMs: s.chooseMs,
    challengeMs: s.challengeMs,
    resultMs: s.resultMs,
    houseCoins: s.throwCoins,
    throwCoins: s.throwCoins,
    soloCoins: s.soloCoins,
    maxSlots: MAX_GUEST_SLOTS,
    maxCoins: MAX_COINS,
    spinOptionsMs: [...SPIN_OPTIONS_MS],
    isAdminHost: isFrenemiesAdmin(room.hostUserId) || isFrenemiesAdmin(room.startedByUserId),
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
    .filter(
      (g) =>
        g.state === 'LIVE' &&
        typeof g.slotIndex === 'number' &&
        g.slotIndex >= 1 &&
        g.slotIndex <= MAX_GUEST_SLOTS,
    )
    .map((g) => {
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

function pickTargetSlot(roundId: string): number {
  const seed = hashSeed(roundId);
  return (seed % MAX_GUEST_SLOTS) + 1;
}

function pickChallengeType(room: FrenemiesRoom, roundId: string): ChallengeType {
  const enabled: ChallengeType[] = [];
  if (room.settings.challengeQuiz) enabled.push('quiz');
  if (room.settings.challengeChat) enabled.push('chat');
  if (room.settings.challengeLikes) enabled.push('likes');
  if (enabled.length === 0) enabled.push('quiz', 'chat', 'likes');
  return enabled[hashSeed(`${roundId}:ch`) % enabled.length];
}

async function forceKick(sessionId: string, guestUserId: string): Promise<void> {
  try {
    await leaveGuestSession(sessionId, guestUserId, nowIso(), { force: true });
    emitRoomEvent(sessionId, { type: 'guest.kicked', guestUserId });
  } catch (e: any) {
    logger.warn({ sessionId, guestUserId, err: e?.message }, '[frenemies] forceKick failed');
  }
}

function recordWin(room: FrenemiesRoom, userId: string, displayName: string, coins: number) {
  if (coins <= 0) return;
  const prev = room.winnerCoins[userId] || { displayName, coins: 0 };
  room.winnerCoins[userId] = {
    displayName: displayName || prev.displayName,
    coins: prev.coins + coins,
  };
  room.stats.coinsAwarded += coins;
}

function enterReady(room: FrenemiesRoom): void {
  room.state.phase = 'ready';
  room.state.spinStartedAt = null;
  room.state.spinEndsAt = null;
  room.state.targetSlot = null;
  room.state.landedSlot = null;
  room.state.landedOccupied = false;
  room.state.chooserUserId = null;
  room.state.chooserDisplayName = null;
  room.state.chooseEndsAt = null;
  room.state.challenge = null;
  room.state.challengeCorrectIndex = null;
  room.state.nextSpinAt = null;
  room.state.prizeHold = null;
  room.state.prizePreview = maxPrizeForSettings(room.settings);
  room.state.payer = payerFor(room);
  room.state.active = true;
  room.version += 1;
}

async function beginSpin(room: FrenemiesRoom): Promise<void> {
  const roundId = randomUUID();
  const now = Date.now();
  const spinMs = room.settings.spinMs;
  const maxPrize = maxPrizeForSettings(room.settings);
  const payer = payerFor(room);

  let hold: PrizeHold | null = null;
  if (payer === 'host' && maxPrize > 0) {
    hold = await holdHostPrize({
      hostUserId: room.hostUserId,
      amount: maxPrize,
      roundId,
      sessionId: room.sessionId,
    });
    room.stats.coinsSpentByHost += maxPrize;
  } else if (payer === 'house') {
    hold = {
      amount: maxPrize,
      roundId,
      paidBy: 'house',
      hostUserId: room.hostUserId,
      coinDebited: 0,
      bonusDebited: 0,
    };
  }

  room.state = {
    phase: 'spinning',
    roundId,
    roundIndex: (room.state.roundIndex || 0) + 1,
    spinStartedAt: new Date(now).toISOString(),
    spinEndsAt: new Date(now + spinMs).toISOString(),
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
    nextSpinAt: null,
    prizeHold: hold,
    prizePreview: maxPrize,
    payer,
  };
  room.stats.rounds += 1;
  room.version += 1;
}

async function awardAndResolve(
  room: FrenemiesRoom,
  args: {
    kind: string;
    text: string;
    winnerUserId?: string | null;
    winnerName?: string | null;
    awardAmount: number;
    kickedUserId?: string | null;
  },
): Promise<void> {
  let coins = 0;
  let payer: 'host' | 'house' | null = room.state.payer || payerFor(room);
  if (args.winnerUserId && args.awardAmount > 0) {
    try {
      const settled = await settlePrizeAward({
        hold: room.state.prizeHold,
        winnerUserId: args.winnerUserId,
        awardAmount: args.awardAmount,
        roundId: room.state.roundId,
        reason: args.text,
      });
      coins = settled.coins;
      payer = settled.payer;
      recordWin(room, args.winnerUserId, args.winnerName || 'Winner', coins);
    } catch (e: any) {
      logger.error({ err: e?.message }, '[frenemies] settle failed');
      room.state.lastResult = {
        kind: 'award_failed',
        text: 'Prize could not be paid — hold released. Sorry!',
        payer,
      };
      room.state.prizeHold = null;
      room.state.phase = 'resolving';
      room.state.chooseEndsAt = new Date(Date.now() + room.settings.resultMs).toISOString();
      room.state.challenge = null;
      room.version += 1;
      return;
    }
  } else {
    await releaseHostHold(room.state.prizeHold, args.kind);
  }

  room.state.prizeHold = null;
  room.state.lastResult = {
    kind: args.kind,
    text: args.text,
    kickedUserId: args.kickedUserId || null,
    coinUserId: args.winnerUserId || null,
    coins,
    payer,
  };
  room.state.phase = 'resolving';
  room.state.challenge = null;
  room.state.challengeCorrectIndex = null;
  room.state.chooseEndsAt = new Date(Date.now() + room.settings.resultMs).toISOString();
  if (room.settings.autoContinue) {
    room.state.nextSpinAt = new Date(
      Date.now() + room.settings.resultMs + room.settings.autoContinueDelayMs,
    ).toISOString();
  } else {
    room.state.nextSpinAt = null;
  }
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
    enterChoosing(room, atSlot.userId, atSlot.displayName);
    return;
  }

  const ctype = pickChallengeType(room, room.state.roundId);
  const endsAt = new Date(Date.now() + room.settings.challengeMs).toISOString();
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
      likesTarget: room.settings.likesTarget,
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
  room.state.chooseEndsAt = new Date(Date.now() + room.settings.chooseMs).toISOString();
  room.state.challenge = null;
  room.state.challengeCorrectIndex = null;
  room.version += 1;
}

async function afterChooserReady(room: FrenemiesRoom, userId: string, displayName: string): Promise<void> {
  room.stats.challengeWins += 1;
  const occ = await liveOccupants(room.sessionId);
  const throwable = occ.filter((o) => o.userId !== userId);
  if (throwable.length === 0) {
    const amount = room.settings.soloCoins;
    await awardAndResolve(room, {
      kind: 'solo_win',
      text: `${displayName} wins ${amount} coins — no guests to throw!`,
      winnerUserId: userId,
      winnerName: displayName,
      awardAmount: amount,
    });
    return;
  }
  enterChoosing(room, userId, displayName);
}

async function onChooseTimeout(room: FrenemiesRoom): Promise<void> {
  const chooser = room.state.chooserUserId;
  if (!chooser) {
    await releaseHostHold(room.state.prizeHold, 'no_chooser');
    room.state.prizeHold = null;
    enterReady(room);
    return;
  }
  await forceKick(room.sessionId, chooser);
  await awardAndResolve(room, {
    kind: 'timeout_kick',
    text: `${room.state.chooserDisplayName || 'Chooser'} ran out of time — thrown out with no coins.`,
    kickedUserId: chooser,
    awardAmount: 0,
  });
}

async function onChallengeTimeout(room: FrenemiesRoom): Promise<void> {
  await awardAndResolve(room, {
    kind: 'challenge_timeout',
    text: 'Nobody won the empty-box challenge.',
    awardAmount: 0,
  });
}

async function finishResolving(room: FrenemiesRoom): Promise<void> {
  if (room.settings.autoContinue) {
    const nextAt = room.state.nextSpinAt ? Date.parse(room.state.nextSpinAt) : 0;
    if (nextAt && Date.now() < nextAt) {
      return;
    }
    try {
      await beginSpin(room);
    } catch (e: any) {
      if (e instanceof EconomyError && e.code === 'INSUFFICIENT_FUNDS') {
        room.state.lastResult = {
          kind: 'insufficient_funds',
          text: `Need ${maxPrizeForSettings(room.settings)} coins to cover prizes — top up to keep spinning.`,
          payer: 'host',
        };
        enterReady(room);
        return;
      }
      throw e;
    }
    return;
  }
  // Clear result banner when returning to Ready; keep stats.
  const last = room.state.lastResult;
  enterReady(room);
  room.state.lastResult = last;
}

async function tickOnce(sessionId: string) {
  await withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room || !room.state.active || room.state.phase === 'ended' || room.state.phase === 'idle') {
      stopTicks(sessionId);
      return;
    }

    // Ready with no auto-continue: no timed work — stop ticking until host spins.
    if (room.state.phase === 'ready' && !room.settings.autoContinue) {
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
        if (room.settings.autoContinue && room.state.nextSpinAt && now < Date.parse(room.state.nextSpinAt)) {
          // Wait for auto delay — keep resolving visual.
        } else {
          await finishResolving(room);
          emitType = 'PHASE';
        }
      } else if (
        room.settings.autoContinue &&
        room.state.nextSpinAt &&
        now >= Date.parse(room.state.chooseEndsAt) &&
        now >= Date.parse(room.state.nextSpinAt)
      ) {
        await finishResolving(room);
        emitType = 'PHASE';
      }
    } else if (room.state.phase === 'ready' && room.settings.autoContinue && room.state.nextSpinAt) {
      if (now >= Date.parse(room.state.nextSpinAt)) {
        try {
          await beginSpin(room);
          emitType = 'PHASE';
        } catch (e: any) {
          if (e instanceof EconomyError && e.code === 'INSUFFICIENT_FUNDS') {
            room.state.lastResult = {
              kind: 'insufficient_funds',
              text: `Need ${maxPrizeForSettings(room.settings)} coins to cover prizes.`,
              payer: 'host',
            };
            emitType = 'RESULT';
          } else {
            throw e;
          }
        }
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
  if (!room?.state?.active || room.state.phase === 'ended' || room.state.phase === 'idle') return;
  if (room.state.phase === 'ready' && !room.settings.autoContinue) return;
  ensureTicks(sessionId);
}

export async function startGame(args: {
  sessionId: string;
  hostUserId: string;
  starterUserId: string;
}): Promise<FrenemiesRoom> {
  const { sessionId, hostUserId, starterUserId } = args;
  if (starterUserId !== hostUserId && !isFrenemiesAdmin(starterUserId)) {
    const err: any = new Error('NOT_HOST');
    err.code = 'NOT_HOST';
    throw err;
  }

  return withLock(sessionId, async () => {
    let room = await loadRoom(sessionId);
    if (room && room.state.active && room.state.phase !== 'ended') {
      resumeTicksIfNeeded(sessionId);
      return room;
    }

    const settings = defaultSettings();
    // Non-admins cannot start with house pays.
    if (!isFrenemiesAdmin(starterUserId) && !isFrenemiesAdmin(hostUserId)) {
      settings.housePays = false;
    }

    room = {
      sessionId,
      hostUserId,
      startedByUserId: starterUserId,
      settings,
      stats: emptyStats(),
      winnerCoins: {},
      state: {
        phase: 'ready',
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
        nextSpinAt: null,
        prizeHold: null,
        prizePreview: maxPrizeForSettings(settings),
        payer: settings.housePays ? 'house' : 'host',
      },
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await saveRoom(room);
    emitFrenemiesGameEvent(sessionId, publicEvent(room, 'PHASE'));
    return room;
  });
}

export async function spinRound(args: {
  sessionId: string;
  userId: string;
}): Promise<FrenemiesRoom> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || !room.state.active) {
      const err: any = new Error('GAME_NOT_FOUND');
      err.code = 'GAME_NOT_FOUND';
      throw err;
    }
    if (room.hostUserId !== args.userId && !isFrenemiesAdmin(args.userId)) {
      const err: any = new Error('NOT_HOST');
      err.code = 'NOT_HOST';
      throw err;
    }
    if (room.state.phase !== 'ready' && room.state.phase !== 'idle') {
      const err: any = new Error('NOT_READY');
      err.code = 'NOT_READY';
      throw err;
    }

    const maxPrize = maxPrizeForSettings(room.settings);
    if (!room.settings.housePays && maxPrize > 0) {
      const bal = await getSpendableCoins(room.hostUserId);
      if (bal < maxPrize) {
        const err: any = new Error('INSUFFICIENT_FUNDS');
        err.code = 'INSUFFICIENT_FUNDS';
        err.needed = maxPrize;
        err.balance = bal;
        throw err;
      }
    }

    try {
      await beginSpin(room);
    } catch (e: any) {
      if (e instanceof EconomyError && e.code === 'INSUFFICIENT_FUNDS') {
        const err: any = new Error('INSUFFICIENT_FUNDS');
        err.code = 'INSUFFICIENT_FUNDS';
        err.needed = maxPrize;
        throw err;
      }
      throw e;
    }

    await saveRoom(room);
    ensureTicks(args.sessionId);
    emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'PHASE'));
    return room;
  });
}

export async function updateSettings(args: {
  sessionId: string;
  userId: string;
  patch: Partial<FrenemiesSettings>;
}): Promise<FrenemiesRoom> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || !room.state.active) {
      const err: any = new Error('GAME_NOT_FOUND');
      err.code = 'GAME_NOT_FOUND';
      throw err;
    }
    if (room.hostUserId !== args.userId && !isFrenemiesAdmin(args.userId)) {
      const err: any = new Error('NOT_HOST');
      err.code = 'NOT_HOST';
      throw err;
    }
    // Fairness: settings mutable only on Ready / Between (ready).
    if (room.state.phase !== 'ready' && room.state.phase !== 'idle') {
      const err: any = new Error('SETTINGS_LOCKED');
      err.code = 'SETTINGS_LOCKED';
      throw err;
    }

    const patch = { ...args.patch };
    if (patch.spinMs != null) patch.spinMs = nearestSpinMs(Number(patch.spinMs));
    if (patch.housePays != null) {
      if (!isFrenemiesAdmin(args.userId)) {
        delete patch.housePays;
      }
    }

    room.settings = defaultSettings({ ...room.settings, ...patch });
    if (!isFrenemiesAdmin(args.userId) && !isFrenemiesAdmin(room.hostUserId)) {
      room.settings.housePays = false;
    }
    room.state.prizePreview = maxPrizeForSettings(room.settings);
    room.state.payer = payerFor(room);
    room.version += 1;
    await saveRoom(room);
    emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'SNAPSHOT'));
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
    if (
      !isFrenemiesAdmin(args.userId) &&
      room.hostUserId !== args.userId &&
      room.startedByUserId !== args.userId
    ) {
      const err: any = new Error('NOT_ADMIN');
      err.code = 'NOT_ADMIN';
      throw err;
    }
    await releaseHostHold(room.state.prizeHold, 'game_ended');
    room.state.prizeHold = null;
    room.state.phase = 'ended';
    room.state.active = false;
    room.stats.topWinners = buildTopWinners(room);
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
    const amount = room.settings.throwCoins;
    room.stats.throws += 1;
    await awardAndResolve(room, {
      kind: 'throw',
      text: `${room.state.chooserDisplayName || 'Chooser'} threw out Box ${target.slotIndex} and earned ${amount} coins!`,
      winnerUserId: args.chooserUserId,
      winnerName: room.state.chooserDisplayName || 'Chooser',
      awardAmount: amount,
      kickedUserId: args.targetUserId,
    });
    await saveRoom(room);
    ensureTicks(args.sessionId);
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
    ensureTicks(args.sessionId);
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
    ensureTicks(args.sessionId);
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

    const target = room.state.challenge.likesTarget || room.settings.likesTarget;
    if (progress[args.userId] >= target) {
      const name = args.displayName || 'Winner';
      await afterChooserReady(room, args.userId, name);
      await saveRoom(room);
      ensureTicks(args.sessionId);
      emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'PHASE'));
      return room;
    }

    await saveRoom(room);
    emitFrenemiesGameEvent(args.sessionId, publicEvent(room, 'SNAPSHOT'));
    return room;
  });
}

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

/** Host balance preview for Ready plate. */
export async function getHostPrizePreview(sessionId: string): Promise<{
  balance: number;
  needed: number;
  canSpin: boolean;
  payer: 'host' | 'house';
}> {
  const room = await loadRoom(sessionId);
  if (!room) {
    return { balance: 0, needed: 0, canSpin: false, payer: 'host' };
  }
  const needed = maxPrizeForSettings(room.settings);
  const payer = payerFor(room);
  if (payer === 'house') {
    return { balance: 0, needed, canSpin: true, payer };
  }
  const balance = await getSpendableCoins(room.hostUserId);
  return { balance, needed, canSpin: balance >= needed || needed === 0, payer };
}

// Back-compat exports used by older imports / ops docs.
export const SPIN_MS = DEFAULT_SPIN_MS;
export const CHOOSE_MS = DEFAULT_CHOOSE_MS;
export const CHALLENGE_MS = DEFAULT_CHALLENGE_MS;
export const RESULT_DISPLAY_MS = DEFAULT_RESULT_MS;
export const HOUSE_COINS = DEFAULT_COINS;
export const LIKES_TARGET = DEFAULT_LIKES;

export { loadRoom };
