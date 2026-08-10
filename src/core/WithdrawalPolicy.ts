// WithdrawalPolicy.ts
//
// Single source of truth for creator cash-out (withdrawal) rules. These exist to
// protect the platform and creators against fraud, money-laundering, self-dealing
// and accidental misuse.
//
// IMPORTANT: every rule here MUST be enforced server-side (admin SDK / backend),
// never trusted from the client. The client may *preview* eligibility for UX, but
// the authoritative check happens on the server before any money moves. See
// WithdrawalGuard.assessWithdrawal() for the enforcement engine.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const WITHDRAWAL_POLICY = {
  // --- Amounts -------------------------------------------------------------
  // Minimum a creator must have cleared before a payout is allowed.
  MIN_PAYOUT_COINS: 1000,
  // Hard cap on a single request. Anything above MANUAL_REVIEW_ABOVE_COINS is
  // allowed but routed to manual review rather than auto-approved.
  MAX_SINGLE_PAYOUT_COINS: 500_000,
  // Percentage the platform keeps on withdrawal (0 — creators withdraw full gem face;
  // only real rail fees, if any, are outside this policy).
  PLATFORM_FEE_PERCENT: 0,

  // --- Earnings clearance --------------------------------------------------
  // Earnings are held (pending) before they become withdrawable, so gifts funded
  // by purchases that later get refunded/charged back can be clawed back first.
  HOLD_DURATION_MS: 7 * DAY,
  // Refunds/chargebacks within this window reduce the withdrawable balance.
  CLAWBACK_WINDOW_MS: 60 * DAY,

  // --- Account eligibility -------------------------------------------------
  // Account must be at least this old before any cash-out (slows throwaway-account fraud).
  MIN_ACCOUNT_AGE_MS: 30 * DAY,
  REQUIRE_VERIFIED_EMAIL: true,
  // Identity verification (KYC) must be completed before any real-money payout.
  REQUIRE_KYC: true,
  // A verified payout destination (e.g. Stripe Connect account) must be connected.
  REQUIRE_PAYOUT_ACCOUNT: true,
  // A newly added/changed payout destination is held before it can receive money.
  NEW_PAYOUT_ACCOUNT_HOLD_MS: 7 * DAY,

  // --- Velocity / rate limiting -------------------------------------------
  // Only one in-flight (pending/processing) request at a time.
  MAX_OPEN_REQUESTS: 1,
  MIN_TIME_BETWEEN_REQUESTS_MS: 24 * HOUR,
  MAX_REQUESTS_PER_DAY: 1,
  MAX_REQUESTS_PER_WEEK: 3,
  // Rolling payout-amount caps (coins). Above these -> manual review.
  DAILY_PAYOUT_CAP_COINS: 200_000,
  WEEKLY_PAYOUT_CAP_COINS: 750_000,
  MONTHLY_PAYOUT_CAP_COINS: 2_000_000,

  // --- Manual review triggers ---------------------------------------------
  // Requests at/above this amount are never auto-approved.
  MANUAL_REVIEW_ABOVE_COINS: 100_000,

  // --- Hard blocks ---------------------------------------------------------
  // Block payout entirely if the account is frozen, has open disputes/chargebacks,
  // or is under fraud review.
  BLOCK_IF_ACCOUNT_FROZEN: true,
  BLOCK_IF_OPEN_CHARGEBACK: true,
  // Anti money-laundering / self-gifting: coins that were funded by the creator's
  // OWN purchases (directly or via closely linked accounts) are never cashable.
  ALLOW_CASHOUT_OF_SELF_FUNDED_COINS: false,
} as const;

export type WithdrawalPolicy = typeof WITHDRAWAL_POLICY;
