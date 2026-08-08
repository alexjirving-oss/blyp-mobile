import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReactionDuelPrizeCredit,
  planReactionDuelGemSettlement,
  planReactionEntryDebit,
  planReactionEntryRefund,
} from './reactionDuelEconomy';

describe('reaction duel economy', () => {
  it('debits an agreed stake bonus-first', () => {
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

  it('records a 3x live-only coin prize for live-end conversion', () => {
    const credit = buildReactionDuelPrizeCredit({
      duelId: 'duel-1',
      sessionId: 'live-1',
      winnerUserId: 'winner',
      stakeCoins: 250,
      reason: 'Reaction Duel skill win',
    });

    assert.equal(credit.userId, 'winner');
    assert.equal(credit.currency, 'COIN');
    assert.equal(credit.amount, 750);
    assert.equal(credit.status, 'PENDING');
    assert.equal(credit.idempotencyKey, 'reaction-duel:duel-1:prize');
    assert.equal(credit.metadata.sessionId, 'live-1');
    assert.equal(credit.metadata.convertsAtLiveEnd, true);
  });

  it('converts live coins to equal-count gems with half-value metadata', () => {
    assert.deepEqual(planReactionDuelGemSettlement(750n), {
      coinsConverted: 750n,
      gemsCredited: 750n,
      coinToGemCountRatio: '1:1',
      gemCashoutValueRelativeToLiveCoin: 0.5,
    });
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
