export type EconomyErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTH'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'DUPLICATE_TX'
  | 'VERIFICATION_FAILED'
  | 'PROVIDER_ERROR'
  | 'INTERNAL'
  | 'IDEMPOTENT_REPLAY'
  | 'INSUFFICIENT_FUNDS'
  | 'SLOT_UNAVAILABLE'
  | 'COOLDOWN'
  | 'RATE_LIMIT'
  | 'GIFT_NOT_FOUND'
  | 'STREAM_NOT_FOUND'
  | 'RECEIVER_INVALID'
  | 'RESTRICTED'
  | 'BLOCKED'
  | 'WITHDRAWALS_DISABLED'
  | 'WITHDRAWAL_DENIED'
  | 'STRIPE_NOT_CONFIGURED'
  | 'STRIPE_CONNECT_SETUP_REQUIRED'
  | 'INVALID_STATE'
  | 'PROMOTE_CAP'
  | 'PROMOTE_TYPE_ACTIVE'
  | 'SEARCH_CAP';

export class EconomyError extends Error {
  code: EconomyErrorCode;
  httpStatus: number;
  detail?: any;

  constructor(code: EconomyErrorCode, httpStatus: number, message: string, detail?: any) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.detail = detail;
  }
}

/** Detect Stripe Connect platform onboarding / questionnaire blockers. */
export function isStripeConnectSetupError(err: any): boolean {
  const msg = String(err?.message || err?.raw?.message || '');
  if (!msg) return false;
  return (
    /platform profile/i.test(msg) ||
    /signed up for connect/i.test(msg) ||
    /complete your platform/i.test(msg) ||
    /answer the questionnaire/i.test(msg) ||
    /manage your platform profile/i.test(msg)
  );
}

export function stripeConnectSetupRequiredError(err?: any): EconomyError {
  const underlying = typeof err?.message === 'string' ? err.message : undefined;
  return new EconomyError(
    'STRIPE_CONNECT_SETUP_REQUIRED',
    503,
    'Finish Stripe Connect setup in Dashboard: open Connect → Accounts overview, complete the platform questionnaire, and upload ID if asked. Then retry Withdraw.',
    underlying
      ? {
          stripeMessage: underlying.slice(0, 400),
          dashboardUrl: 'https://dashboard.stripe.com/connect/accounts/overview',
        }
      : { dashboardUrl: 'https://dashboard.stripe.com/connect/accounts/overview' },
  );
}

export function toEconomyError(err: any): EconomyError {
  if (err instanceof EconomyError) return err;

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  // Stripe SDK errors often bubble as plain Errors with a useful message.
  // Prefer a clear Connect-setup signal over opaque INTERNAL when possible.
  if (isStripeConnectSetupError(err)) {
    return stripeConnectSetupRequiredError(err);
  }

  const underlyingMessage = typeof err?.message === 'string' ? err.message : undefined;
  const message = !isProduction && underlyingMessage ? underlyingMessage : 'Internal error';

  const debugDetail =
    err?.detail ??
    (typeof err?.stack === 'string' ? err.stack : undefined) ??
    underlyingMessage ??
    err;

  return new EconomyError('INTERNAL', 500, message, isProduction ? undefined : debugDetail);
}
