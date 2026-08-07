import { randomUUID } from 'crypto';
import { getEconomyInfra } from '../../economy/infra';
import { logger } from '../../config/logger';
import { listGuests } from '../../live/guestSlotStore';
import { safeLiveDisplayName } from '../../live/liveDisplayName';
import { emitReactionDuelEvent } from '../../realtime/realtimeBus';
import {
  REACTION_DUEL_ENTRY_COINS,
  REACTION_DUEL_MAX_ROUNDS,
  REACTION_DUEL_PRIZE_COINS,
  REACTION_DUEL_WIN_SCORE,
  type ReactionPrompt,
  createReactionPrompt,
  decideReactionDuelMatch,
  evaluateReactionTap,
} from './reactionDuelEngine';
import {
  awardReactionDuelPrize,
  lockReactionDuelEntry,
  refundReactionDuelEntries,
} from './reactionDuelEconomy';

const TTL_SECONDS = 60 * 60 * 2;
const stateKey = (sessionId: string) => `reaction-duel:game:${sessionId}`;
const lockKey = (sessionId: string) => `reaction-duel:lock:${sessionId}`;
const TICK_MS = 100;

export const PROMPT_LEAD_MS = Math.max(
  700,
  Number(process.env.REACTION_DUEL_PROMPT_LEAD_MS || 1_200) || 1_200,
);
export const PROMPT_WINDOW_MS = Math.max(
  1_200,
  Number(process.env.REACTION_DUEL_PROMPT_WINDOW_MS || 3_000) || 3_000,
);
export const ROUND_RESULT_MS = Math.max(
  800,
  Number(process.env.REACTION_DUEL_ROUND_RESULT_MS || 1_500) || 1_500,
);
export const DISCONNECT_TIMEOUT_MS = Math.max(
  8_000,
  Number(process.env.REACTION_DUEL_DISCONNECT_MS || 20_000) || 20_000,
);

export type ReactionDuelPhase =
  | 'lobby'
  | 'prompt'
  | 'round_result'
  | 'ended'
  | 'refunded';

export interface ReactionDuelPlayer {
  userId: string;
  displayName: string;
  role: 'host' | 'guest';
  locked: boolean;
  score: number;
  lastSeenAt: string;
}

export interface ReactionDuelLastRound {
  roundNumber: number;
  winnerUserId: string | null;
  winnerDisplayName: string | null;
  reactionMs: number | null;
  text: string;
}

export interface ReactionDuelState {
  duelId: string;
  phase: ReactionDuelPhase;
  active: boolean;
  players: [ReactionDuelPlayer, ReactionDuelPlayer];
  roundNumber: number;
  prompt: ReactionPrompt | null;
  lastRound: ReactionDuelLastRound | null;
  nextRoundAt: string | null;
  winnerUserId: string | null;
  winnerDisplayName: string | null;
  endReason: string | null;
  endedAt: string | null;
}

export interface ReactionDuelRoom {
  sessionId: string;
  hostUserId: string;
  startedByUserId: string;
  state: ReactionDuelState;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ReactionDuelEventType =
  | 'PHASE'
  | 'SNAPSHOT'
  | 'LOCK'
  | 'ROUND'
  | 'RESULT'
  | 'ENDED'
  | 'REFUNDED';

const tickHandles = new Map<string, ReturnType<typeof setInterval>>();

function redis() {
  return getEconomyInfra().redis;
}

function nowIso() {
  return new Date().toISOString();
}

function gameError(code: string, message = code): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRoom(sessionId: string): Promise<ReactionDuelRoom | null> {
  const raw = await redis().get(stateKey(sessionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReactionDuelRoom;
  } catch {
    return null;
  }
}

async function saveRoom(room: ReactionDuelRoom): Promise<void> {
  room.updatedAt = nowIso();
  await redis().set(
    stateKey(room.sessionId),
    JSON.stringify(room),
    'EX',
    TTL_SECONDS,
  );
}

async function withLock<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = lockKey(sessionId);
  const token = randomUUID();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const acquired = await redis().set(key, token, 'PX', 15_000, 'NX');
    if (acquired) {
      try {
        return await fn();
      } finally {
        try {
          const current = await redis().get(key);
          if (current === token) await redis().del(key);
        } catch (error: any) {
          logger.warn(
            { sessionId, err: error?.message },
            '[reaction-duel] lock release failed',
          );
        }
      }
    }
    await sleep(40);
  }
  throw gameError('GAME_BUSY');
}

