import { randomBytes, randomUUID } from 'crypto';

export const REACTION_DUEL_ENTRY_COINS = 100;
export const REACTION_DUEL_PRIZE_COINS = 300;
export const REACTION_DUEL_MAX_ROUNDS = 5;
export const REACTION_DUEL_WIN_SCORE = 3;
export const MIN_REACTION_MS = 120;

export type ReactionShape = 'circle' | 'square' | 'triangle' | 'star';
export type ReactionColorId = 'cyan' | 'rose' | 'gold' | 'violet';

export interface ReactionTarget {
  id: string;
  colorId: ReactionColorId;
  colorLabel: string;
  colorHex: string;
  shape: ReactionShape;
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
  cue: {
    colorId: ReactionColorId;
    colorLabel: string;
    colorHex: string;
    shape: ReactionShape;
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

/**
 * Builds one shared prompt for both players. Entropy chooses the prompt only;
 * it never chooses a winner. Tap order is decided solely by server receipt time.
 */
export function createReactionPrompt(args: {
  roundNumber: number;
  visibleAtMs: number;
  windowMs: number;
  entropy?: Uint8Array;
}): ReactionPrompt {
  const entropy = args.entropy ?? randomBytes(16);
  const colorIndex = byteAt(entropy, 0) % COLORS.length;
  const shapeIndex = byteAt(entropy, 1) % SHAPES.length;
  const cueColor = COLORS[colorIndex];
  const cueShape = SHAPES[shapeIndex];
  const promptId = randomUUID();

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

  const positioned = shuffled(combinations, entropy, 2);
  const targets = positioned.map((item, index) => ({
    id: `${promptId}:${index}`,
    colorId: item.color.id,
    colorLabel: item.color.label,
    colorHex: item.color.hex,
    shape: item.shape,
  }));
  const correctIndex = positioned.findIndex((item) => item.correct);
  const visibleAt = Math.floor(args.visibleAtMs);
  const windowMs = Math.max(500, Math.floor(args.windowMs));

  return {
    promptId,
    roundNumber: args.roundNumber,
    cue: {
      colorId: cueColor.id,
      colorLabel: cueColor.label,
      colorHex: cueColor.hex,
      shape: cueShape,
    },
    targets,
    correctTargetId: targets[correctIndex].id,
    visibleAt: new Date(visibleAt).toISOString(),
    endsAt: new Date(visibleAt + windowMs).toISOString(),
    responses: {},
  };
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
