import { randomBytes, randomUUID } from 'crypto';

export const REACTION_DUEL_DEFAULT_STAKE_COINS = 100;
export const REACTION_DUEL_MIN_STAKE_COINS = 25;
export const REACTION_DUEL_MAX_STAKE_COINS = 5_000;
export const REACTION_DUEL_STAKE_PRESETS = [50, 100, 250, 500] as const;
export const REACTION_DUEL_PRIZE_MULTIPLIER = 3;
// Backward-compatible defaults for callers/tests that only need the standard stake.
export const REACTION_DUEL_ENTRY_COINS = REACTION_DUEL_DEFAULT_STAKE_COINS;
export const REACTION_DUEL_PRIZE_COINS =
  REACTION_DUEL_DEFAULT_STAKE_COINS * REACTION_DUEL_PRIZE_MULTIPLIER;
export const REACTION_DUEL_MAX_ROUNDS = 5;
export const REACTION_DUEL_WIN_SCORE = 3;
export const MIN_REACTION_MS = 120;

export type ReactionShape = 'circle' | 'square' | 'triangle' | 'star';
export type ReactionColorId = 'cyan' | 'rose' | 'gold' | 'violet';
export type ReactionPromptKind =
  | 'shape_color'
  | 'number_position'
  | 'letter_position'
  | 'number_sequence';

export function isValidReactionDuelStake(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= REACTION_DUEL_MIN_STAKE_COINS &&
    value <= REACTION_DUEL_MAX_STAKE_COINS
  );
}

export function reactionDuelPrizeCoins(stakeCoins: number): number {
  if (!isValidReactionDuelStake(stakeCoins)) {
    throw new RangeError(
      `Reaction Duel stake must be a whole number from ${REACTION_DUEL_MIN_STAKE_COINS} to ${REACTION_DUEL_MAX_STAKE_COINS}`,
    );
  }
  return stakeCoins * REACTION_DUEL_PRIZE_MULTIPLIER;
}

export interface ReactionTarget {
  id: string;
  label: string;
  colorId?: ReactionColorId;
  colorLabel?: string;
  colorHex?: string;
  shape?: ReactionShape;
}

export interface ReactionTap {
  targetId: string;
  correct: boolean;
  reactionMs: number;
  receivedAt: string;
}

export interface ReactionPrompt {
  promptId: string;
  roundNumber: number;
  kind: ReactionPromptKind;
  cue: {
    instruction: string;
    colorId?: ReactionColorId;
    colorLabel?: string;
    colorHex?: string;
    shape?: ReactionShape;
  };
  targets: ReactionTarget[];
  correctTargetId: string;
  visibleAt: string;
  endsAt: string;
  responses: Record<string, ReactionTap>;
}

const COLORS: ReadonlyArray<{
  id: ReactionColorId;
  label: string;
  hex: string;
}> = [
  { id: 'cyan', label: 'Cyan', hex: '#22D3EE' },
  { id: 'rose', label: 'Rose', hex: '#FB7185' },
  { id: 'gold', label: 'Gold', hex: '#FACC15' },
  { id: 'violet', label: 'Violet', hex: '#A78BFA' },
];

const SHAPES: ReadonlyArray<ReactionShape> = ['circle', 'square', 'triangle', 'star'];

function byteAt(entropy: Uint8Array, index: number): number {
  if (entropy.length === 0) return index;
  return entropy[index % entropy.length] ?? index;
}

function rotateIndex(index: number, add: number, length: number): number {
  return (index + add) % length;
}

