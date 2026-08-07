import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReactionDuelPrizeCredit,
  planReactionEntryDebit,
  planReactionEntryRefund,
} from './reactionDuelEconomy';

describe('reaction duel economy', () => {
  it('debits the fixed 100-coin entry bonus-first', () => {
    const debit = planReactionEntryDebit(
      { coinBalance: 125n, bonusCoinBalance: 40n },
      100n,
    );

    assert.deepEqual(debit, {
      paidCoinCost: 60n,
      bonusCoinCost: 40n,
      coinBalance: 65n,
      bonusCoinBalance: 0n,
    });
    assert.throws(
      () =>
        planReactionEntryDebit(
          { coinBalance: 59n, bonusCoinBalance: 40n },
          100n,
        ),
      /requires 100 coins/i,
    );
  });

  it('credits the winner with the fixed 300-coin HOUSE prize', () => {
    const credit = buildReactionDuelPrizeCredit({
      duelId: 'duel-1',
      winnerUserId: 'winner',
      reason: 'Reaction Duel skill win',
    });

    assert.equal(credit.actorUserId, 'system:reaction-duel');
    assert.equal(credit.input.targetUserId, 'winner');
    assert.equal(credit.input.coins, 300);
    assert.equal(credit.input.idempotencyKey, 'reaction-duel:duel-1:prize');
  });

  it('refunds the paid and bonus portions exactly', () => {
    const afterDebit = planReactionEntryDebit(
      { coinBalance: 125n, bonusCoinBalance: 40n },
      100n,
    );
    const refunded = planReactionEntryRefund(afterDebit, afterDebit);

    assert.deepEqual(refunded, {
      coinBalance: 125n,
      bonusCoinBalance: 40n,
    });
  });
});