function publicPrompt(prompt: ReactionPrompt | null) {
  if (!prompt) return null;
  return {
    promptId: prompt.promptId,
    roundNumber: prompt.roundNumber,
    cue: prompt.cue,
    targets: prompt.targets,
    visibleAt: prompt.visibleAt,
    endsAt: prompt.endsAt,
  };
}

export function publicEvent(
  room: ReactionDuelRoom,
  type: ReactionDuelEventType = 'SNAPSHOT',
) {
  return {
    game: 'reaction-duel' as const,
    sessionId: room.sessionId,
    type,
    version: room.version,
    serverNow: nowIso(),
    hostUserId: room.hostUserId,
    state: {
      ...room.state,
      players: room.state.players.map((player) => ({
        userId: player.userId,
        displayName: player.displayName,
        role: player.role,
        locked: player.locked,
        score: player.score,
      })),
      prompt: publicPrompt(room.state.prompt),
    },
    rules: {
      entryCoins: REACTION_DUEL_ENTRY_COINS,
      prizeCoins: REACTION_DUEL_PRIZE_COINS,
      maxRounds: REACTION_DUEL_MAX_ROUNDS,
      winScore: REACTION_DUEL_WIN_SCORE,
      promptWindowMs: PROMPT_WINDOW_MS,
      disconnectTimeoutMs: DISCONNECT_TIMEOUT_MS,
      summary:
        'Best of five. First correct server-received tap wins each round; first to three clinches.',
    },
  };
}

function eventTypeAfterMutation(
  room: ReactionDuelRoom,
  fallback: ReactionDuelEventType,
): ReactionDuelEventType {
  const phase = room.state.phase as ReactionDuelPhase;
  if (phase === 'ended') return 'ENDED';
  if (phase === 'refunded') return 'REFUNDED';
  if (phase === 'round_result') return 'ROUND';
  return fallback;
}

function stopTicks(sessionId: string) {
  const handle = tickHandles.get(sessionId);
  if (handle) {
    clearInterval(handle);
    tickHandles.delete(sessionId);
  }
}

function ensureTicks(sessionId: string) {
  if (tickHandles.has(sessionId)) return;
  const handle = setInterval(() => {
    void tickOnce(sessionId).catch((error: any) => {
      logger.warn(
        { sessionId, err: error?.message || String(error) },
        '[reaction-duel] tick failed',
      );
    });
  }, TICK_MS);
  try {
    (handle as any).unref?.();
  } catch {
    // Ignore runtimes without unref.
  }
  tickHandles.set(sessionId, handle);
}

function beginRound(room: ReactionDuelRoom, nowMs = Date.now()) {
  const roundNumber = room.state.roundNumber + 1;
  room.state.roundNumber = roundNumber;
  room.state.phase = 'prompt';
  room.state.prompt = createReactionPrompt({
    roundNumber,
    visibleAtMs: nowMs + PROMPT_LEAD_MS,
    windowMs: PROMPT_WINDOW_MS,
  });
  room.state.lastRound = null;
  room.state.nextRoundAt = null;
}

