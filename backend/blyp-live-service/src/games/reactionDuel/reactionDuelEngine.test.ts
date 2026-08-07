import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_REACTION_MS,
  createReactionPrompt,
  decideReactionDuelMatch,
  evaluateReactionTap,
} from './reactionDuelEngine';

describe('reaction duel engine', () => {
  it('gives both players one shared skill prompt and rejects impossible taps', () => {
    const visibleAtMs = 1_900_000_000_000;
    const prompt = createReactionPrompt({
      roundNumber: 1,
      visibleAtMs,
      windowMs: 2_500,
      entropy: Uint8Array.from([7, 11, 13, 17, 19, 23]),
    });

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
