// WithdrawalGuard.ts
//
// The enforcement engine for creator cash-outs. Given an account/wallet/history
// context, it decides whether a withdrawal is allowed, denied, or must go to
// manual review — and returns machine-readable reasons.
//
// This is a PURE function with no side effects so it can be unit-tested and reused
// by the authoritative server endpoint. The client may call a mirror of it only to
// pre-disable the button / show messaging; the server decision is the one that
// moves money.

import { WITHDRAWAL_POLICY as P } from './WithdrawalPolicy';

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface WithdrawalContext {
  now: number;
  /** Coins the creator is requesting to cash out. */
  amountCoins: number;
  /** Cleared, withdrawable coins (after hold + fee + clawbacks). */
  withdrawableCoins: number;

  // Account / identity
  accountAgeMs: number;
  emailVerified: boolean;
  kycStatus: KycStatus;
  accountFrozen: boolean;
  underFraudReview: boolean;
  openChargebackCount: number;

  // Payout destination
  hasPayoutAccount: boolean;
  payoutAccountAgeMs: number; // age since the current destination was added/changed

  // Velocity (caller supplies these from the ledger/history)
  openRequestCount: number; // pending or processing
  lastRequestAt: number | null;
  requestsLast24h: number;
  requestsLast7d: number;
  paidOutLast24hCoins: number;
  paidOutLast7dCoins: number;
  paidOutLast30dCoins: number;

  /**
   * Coins in the withdrawable balance that originated from the creator's OWN
   * purchases (or linked accounts). Never cashable when the policy forbids it.
   */
  selfFundedCoins: number;
}

export type WithdrawalDecision = 'allow' | 'review' | 'deny';

export interface WithdrawalAssessment {
  decision: WithdrawalDecision;
  /** Stable reason codes (denials first, then review reasons). */
  reasons: string[];
  requiresManualReview: boolean;
}

/**
 * Assess a withdrawal request against the full anti-fraud policy.
 * Hard failures => 'deny'. Soft/risk signals => 'review'. Otherwise 'allow'.
 */
export function assessWithdrawal(ctx: WithdrawalContext): WithdrawalAssessment {
  const denies: string[] = [];
  const reviews: string[] = [];

  // --- Amount sanity -------------------------------------------------------
  if (!Number.isFinite(ctx.amountCoins) || ctx.amountCoins <= 0) {
    denies.push('INVALID_AMOUNT');
  }
  if (!Number.isInteger(ctx.amountCoins)) {
    denies.push('NON_INTEGER_AMOUNT');
  }
  if (ctx.amountCoins < P.MIN_PAYOUT_COINS) {
    denies.push('BELOW_MIN_PAYOUT');
  }
  if (ctx.amountCoins > P.MAX_SINGLE_PAYOUT_COINS) {
    denies.push('ABOVE_MAX_SINGLE_PAYOUT');
  }

  // --- Balance / clawback / self-funding ----------------------------------
  const cashable = P.ALLOW_CASHOUT_OF_SELF_FUNDED_COINS
    ? ctx.withdrawableCoins
    : Math.max(0, ctx.withdrawableCoins - Math.max(0, ctx.selfFundedCoins));
  if (ctx.amountCoins > cashable) {
    denies.push('INSUFFICIENT_WITHDRAWABLE_BALANCE');
  }
  if (!P.ALLOW_CASHOUT_OF_SELF_FUNDED_COINS && ctx.selfFundedCoins > 0 && ctx.amountCoins > (ctx.withdrawableCoins - ctx.selfFundedCoins)) {
    // The shortfall is specifically due to self-funded coins.
    reviews.push('SELF_FUNDED_COINS_EXCLUDED');
  }

  // --- Hard blocks ---------------------------------------------------------
  if (P.BLOCK_IF_ACCOUNT_FROZEN && ctx.accountFrozen) denies.push('ACCOUNT_FROZEN');
  if (ctx.underFraudReview) denies.push('UNDER_FRAUD_REVIEW');
  if (P.BLOCK_IF_OPEN_CHARGEBACK && ctx.openChargebackCount > 0) denies.push('OPEN_CHARGEBACK');

  // --- Eligibility ---------------------------------------------------------
  if (ctx.accountAgeMs < P.MIN_ACCOUNT_AGE_MS) denies.push('ACCOUNT_TOO_NEW');
  if (P.REQUIRE_VERIFIED_EMAIL && !ctx.emailVerified) denies.push('EMAIL_NOT_VERIFIED');
  if (P.REQUIRE_KYC && ctx.kycStatus !== 'verified') denies.push('KYC_NOT_VERIFIED');
  if (P.REQUIRE_PAYOUT_ACCOUNT && !ctx.hasPayoutAccount) denies.push('NO_PAYOUT_ACCOUNT');

  // --- Velocity / rate limiting -------------------------------------------
  if (ctx.openRequestCount >= P.MAX_OPEN_REQUESTS) denies.push('OPEN_REQUEST_EXISTS');
  if (
    ctx.lastRequestAt != null &&
    ctx.now - ctx.lastRequestAt < P.MIN_TIME_BETWEEN_REQUESTS_MS
  ) {
    denies.push('TOO_SOON_SINCE_LAST_REQUEST');
  }
  if (ctx.requestsLast24h >= P.MAX_REQUESTS_PER_DAY) denies.push('DAILY_REQUEST_LIMIT');
  if (ctx.requestsLast7d >= P.MAX_REQUESTS_PER_WEEK) denies.push('WEEKLY_REQUEST_LIMIT');

  // --- Rolling payout caps -> manual review --------------------------------
  if (ctx.paidOutLast24hCoins + ctx.amountCoins > P.DAILY_PAYOUT_CAP_COINS) reviews.push('OVER_DAILY_CAP');
  if (ctx.paidOutLast7dCoins + ctx.amountCoins > P.WEEKLY_PAYOUT_CAP_COINS) reviews.push('OVER_WEEKLY_CAP');
  if (ctx.paidOutLast30dCoins + ctx.amountCoins > P.MONTHLY_PAYOUT_CAP_COINS) reviews.push('OVER_MONTHLY_CAP');

  // --- New/changed payout destination & large amounts -> manual review -----
  if (ctx.hasPayoutAccount && ctx.payoutAccountAgeMs < P.NEW_PAYOUT_ACCOUNT_HOLD_MS) {
    reviews.push('NEW_PAYOUT_ACCOUNT');
  }
  if (ctx.amountCoins >= P.MANUAL_REVIEW_ABOVE_COINS) reviews.push('LARGE_AMOUNT');

  if (denies.length > 0) {
    return { decision: 'deny', reasons: denies, requiresManualReview: false };
  }
  if (reviews.length > 0) {
    return { decision: 'review', reasons: reviews, requiresManualReview: true };
  }
  return { decision: 'allow', reasons: [], requiresManualReview: false };
}