function shuffled<T>(values: T[], entropy: Uint8Array, offset: number): T[] {
  const copy = values.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = byteAt(entropy, offset + i) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

type TargetDraft = Omit<ReactionTarget, 'id'> & { correct: boolean };

function finishPrompt(args: {
  promptId: string;
  roundNumber: number;
  kind: ReactionPromptKind;
  cue: ReactionPrompt['cue'];
  targetDrafts: TargetDraft[];
  visibleAtMs: number;
  windowMs: number;
}): ReactionPrompt {
  const targets = args.targetDrafts.map(({ correct: _correct, ...target }, index) => ({
    ...target,
    id: `${args.promptId}:${index}`,
  }));
  const correctIndex = args.targetDrafts.findIndex((target) => target.correct);
  const visibleAt = Math.floor(args.visibleAtMs);
  const windowMs = Math.max(500, Math.floor(args.windowMs));

  return {
    promptId: args.promptId,
    roundNumber: args.roundNumber,
    kind: args.kind,
    cue: args.cue,
    targets,
    correctTargetId: targets[correctIndex].id,
    visibleAt: new Date(visibleAt).toISOString(),
    endsAt: new Date(visibleAt + windowMs).toISOString(),
    responses: {},
  };
}

function ordinal(position: number): string {
  if (position === 1) return '1st';
  if (position === 2) return '2nd';
  if (position === 3) return '3rd';
  return `${position}th`;
}

function createShapeColorPrompt(args: {
  promptId: string;
  roundNumber: number;
  visibleAtMs: number;
  windowMs: number;
  entropy: Uint8Array;
}): ReactionPrompt {
  const colorIndex = byteAt(args.entropy, 1) % COLORS.length;
  const shapeIndex = byteAt(args.entropy, 2) % SHAPES.length;
  const cueColor = COLORS[colorIndex];
  const cueShape = SHAPES[shapeIndex];
  const combinations = [
    { color: cueColor, shape: cueShape, correct: true },
    {
      color: cueColor,
      shape: SHAPES[rotateIndex(shapeIndex, 1, SHAPES.length)],
      correct: false,
    },
    {
      color: COLORS[rotateIndex(colorIndex, 1, COLORS.length)],
      shape: cueShape,
      correct: false,
    },
    {
      color: COLORS[rotateIndex(colorIndex, 2, COLORS.length)],
      shape: SHAPES[rotateIndex(shapeIndex, 2, SHAPES.length)],
      correct: false,
    },
  ];
  const positioned = shuffled(combinations, args.entropy, 3);

  return finishPrompt({
    ...args,
    kind: 'shape_color',
    cue: {
      instruction: `Tap the ${cueColor.label} ${cueShape}`,
      colorId: cueColor.id,
      colorLabel: cueColor.label,
      colorHex: cueColor.hex,
      shape: cueShape,
    },
    targetDrafts: positioned.map((item) => ({
      label: `${item.color.label} ${item.shape}`,
      colorId: item.color.id,
      colorLabel: item.color.label,
      colorHex: item.color.hex,
      shape: item.shape,
      correct: item.correct,
    })),
  });
}

function createNumberPositionPrompt(args: {
  promptId: string;
  roundNumber: number;
  visibleAtMs: number;
  windowMs: number;
  entropy: Uint8Array;
}): ReactionPrompt {
  const sequence = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], args.entropy, 1).slice(0, 5);
  const position = byteAt(args.entropy, 10) % sequence.length;
  const correct = sequence[position];
  const options = shuffled(
    [correct, ...sequence.filter((value) => value !== correct).slice(0, 3)],
    args.entropy,
    11,
  );

  return finishPrompt({
    ...args,
    kind: 'number_position',
    cue: {
      instruction: `What’s the ${ordinal(position + 1)} number in: ${sequence.join(' ')}?`,
    },
    targetDrafts: options.map((value) => ({
      label: String(value),
      correct: value === correct,
    })),
  });
}

function createLetterPositionPrompt(args: {
  promptId: string;
  roundNumber: number;
  visibleAtMs: number;
  windowMs: number;
  entropy: Uint8Array;
}): ReactionPrompt {
  const sequence = shuffled(
    ['A', 'C', 'E', 'H', 'K', 'M', 'Q', 'R', 'T', 'Y'],
    args.entropy,
    1,
  ).slice(0, 5);
  const position = byteAt(args.entropy, 12) % sequence.length;
  const correct = sequence[position];
  const options = shuffled(
    [correct, ...sequence.filter((value) => value !== correct).slice(0, 3)],
    args.entropy,
    13,
  );

  return finishPrompt({
    ...args,
    kind: 'letter_position',
    cue: {
      instruction: `What’s the ${ordinal(position + 1)} letter in: ${sequence.join(' ')}?`,
    },
    targetDrafts: options.map((value) => ({
      label: value,
      correct: value === correct,
    })),
  });
}

