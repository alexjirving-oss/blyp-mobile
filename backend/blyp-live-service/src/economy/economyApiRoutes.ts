import { Router } from 'express';
import { cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import {
  ApiError,
  asyncRoute,
  sendSuccess,
  type PlatformRequest,
} from '../platform/apiContract';
import {
  createInProcessRateLimit,
  requireClientVersion,
} from '../platform/gatewayMiddleware';
import { requireMutationIdempotency } from '../platform/idempotency';
import { giftSendSchema, iapVerifySchema, paginationSchema } from './economySchemas';
import { toEconomyError } from './economyErrors';
import {
  getCatalog,
  getLedger,
  getWallet,
  sendGift,
  verifyIapPurchaseAndGrant,
} from './economyService';

const economyApiRouter = Router();

economyApiRouter.use(requireClientVersion);
economyApiRouter.use(cognitoJwtMiddleware);
economyApiRouter.use(
  createInProcessRateLimit({
    keyPrefix: 'economy-v1',
    windowMs: 60_000,
    maxRequests: 120,
  })
);

function canonicalUserId(req: PlatformRequest): string {
  const userId = String(req.user?.sub || '').trim();
  if (!userId) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'A canonical authenticated user is required.');
  }
  return userId;
}

function assertBodyIdempotencyMatchesHeader(req: PlatformRequest, bodyKey: string) {
  const headerKey = String(req.header('Idempotency-Key') || '').trim();
  if (!headerKey || headerKey !== bodyKey) {
    throw new ApiError(
      400,
      'IDEMPOTENCY_KEY_MISMATCH',
      'The Idempotency-Key header must match body.idempotencyKey.'
    );
  }
}

async function economyOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const mapped = toEconomyError(error);
    throw new ApiError(mapped.httpStatus, mapped.code, mapped.message, mapped.detail);
  }
}

economyApiRouter.get(
  '/catalog',
  asyncRoute(async (req, res) => {
    const catalog = await economyOperation(() => getCatalog());
    return sendSuccess(req, res, catalog);
  })
);

economyApiRouter.get(
  '/wallet',
  asyncRoute(async (req, res) => {
    const wallet = await economyOperation(() => getWallet(canonicalUserId(req)));
    return sendSuccess(req, res, wallet);
  })
);

economyApiRouter.get(
  '/ledger',
  asyncRoute(async (req, res) => {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Ledger pagination is invalid.', parsed.error.issues);
    }

    const result = await economyOperation(() =>
      getLedger(canonicalUserId(req), parsed.data.cursor, parsed.data.limit)
    );
    return sendSuccess(req, res, { items: result.items }, { nextCursor: result.nextCursor });
  })
);

economyApiRouter.post(
  '/gifts',
  createInProcessRateLimit({
    keyPrefix: 'economy-gift-v1',
    windowMs: 60_000,
    maxRequests: 30,
  }),
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = giftSendSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Gift request is invalid.', parsed.error.issues);
    }
    assertBodyIdempotencyMatchesHeader(req, parsed.data.idempotencyKey);

    const result = await economyOperation(() => sendGift(canonicalUserId(req), parsed.data));
    return sendSuccess(req, res, {
      ...result.response,
      replayed: result.kind === 'replay',
    });
  })
);

economyApiRouter.post(
  '/purchases/verify',
  createInProcessRateLimit({
    keyPrefix: 'economy-purchase-v1',
    windowMs: 15 * 60_000,
    maxRequests: 20,
  }),
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = iapVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'Purchase verification request is invalid.', parsed.error.issues);
    }
    assertBodyIdempotencyMatchesHeader(req, parsed.data.idempotencyKey);

    const result = await economyOperation(() =>
      verifyIapPurchaseAndGrant(canonicalUserId(req), parsed.data)
    );
    return sendSuccess(req, res, {
      ...result.response,
      replayed: result.kind === 'replay',
    });
  })
);

export { economyApiRouter };
