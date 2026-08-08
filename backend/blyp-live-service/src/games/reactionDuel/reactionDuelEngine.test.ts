import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_REACTION_MS,
  createReactionPrompt,
  decideReactionDuelMatch,
  evaluateReactionTap,
  isValidReactionDuelStake,
  reactionDuelPrizeCoins,
} from './reactionDuelEngine';

describe('reaction duel engine', () => {
  it('gives both players one shared skill prompt and rejects impossible taps', () => {
    const visibleAtMs = 1_900_000_000_000;
    const prompt = createReactionPrompt({
      roundNumber: 1,
      visibleAtMs,
      windowMs: 2_500,
      entropy: Uint8Array.from([0, 11, 13, 17, 19, 23]),
    });

    assert.equal(prompt.kind, 'shape_color');
    assert.equal(prompt.targets.length, 4);
    assert.equal(
      prompt.targets.filter(
        (target) =>
          target.colorId === prompt.cue.colorId &&
          target.shape === prompt.cue.shape,
      ).length,
      1,
    );

    assert.deepEqual(
      evaluateReactionTap(prompt, prompt.correctTargetId, visibleAtMs + MIN_REACTION_MS - 1),
      { accepted: false, code: 'IMPOSSIBLE_TAP' },
    );
    assert.deepEqual(
      evaluateReactionTap(prompt, prompt.correctTargetId, visibleAtMs + 243),
      { accepted: true, correct: true, reactionMs: 243 },
    );
  });

  it('keeps shape rounds frequent while adding shared number and letter questions', () => {
    const kinds = Array.from({ length: 10 }, (_, bucket) =>
      createReactionPrompt({
        roundNumber: bucket + 1,
        visibleAtMs: 1_900_000_000_000,
        windowMs: 2_500,
        entropy: Uint8Array.from([bucket, 5, 9, 13, 17, 21, 25, 29]),
      }),
    );

    assert.equal(kinds.filter((prompt) => prompt.kind === 'shape_color').length, 6);
    assert.equal(kinds.filter((prompt) => prompt.kind === 'number_position').length, 2);
    assert.equal(kinds.filter((prompt) => prompt.kind === 'letter_position').length, 1);
    assert.equal(kinds.filter((prompt) => prompt.kind === 'number_sequence').length, 1);
    for (const prompt of kinds) {
      assert.equal(prompt.targets.length, 4);
      assert.ok(prompt.cue.instruction.length > 0);
      assert.ok(prompt.targets.some((target) => target.id === prompt.correctTargetId));
    }
  });

  it('validates flexible stakes and preserves the 3x prize ratio', () => {
    assert.equal(isValidReactionDuelStake(25), true);
    assert.equal(isValidReactionDuelStake(500), true);
    assert.equal(isValidReactionDuelStake(24), false);
    assert.equal(isValidReactionDuelStake(25.5), false);
    assert.equal(reactionDuelPrizeCoins(50), 150);
    assert.equal(reactionDuelPrizeCoins(100), 300);
    assert.equal(reactionDuelPrizeCoins(317), 951);
  });

  it('uses a best-of-five rule with first-to-three clinching', () => {
    assert.deepEqual(
      decideReactionDuelMatch({
        roundNumber: 3,
        players: [
          { userId: 'host', score: 3 },
          { userId: 'guest', score: 0 },
        ],
      }),
      { outcome: 'winner', winnerUserId: 'host' },
    );

    assert.deepEqual(
      decideReactionDuelMatch({
        roundNumber: 5,
        players: [
          { userId: 'host', score: 2 },
          { userId: 'guest', score: 2 },
        ],
      }),
      { outcome: 'draw' },
    );
  });
});