async function settleRefund(
  room: ReactionDuelRoom,
  reason: string,
  copy: string,
) {
  await refundReactionDuelEntries({
    duelId: room.state.duelId,
    sessionId: room.sessionId,
    reason,
  });
  room.state.phase = 'refunded';
  room.state.active = false;
  room.state.prompt = null;
  room.state.nextRoundAt = null;
  room.state.winnerUserId = null;
  room.state.winnerDisplayName = null;
  room.state.endReason = reason;
  room.state.endedAt = nowIso();
  room.state.lastRound = {
    roundNumber: room.state.roundNumber,
    winnerUserId: null,
    winnerDisplayName: null,
    reactionMs: null,
    text: copy,
  };
  stopTicks(room.sessionId);
}

async function settleWinner(
  room: ReactionDuelRoom,
  winnerUserId: string,
  reason: string,
) {
  const winner = room.state.players.find(
    (player) => player.userId === winnerUserId,
  );
  if (!winner) throw gameError('NOT_PLAYER');
  await awardReactionDuelPrize({
    duelId: room.state.duelId,
    sessionId: room.sessionId,
    winnerUserId,
    reason: `Reaction Duel ${reason}`,
  });
  room.state.phase = 'ended';
  room.state.active = false;
  room.state.prompt = null;
  room.state.nextRoundAt = null;
  room.state.winnerUserId = winner.userId;
  room.state.winnerDisplayName = winner.displayName;
  room.state.endReason = reason;
  room.state.endedAt = nowIso();
  stopTicks(room.sessionId);
}

async function finishRound(
  room: ReactionDuelRoom,
  roundWinnerUserId: string | null,
  reactionMs: number | null,
) {
  const roundWinner = roundWinnerUserId
    ? room.state.players.find((player) => player.userId === roundWinnerUserId)
    : null;
  if (roundWinner) roundWinner.score += 1;

  room.state.lastRound = {
    roundNumber: room.state.roundNumber,
    winnerUserId: roundWinner?.userId || null,
    winnerDisplayName: roundWinner?.displayName || null,
    reactionMs,
    text: roundWinner
      ? `${roundWinner.displayName} wins round ${room.state.roundNumber}${
          reactionMs == null ? '' : ` in ${reactionMs}ms`
        }.`
      : `Round ${room.state.roundNumber} is a draw.`,
  };
  room.state.prompt = null;

  const decision = decideReactionDuelMatch({
    roundNumber: room.state.roundNumber,
    players: room.state.players,
  });
  if (decision.outcome === 'winner') {
    await settleWinner(room, decision.winnerUserId, 'skill_win');
    return;
  }
  if (decision.outcome === 'draw') {
    await settleRefund(
      room,
      'draw',
      'Match drawn after five rounds — both 100-coin entries refunded.',
    );
    return;
  }

  room.state.phase = 'round_result';
  room.state.nextRoundAt = new Date(Date.now() + ROUND_RESULT_MS).toISOString();
}

function playerIsStale(player: ReactionDuelPlayer, nowMs: number): boolean {
  const lastSeenMs = Date.parse(player.lastSeenAt);
  return (
    !Number.isFinite(lastSeenMs) ||
    nowMs - lastSeenMs > DISCONNECT_TIMEOUT_MS
  );
}

async function handlePresenceTimeout(
  room: ReactionDuelRoom,
  nowMs: number,
): Promise<boolean> {
  const stale = room.state.players.filter((player) =>
    playerIsStale(player, nowMs),
  );
  if (stale.length === 0) return false;

  const bothLocked = room.state.players.every((player) => player.locked);
  if (!bothLocked) {
    await settleRefund(
      room,
      'disconnect_before_lock',
      'A player left before both entries locked — every locked entry was refunded.',
    );
    return true;
  }
  if (stale.length === 1) {
    const remaining = room.state.players.find(
      (player) => player.userId !== stale[0].userId,
    );
    if (remaining) {
      await settleWinner(room, remaining.userId, 'disconnect_forfeit');
      room.state.lastRound = {
        roundNumber: room.state.roundNumber,
        winnerUserId: remaining.userId,
        winnerDisplayName: remaining.displayName,
        reactionMs: null,
        text: `${remaining.displayName} wins 300 coins by disconnect forfeit.`,
      };
      return true;
    }
  }

  await settleRefund(
    room,
    'both_disconnected',
    'Both players disconnected — both 100-coin entries refunded.',
  );
  return true;
}

