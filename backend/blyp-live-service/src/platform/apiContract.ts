import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type ApiErrorDetails = Record<string, unknown> | unknown[];

export type RequestContext = {
  correlationId: string;
  clientVersion: string | null;
  startedAtMs: number;
};

export interface PlatformRequest extends Request {
  context?: RequestContext;
  user?: { sub: string; [key: string]: unknown };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ApiErrorDetails;

  constructor(status: number, code: string, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getCorrelationId(req: Request): string {
  return (req as PlatformRequest).context?.correlationId || 'unavailable';
}

export function sendSuccess<T>(
  req: Request,
  res: Response,
  data: T,
  options: { status?: number; nextCursor?: string | null } = {}
) {
  const meta: Record<string, unknown> = {
    correlationId: getCorrelationId(req),
  };
  if (Object.prototype.hasOwnProperty.call(options, 'nextCursor')) {
    meta.nextCursor = options.nextCursor ?? null;
  }

  return res.status(options.status ?? 200).json({
    ok: true,
    data,
    meta,
  });
}

export function sendApiError(
  req: Request,
  res: Response,
  error: ApiError | { status: number; code: string; message: string; details?: ApiErrorDetails }
) {
  return res.status(error.status).json({
    ok: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
    meta: {
      correlationId: getCorrelationId(req),
    },
  });
}

export function asyncRoute(
  handler: (req: PlatformRequest, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as PlatformRequest, res, next)).catch(next);
  };
}
