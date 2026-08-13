import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EconomyError } from '../../economy/economyErrors';
import {
  buildReactionDuelPrizeCredit,
  planReactionDuelGemSettlement,
  planReactionEntryDebit,
  planReactionEntryRefund,
  reactionPrizeMintFailureRecovery,
  shouldConvertReactionPrizeToGems,
} from './reactionDuelEconomy';

describe('reaction duel economy', () => {
  it('debits stake from paid coins only (bonus ignored — lock-3)', () => {
    const debit = planReactionEntryDebit(
      { coinBalance: 125n, bonusCoinBalance: 40n },
      100n,
    );

    assert.deepEqual(debit, {
      paidCoinCost: 100n,
      bonusCoinCost: 0n,
      coinBalance: 25n,
      bonusCoinBalance: 40n,
    });
  });

  it('rejects when paid is short even if bonus would cover', () => {
    assert.throws(
      () =>
        planReactionEntryDebit(
          { coinBalance: 59n, bonusCoinBalance: 400n },
          100n,
        ),
      (err: unknown) =>
        err instanceof EconomyError &&
        err.code === 'INSUFFICIENT_FUNDS' &&
        /bonus cannot fund/i.test(err.message),
    );
  });

  it('records a 3x immediate wallet COIN prize (v2, no live-end GEM)', () => {
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
    assert.equal(credit.status, 'POSTED');
    assert.equal(credit.idempotencyKey, 'reaction-duel:v2:duel-1:prize');
    assert.equal(credit.metadata.sessionId, 'live-1');
    assert.equal(credit.metadata.convertsAtLiveEnd, false);
    assert.equal(credit.metadata.walletCredited, true);
    assert.equal(credit.metadata.payoutVersion, 2);
    assert.equal(shouldConvertReactionPrizeToGems(credit.metadata), false);
  });

  it('does not double-convert v2 prizes to GEM; legacy PENDING still can', () => {
    assert.equal(
      shouldConvertReactionPrizeToGems({
        convertsAtLiveEnd: true,
        payoutVersion: 1,
      }),
      true,
    );
    assert.equal(
      shouldConvertReactionPrizeToGems({
        walletCredited: true,
        convertsAtLiveEnd: false,
        payoutVersion: 2,
      }),
      false,
    );
  });

  it('converts live coins to equal-count gems with half-value metadata (legacy helper)', () => {
    assert.deepEqual(planReactionDuelGemSettlement(750n), {
      coinsConverted: 750n,
      gemsCredited: 750n,
      coinToGemCountRatio: '1:1',
      gemCashoutValueRelativeToLiveCoin: 0.5,
    });
  });

  it('refunds the paid portion exactly (bonus cost always 0 under paid-only)', () => {
    const afterDebit = planReactionEntryDebit(
      { coinBalance: 125n, bonusCoinBalance: 40n },
      100n,
    );
    const refunded = planReactionEntryRefund(
      { coinBalance: afterDebit.coinBalance, bonusCoinBalance: afterDebit.bonusCoinBalance },
      { paidCoinCost: afterDebit.paidCoinCost, bonusCoinCost: afterDebit.bonusCoinCost },
    );

    assert.deepEqual(refunded, {
      coinBalance: 125n,
      bonusCoinBalance: 40n,
    });
  });

  it('on mint failure after lock, recovery policy is refund LOCKED entries', () => {
    assert.deepEqual(reactionPrizeMintFailureRecovery(), {
      refundLockedEntries: true,
      reason: 'prize_mint_failed',
    });
  });
});
