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
  | 'BLOCKED';

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

export function toEconomyError(err: any): EconomyError {
  if (err instanceof EconomyError) return err;

  const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

  // In production, keep the message generic to avoid leaking details.
  // In local/dev builds, surface the underlying message to make debugging faster.
  const underlyingMessage = typeof err?.message === 'string' ? err.message : undefined;
  const message = !isProduction && underlyingMessage ? underlyingMessage : 'Internal error';

  const debugDetail =
    err?.detail ??
    (typeof err?.stack === 'string' ? err.stack : undefined) ??
    underlyingMessage ??
    err;

  return new EconomyError('INTERNAL', 500, message, isProduction ? undefined : debugDetail);
}
