import { createHash } from 'crypto';
import { NextFunction, Response } from 'express';
import { getEconomyInfra } from '../economy/infra';
import { AuthedRequest } from '../auth/cognitoJwtMiddleware';
import { ApiError, sendApiError } from './apiContract';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function requestHash(req: AuthedRequest) {
  return createHash('sha256')
    .update(req.method)
    .update('\n')
    .update(req.baseUrl)
    .update(req.path)
    .update('\n')
    .update(JSON.stringify(req.body ?? null))
    .digest('hex');
}

function operationName(req: AuthedRequest) {
  return `${req.method}:${req.baseUrl}${req.path}`.slice(0, 160);
}

export async function requireMutationIdempotency(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  try {
    const actorUserId = req.user?.sub;
    if (!actorUserId) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required.');

    const idempotencyKey = String(req.header('Idempotency-Key') || '').trim();
    if (!KEY_PATTERN.test(idempotencyKey)) {
      throw new ApiError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required for mutations.'
      );
    }

    const operation = operationName(req);
    const hash = requestHash(req);
    const { db } = getEconomyInfra();
    const inserted = await db('api_idempotency_keys')
      .insert({
        actor_user_id: actorUserId,
        operation,
        idempotency_key: idempotencyKey,
        request_hash: hash,
        expires_at: db.raw("NOW() + INTERVAL '24 hours'"),
      })
      .onConflict(['actor_user_id', 'operation', 'idempotency_key'])
      .ignore()
      .returning('actor_user_id');

    if (inserted.length === 0) {
      const record = await db('api_idempotency_keys')
        .select('request_hash', 'response_status', 'response_body')
        .where({ actor_user_id: actorUserId, operation, idempotency_key: idempotencyKey })
        .andWhere('expires_at', '>', db.fn.now())
        .first();
      if (!record) {
        throw new ApiError(409, 'IDEMPOTENCY_KEY_EXPIRED', 'The idempotency key has expired.');
      }
      if (record.request_hash !== hash) {
        throw new ApiError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'The idempotency key was already used with a different request.'
        );
      }
      if (record.response_status !== null && record.response_body !== null) {
        res.setHeader('Idempotency-Replayed', 'true');
        res.status(Number(record.response_status)).json(record.response_body);
        return;
      }
      throw new ApiError(409, 'IDEMPOTENCY_IN_PROGRESS', 'An identical request is already in progress.');
    }

    let responseBody: unknown = null;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      responseBody = body;
      return originalJson(body);
    }) as typeof res.json;

    res.once('finish', () => {
      const persist = async () => {
        if (res.statusCode >= 500 || responseBody === null) {
          await db('api_idempotency_keys')
            .where({ actor_user_id: actorUserId, operation, idempotency_key: idempotencyKey })
            .delete();
          return;
        }
        await db('api_idempotency_keys')
          .where({ actor_user_id: actorUserId, operation, idempotency_key: idempotencyKey })
          .update({
            response_status: res.statusCode,
            response_body: JSON.stringify(responseBody),
            state: 'completed',
            completed_at: db.fn.now(),
          });
      };
      void persist().catch(() => {});
    });

    next();
  } catch (error) {
    if (error instanceof ApiError) {
      sendApiError(req, res, error);
      return;
    }
    next(error);
  }
}