function createNumberSequencePrompt(args: {
  promptId: string;
  roundNumber: number;
  visibleAtMs: number;
  windowMs: number;
  entropy: Uint8Array;
}): ReactionPrompt {
  const start = (byteAt(args.entropy, 1) % 5) + 1;
  const step = (byteAt(args.entropy, 2) % 4) + 1;
  const sequence = Array.from({ length: 4 }, (_, index) => start + index * step);
  const correct = start + sequence.length * step;
  const options = shuffled(
    [correct, correct - step, correct + step, correct + step * 2],
    args.entropy,
    3,
  );

  return finishPrompt({
    ...args,
    kind: 'number_sequence',
    cue: {
      instruction: `What comes next in: ${sequence.join(' ')}?`,
    },
    targetDrafts: options.map((value) => ({
      label: String(value),
      correct: value === correct,
    })),
  });
}

/**
 * Builds one shared prompt for both players. Six of every ten entropy buckets
 * are shape/colour rounds; the rest are short number/letter skill questions.
 * Entropy chooses the prompt only — never the winner. Server receipt order does.
 */
export function createReactionPrompt(args: {
  roundNumber: number;
  visibleAtMs: number;
  windowMs: number;
  entropy?: Uint8Array;
}): ReactionPrompt {
  const entropy = args.entropy ?? randomBytes(16);
  const promptId = randomUUID();
  const promptArgs = {
    promptId,
    roundNumber: args.roundNumber,
    visibleAtMs: args.visibleAtMs,
    windowMs: args.windowMs,
    entropy,
  };
  const kindBucket = byteAt(entropy, 0) % 10;
  if (kindBucket < 6) return createShapeColorPrompt(promptArgs);
  if (kindBucket < 8) return createNumberPositionPrompt(promptArgs);
  if (kindBucket === 8) return createLetterPositionPrompt(promptArgs);
  return createNumberSequencePrompt(promptArgs);
}

export type TapEvaluation =
  | { accepted: true; correct: boolean; reactionMs: number }
  | { accepted: false; code: 'IMPOSSIBLE_TAP' | 'TOO_LATE' | 'BAD_TARGET' };

/** Server receipt time is authoritative; no client timestamp is accepted. */
export function evaluateReactionTap(
  prompt: ReactionPrompt,
  targetId: string,
  receivedAtMs: number,
): TapEvaluation {
  const visibleAtMs = Date.parse(prompt.visibleAt);
  const endsAtMs = Date.parse(prompt.endsAt);
  const reactionMs = Math.floor(receivedAtMs - visibleAtMs);

  if (!Number.isFinite(visibleAtMs) || reactionMs < MIN_REACTION_MS) {
    return { accepted: false, code: 'IMPOSSIBLE_TAP' };
  }
  if (!Number.isFinite(endsAtMs) || receivedAtMs > endsAtMs) {
    return { accepted: false, code: 'TOO_LATE' };
  }
  if (!prompt.targets.some((target) => target.id === targetId)) {
    return { accepted: false, code: 'BAD_TARGET' };
  }
  return {
    accepted: true,
    correct: targetId === prompt.correctTargetId,
    reactionMs,
  };
}

export type MatchDecision =
  | { outcome: 'continue' }
  | { outcome: 'winner'; winnerUserId: string }
  | { outcome: 'draw' };

/** Best of five: first to three clinches; tied after round five is a draw. */
export function decideReactionDuelMatch(args: {
  roundNumber: number;
  players: Array<{ userId: string; score: number }>;
}): MatchDecision {
  const clincher = args.players.find((player) => player.score >= REACTION_DUEL_WIN_SCORE);
  if (clincher) return { outcome: 'winner', winnerUserId: clincher.userId };
  if (args.roundNumber < REACTION_DUEL_MAX_ROUNDS) return { outcome: 'continue' };

  const ordered = args.players.slice().sort((a, b) => b.score - a.score);
  if (ordered.length < 2 || ordered[0].score === ordered[1].score) {
    return { outcome: 'draw' };
  }
  return { outcome: 'winner', winnerUserId: ordered[0].userId };
}
