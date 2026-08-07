import { WITHDRAWAL_POLICY as P } from './withdrawalPolicy';

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface WithdrawalContext {
  now: number;
  amountCoins: number;
  withdrawableCoins: number;
  accountAgeMs: number;
  emailVerified: boolean;
  kycStatus: KycStatus;
  accountFrozen: boolean;
  underFraudReview: boolean;
  openChargebackCount: number;
  hasPayoutAccount: boolean;
  payoutAccountAgeMs: number;
  openRequestCount: number;
  lastRequestAt: number | null;
  requestsLast24h: number;
  requestsLast7d: number;
  paidOutLast24hCoins: number;
  paidOutLast7dCoins: number;
  paidOutLast30dCoins: number;
  selfFundedCoins: number;
  /**
   * Owner / ADMIN_ALLOWLIST / WITHDRAW_TEST_SUBS launch-test path.
   * Softens account/new-payout holds and request velocity. Balance, KYC,
   * open-request, freeze, chargeback, and fraud-review rails stay on.
   */
  launchTestBypass?: boolean;
}

export type WithdrawalDecision = 'allow' | 'review' | 'deny';

export interface WithdrawalAssessment {
  decision: WithdrawalDecision;
  reasons: string[];
  requiresManualReview: boolean;
}

export function assessWithdrawal(ctx: WithdrawalContext): WithdrawalAssessment {
  const denies: string[] = [];
  const reviews: string[] = [];

  if (!Number.isFinite(ctx.amountCoins) || ctx.amountCoins <= 0) denies.push('INVALID_AMOUNT');
  if (!Number.isInteger(ctx.amountCoins)) denies.push('NON_INTEGER_AMOUNT');
  if (ctx.amountCoins < P.MIN_PAYOUT_COINS) denies.push('BELOW_MIN_PAYOUT');
  if (ctx.amountCoins > P.MAX_SINGLE_PAYOUT_COINS) denies.push('ABOVE_MAX_SINGLE_PAYOUT');

  const cashable = P.ALLOW_CASHOUT_OF_SELF_FUNDED_COINS
    ? ctx.withdrawableCoins
    : Math.max(0, ctx.withdrawableCoins - Math.max(0, ctx.selfFundedCoins));
  if (ctx.amountCoins > cashable) denies.push('INSUFFICIENT_WITHDRAWABLE_BALANCE');
  if (
    !P.ALLOW_CASHOUT_OF_SELF_FUNDED_COINS &&
    ctx.selfFundedCoins > 0 &&
    ctx.amountCoins > ctx.withdrawableCoins - ctx.selfFundedCoins
  ) {
    reviews.push('SELF_FUNDED_COINS_EXCLUDED');
  }

  if (P.BLOCK_IF_ACCOUNT_FROZEN && ctx.accountFrozen) denies.push('ACCOUNT_FROZEN');
  if (ctx.underFraudReview) denies.push('UNDER_FRAUD_REVIEW');
  if (P.BLOCK_IF_OPEN_CHARGEBACK && ctx.openChargebackCount > 0) denies.push('OPEN_CHARGEBACK');

  // Launch-test bypass: account-age hold only (normal users still blocked).
  if (!ctx.launchTestBypass && ctx.accountAgeMs < P.MIN_ACCOUNT_AGE_MS) {
    denies.push('ACCOUNT_TOO_NEW');
  }
  if (P.REQUIRE_VERIFIED_EMAIL && !ctx.emailVerified) denies.push('EMAIL_NOT_VERIFIED');
  if (P.REQUIRE_KYC && ctx.kycStatus !== 'verified') denies.push('KYC_NOT_VERIFIED');
  if (P.REQUIRE_PAYOUT_ACCOUNT && !ctx.hasPayoutAccount) denies.push('NO_PAYOUT_ACCOUNT');

  if (ctx.openRequestCount >= P.MAX_OPEN_REQUESTS) denies.push('OPEN_REQUEST_EXISTS');
  // Owner/allowlisted launch testing must be immediately retryable after a
  // provider failure. Normal-user anti-abuse velocity remains unchanged.
  if (!ctx.launchTestBypass) {
    if (ctx.lastRequestAt != null && ctx.now - ctx.lastRequestAt < P.MIN_TIME_BETWEEN_REQUESTS_MS) {
      denies.push('TOO_SOON_SINCE_LAST_REQUEST');
    }
    if (ctx.requestsLast24h >= P.MAX_REQUESTS_PER_DAY) denies.push('DAILY_REQUEST_LIMIT');
    if (ctx.requestsLast7d >= P.MAX_REQUESTS_PER_WEEK) denies.push('WEEKLY_REQUEST_LIMIT');
  }

  if (ctx.paidOutLast24hCoins + ctx.amountCoins > P.DAILY_PAYOUT_CAP_COINS) reviews.push('OVER_DAILY_CAP');
  if (ctx.paidOutLast7dCoins + ctx.amountCoins > P.WEEKLY_PAYOUT_CAP_COINS) reviews.push('OVER_WEEKLY_CAP');
  if (ctx.paidOutLast30dCoins + ctx.amountCoins > P.MONTHLY_PAYOUT_CAP_COINS) reviews.push('OVER_MONTHLY_CAP');

  // Launch-test bypass: new Connect account hold → review (still auto-path for small Owner tests).
  if (
    !ctx.launchTestBypass &&
    ctx.hasPayoutAccount &&
    ctx.payoutAccountAgeMs < P.NEW_PAYOUT_ACCOUNT_HOLD_MS
  ) {
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
