import { randomUUID } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../config/logger';
import { ApiError, PlatformRequest, sendApiError } from './apiContract';

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const CLIENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

export function requestContextMiddleware(req: PlatformRequest, res: Response, next: NextFunction) {
  const requestedId = String(req.header('X-Correlation-Id') || '').trim();
  const correlationId = CORRELATION_ID_PATTERN.test(requestedId) ? requestedId : randomUUID();
  const rawClientVersion = String(req.header('X-Client-Version') || '').trim();
  const clientVersion = CLIENT_VERSION_PATTERN.test(rawClientVersion) ? rawClientVersion : null;

  req.context = {
    correlationId,
    clientVersion,
    startedAtMs: Date.now(),
  };
  res.setHeader('X-Correlation-Id', correlationId);

  res.on('finish', () => {
    logger.info(
      {
        correlationId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        statusCode: res.statusCode,
        durationMs: Date.now() - (req.context?.startedAtMs || Date.now()),
        clientVersion,
        actorUserId: req.user?.sub || null,
      },
      '[http_request]'
    );
  });

  next();
}

export function requireClientVersion(req: PlatformRequest, res: Response, next: NextFunction) {
  if (!req.context?.clientVersion) {
    return sendApiError(
      req,
      res,
      new ApiError(400, 'CLIENT_VERSION_REQUIRED', 'A valid X-Client-Version header is required.')
    );
  }
  next();
}

type RateBucket = {
  count: number;
  resetAtMs: number;
};

export function createInProcessRateLimit(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}): RequestHandler {
  const buckets = new Map<string, RateBucket>();
  let lastSweepAtMs = 0;

  return (req: PlatformRequest, res, next) => {
    const now = Date.now();
    if (now - lastSweepAtMs > options.windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAtMs <= now) buckets.delete(key);
      }
      lastSweepAtMs = now;
    }

    const actor = req.user?.sub || req.ip || 'unknown';
    const key = `${options.keyPrefix}:${actor}`;
    const existing = buckets.get(key);
    const bucket = !existing || existing.resetAtMs <= now
      ? { count: 0, resetAtMs: now + options.windowMs }
      : existing;
    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, options.maxRequests - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAtMs / 1000)));

    if (bucket.count > options.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return sendApiError(
        req,
        res,
        new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.', {
          retryAfterSeconds,
        })
      );
    }

    next();
  };
}

export function platformNotFound(req: PlatformRequest, res: Response) {
  return sendApiError(req, res, new ApiError(404, 'ROUTE_NOT_FOUND', 'The requested API route does not exist.'));
}

export function platformErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const apiError = err instanceof ApiError
    ? err
    : new ApiError(500, 'INTERNAL_ERROR', 'The request could not be completed.');

  if (!(err instanceof ApiError)) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        correlationId: (req as PlatformRequest).context?.correlationId,
      },
      '[http_unhandled_error]'
    );
  }

  if (res.headersSent) return;
  sendApiError(req, res, apiError);
}