async function tickOnce(sessionId: string) {
  await withLock(sessionId, async () => {
    const room = await loadRoom(sessionId);
    if (!room || !room.state.active) {
      stopTicks(sessionId);
      return;
    }

    const nowMs = Date.now();
    let type: ReactionDuelEventType | null = null;
    if (await handlePresenceTimeout(room, nowMs)) {
      type = room.state.phase === 'ended' ? 'ENDED' : 'REFUNDED';
    } else if (
      room.state.phase === 'prompt' &&
      room.state.prompt &&
      nowMs > Date.parse(room.state.prompt.endsAt)
    ) {
      await finishRound(room, null, null);
      type = eventTypeAfterMutation(room, 'ROUND');
    } else if (
      room.state.phase === 'round_result' &&
      room.state.nextRoundAt &&
      nowMs >= Date.parse(room.state.nextRoundAt)
    ) {
      beginRound(room, nowMs);
      type = 'PHASE';
    }

    if (!type) return;
    room.version += 1;
    await saveRoom(room);
    emitReactionDuelEvent(sessionId, publicEvent(room, type));
  });
}

export async function startDuel(args: {
  sessionId: string;
  hostUserId: string;
  starterUserId: string;
  opponentUserId: string;
  hostDisplayName?: string;
  opponentDisplayName?: string;
}): Promise<ReactionDuelRoom> {
  if (args.hostUserId === args.opponentUserId) {
    throw gameError('BAD_OPPONENT');
  }
  const guests = await listGuests(args.sessionId);
  const opponent = guests.find(
    (guest) =>
      guest.userId === args.opponentUserId && guest.state === 'LIVE',
  );
  if (!opponent) throw gameError('OPPONENT_NOT_ON_STAGE');

  return withLock(args.sessionId, async () => {
    const existing = await loadRoom(args.sessionId);
    if (existing?.state.active) {
      ensureTicks(args.sessionId);
      return existing;
    }

    const now = nowIso();
    const duelId = randomUUID();
    const room: ReactionDuelRoom = {
      sessionId: args.sessionId,
      hostUserId: args.hostUserId,
      startedByUserId: args.starterUserId,
      state: {
        duelId,
        phase: 'lobby',
        active: true,
        players: [
          {
            userId: args.hostUserId,
            displayName: safeLiveDisplayName(
              args.hostDisplayName,
              args.hostUserId,
              'Host',
            ),
            role: 'host',
            locked: false,
            score: 0,
            lastSeenAt: now,
          },
          {
            userId: args.opponentUserId,
            displayName: safeLiveDisplayName(
              args.opponentDisplayName,
              args.opponentUserId,
              'Guest',
            ),
            role: 'guest',
            locked: false,
            score: 0,
            lastSeenAt: now,
          },
        ],
        roundNumber: 0,
        prompt: null,
        lastRound: null,
        nextRoundAt: null,
        winnerUserId: null,
        winnerDisplayName: null,
        endReason: null,
        endedAt: null,
      },
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await saveRoom(room);
    ensureTicks(args.sessionId);
    emitReactionDuelEvent(args.sessionId, publicEvent(room, 'PHASE'));
    return room;
  });
}

export async function lockPlayer(args: {
  sessionId: string;
  userId: string;
}): Promise<ReactionDuelRoom> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || !room.state.active) throw gameError('GAME_NOT_FOUND');
    if (room.state.phase !== 'lobby') throw gameError('ENTRIES_CLOSED');
    const player = room.state.players.find(
      (candidate) => candidate.userId === args.userId,
    );
    if (!player) throw gameError('NOT_PLAYER');

    if (!player.locked) {
      await lockReactionDuelEntry({
        duelId: room.state.duelId,
        sessionId: room.sessionId,
        userId: player.userId,
      });
      player.locked = true;
    }
    player.lastSeenAt = nowIso();
    if (room.state.players.every((candidate) => candidate.locked)) {
      beginRound(room);
    }
    room.version += 1;
    await saveRoom(room);
    ensureTicks(args.sessionId);
    const type: ReactionDuelEventType =
      (room.state.phase as ReactionDuelPhase) === 'prompt' ? 'PHASE' : 'LOCK';
    emitReactionDuelEvent(args.sessionId, publicEvent(room, type));
    return room;
  });
}

