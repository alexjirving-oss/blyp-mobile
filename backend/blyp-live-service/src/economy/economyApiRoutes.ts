import { Router } from 'express';
import { cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import {
  ApiError,
  asyncRoute,
  sendSuccess,
  type ApiErrorDetails,
  type PlatformRequest,
} from '../platform/apiContract';
import {
  createInProcessRateLimit,
  requireClientVersion,
} from '../platform/gatewayMiddleware';
import { requireMutationIdempotency } from '../platform/idempotency';
import { isFeatureEnabled } from '../platform/featureFlags';
import { getEconomyInfra } from './infra';
import {
  giftSendSchema,
  iapVerifySchema,
  paginationSchema,
  quotaReservationParamsSchema,
  quotaReserveSchema,
  quotaResolutionSchema,
} from './economySchemas';
import { toEconomyError } from './economyErrors';
import {
  getCatalog,
  getLedger,
  getWallet,
  sendGift,
  verifyIapPurchaseAndGrant,
} from './economyService';
import {
  commitQuotaReservation,
  getEntitlementSnapshot,
  refundQuotaReservation,
  reserveQuota,
} from './entitlementService';

const ENTITLEMENTS_FLAG = 'economy.entitlements_v1';
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

const requireEntitlementApi = asyncRoute(async (req, _res, next) => {
  const userId = canonicalUserId(req);
  const { db } = getEconomyInfra();
  if (!(await isFeatureEnabled(db, ENTITLEMENTS_FLAG, userId))) {
    throw new ApiError(404, 'FEATURE_DISABLED', 'The requested entitlement contract is not available.');
  }
  next();
});

const quotaMutationRateLimit = createInProcessRateLimit({
  keyPrefix: 'economy-quota-v1',
  windowMs: 60_000,
  maxRequests: 60,
});

function quotaValidationError(message: string, issues: ApiErrorDetails): ApiError {
  return new ApiError(400, 'VALIDATION_FAILED', message, issues);
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

economyApiRouter.get(
  '/entitlements',
  requireEntitlementApi,
  asyncRoute(async (req, res) => {
    const result = await economyOperation(() =>
      getEntitlementSnapshot(canonicalUserId(req), req.context!.correlationId)
    );
    return sendSuccess(req, res, result);
  })
);

economyApiRouter.post(
  '/quota/reservations',
  requireEntitlementApi,
  quotaMutationRateLimit,
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = quotaReserveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw quotaValidationError('Quota reservation request is invalid.', parsed.error.issues);
    }
    assertBodyIdempotencyMatchesHeader(req, parsed.data.idempotencyKey);
    const result = await economyOperation(() =>
      reserveQuota(canonicalUserId(req), parsed.data, req.context!.correlationId)
    );
    return sendSuccess(
      req,
      res,
      { reservation: result.reservation, quota: result.quota, replayed: result.kind === 'replay' },
      { status: result.kind === 'replay' ? 200 : 201 }
    );
  })
);

economyApiRouter.post(
  '/quota/reservations/:reservationId/commit',
  requireEntitlementApi,
  quotaMutationRateLimit,
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const params = quotaReservationParamsSchema.safeParse(req.params);
    const body = quotaResolutionSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      throw quotaValidationError('Quota commit request is invalid.', {
        params: params.success ? [] : params.error.issues,
        body: body.success ? [] : body.error.issues,
      });
    }
    assertBodyIdempotencyMatchesHeader(req, body.data.idempotencyKey);
    const result = await economyOperation(() =>
      commitQuotaReservation(
        canonicalUserId(req),
        params.data.reservationId,
        body.data,
        req.context!.correlationId
      )
    );
    return sendSuccess(req, res, {
      reservation: result.reservation,
      quota: result.quota,
      replayed: result.kind === 'replay',
    });
  })
);

economyApiRouter.post(
  '/quota/reservations/:reservationId/refund',
  requireEntitlementApi,
  quotaMutationRateLimit,
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const params = quotaReservationParamsSchema.safeParse(req.params);
    const body = quotaResolutionSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      throw quotaValidationError('Quota refund request is invalid.', {
        params: params.success ? [] : params.error.issues,
        body: body.success ? [] : body.error.issues,
      });
    }
    assertBodyIdempotencyMatchesHeader(req, body.data.idempotencyKey);
    const result = await economyOperation(() =>
      refundQuotaReservation(
        canonicalUserId(req),
        params.data.reservationId,
        body.data,
        req.context!.correlationId
      )
    );
    return sendSuccess(req, res, {
      reservation: result.reservation,
      quota: result.quota,
      replayed: result.kind === 'replay',
    });
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