export async function submitTap(args: {
  sessionId: string;
  userId: string;
  promptId: string;
  targetId: string;
}): Promise<ReactionDuelRoom> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || !room.state.active) throw gameError('GAME_NOT_FOUND');
    if (room.state.phase !== 'prompt' || !room.state.prompt) {
      throw gameError('NO_ACTIVE_PROMPT');
    }
    const player = room.state.players.find(
      (candidate) => candidate.userId === args.userId,
    );
    if (!player || !player.locked) throw gameError('NOT_PLAYER');
    if (room.state.prompt.promptId !== args.promptId) {
      throw gameError('STALE_PROMPT');
    }
    if (room.state.prompt.responses[args.userId]) {
      throw gameError('ALREADY_TAPPED');
    }

    const receivedAtMs = Date.now();
    const evaluation = evaluateReactionTap(
      room.state.prompt,
      args.targetId,
      receivedAtMs,
    );
    if (!evaluation.accepted) throw gameError(evaluation.code);

    room.state.prompt.responses[args.userId] = {
      targetId: args.targetId,
      correct: evaluation.correct,
      reactionMs: evaluation.reactionMs,
      receivedAt: new Date(receivedAtMs).toISOString(),
    };
    player.lastSeenAt = new Date(receivedAtMs).toISOString();

    if (evaluation.correct) {
      await finishRound(room, player.userId, evaluation.reactionMs);
    } else if (
      room.state.players.every(
        (candidate) => room.state.prompt?.responses[candidate.userId],
      )
    ) {
      await finishRound(room, null, null);
    }

    room.version += 1;
    await saveRoom(room);
    const type = eventTypeAfterMutation(room, 'SNAPSHOT');
    emitReactionDuelEvent(args.sessionId, publicEvent(room, type));
    return room;
  });
}

export async function heartbeatPlayer(args: {
  sessionId: string;
  userId: string;
}): Promise<ReactionDuelRoom | null> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room || !room.state.active) return room;
    const player = room.state.players.find(
      (candidate) => candidate.userId === args.userId,
    );
    if (!player) return room;
    player.lastSeenAt = nowIso();
    await saveRoom(room);
    ensureTicks(args.sessionId);
    return room;
  });
}

export async function endDuel(args: {
  sessionId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<ReactionDuelRoom | null> {
  return withLock(args.sessionId, async () => {
    const room = await loadRoom(args.sessionId);
    if (!room) return null;
    if (
      !args.isAdmin &&
      room.hostUserId !== args.userId &&
      room.startedByUserId !== args.userId
    ) {
      throw gameError('NOT_AUTHORIZED');
    }
    if (!room.state.active) return room;
    await settleRefund(
      room,
      'ended_by_host',
      'Duel ended — both 100-coin entries refunded.',
    );
    room.version += 1;
    await saveRoom(room);
    emitReactionDuelEvent(args.sessionId, publicEvent(room, 'REFUNDED'));
    return room;
  });
}

export async function getRoom(
  sessionId: string,
): Promise<ReactionDuelRoom | null> {
  return loadRoom(sessionId);
}

export async function resumeTicksIfNeeded(sessionId: string): Promise<void> {
  const room = await loadRoom(sessionId);
  if (room?.state.active) ensureTicks(sessionId);
}
