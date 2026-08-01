import { Router } from 'express';
import type { ZodIssue } from 'zod';
import { cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { getEconomyInfra } from '../economy/infra';
import { ApiError, asyncRoute, sendSuccess, type PlatformRequest } from '../platform/apiContract';
import { isFeatureEnabled } from '../platform/featureFlags';
import { createInProcessRateLimit, requireClientVersion } from '../platform/gatewayMiddleware';
import {
  categoryListQuerySchema,
  categoryParamsSchema,
  feedQuerySchema,
  hashtagListQuerySchema,
  hashtagParamsSchema,
  searchQuerySchema,
} from './discoverySchemas';
import {
  listCategories,
  listFeedCandidates,
  listHashtags,
  searchCanonicalContent,
} from './discoveryService';

const DISCOVERY_FLAG = 'feed.discovery_v1';

function canonicalUserId(req: PlatformRequest): string {
  const userId = String(req.user?.sub || '').trim();
  if (!userId) throw new ApiError(401, 'UNAUTHENTICATED', 'A canonical authenticated user is required.');
  return userId;
}

function validationError(issues: ZodIssue[]): ApiError {
  return new ApiError(400, 'VALIDATION_FAILED', 'The discovery request is invalid.', {
    issues: issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
  });
}

async function requireDiscoveryApi(req: PlatformRequest): Promise<void> {
  const userId = canonicalUserId(req);
  const { db } = getEconomyInfra();
  if (!(await isFeatureEnabled(db, DISCOVERY_FLAG, userId))) {
    throw new ApiError(404, 'FEATURE_DISABLED', 'The requested discovery contract is not available.');
  }
}

async function requireCategory(categoryId: string): Promise<void> {
  const { db } = getEconomyInfra();
  const category = await db('content_categories').select('category_id').where({ category_id: categoryId, active: true }).first();
  if (!category) throw new ApiError(404, 'CONTENT_CATEGORY_NOT_FOUND', 'The category was not found.');
}

async function requireHashtag(tag: string): Promise<void> {
  const { db } = getEconomyInfra();
  const hashtag = await db('content_hashtags').select('hashtag_id').where({ tag }).first();
  if (!hashtag) throw new ApiError(404, 'CONTENT_HASHTAG_NOT_FOUND', 'The hashtag was not found.');
}

const discoveryRouter = Router();
discoveryRouter.use(requireClientVersion);
discoveryRouter.use(cognitoJwtMiddleware);
discoveryRouter.use(
  createInProcessRateLimit({ keyPrefix: 'discovery-v1', windowMs: 60_000, maxRequests: 180 })
);
discoveryRouter.use(
  asyncRoute(async (req, _res, next) => {
    await requireDiscoveryApi(req);
    next();
  })
);

discoveryRouter.get(
  '/feed',
  asyncRoute(async (req, res) => {
    const parsed = feedQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const result = await listFeedCandidates(canonicalUserId(req), parsed.data);
    return sendSuccess(
      req,
      res,
      { items: result.items, rankingVersion: result.rankingVersion },
      { nextCursor: result.nextCursor }
    );
  })
);

discoveryRouter.get(
  '/search',
  createInProcessRateLimit({ keyPrefix: 'discovery-search-v1', windowMs: 60_000, maxRequests: 60 }),
  asyncRoute(async (req, res) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const result = await searchCanonicalContent(canonicalUserId(req), parsed.data);
    return sendSuccess(req, res, { items: result.items }, { nextCursor: result.nextCursor });
  })
);

discoveryRouter.get(
  '/categories',
  asyncRoute(async (req, res) => {
    const parsed = categoryListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const result = await listCategories(parsed.data);
    return sendSuccess(req, res, { items: result.items }, { nextCursor: result.nextCursor });
  })
);

discoveryRouter.get(
  '/categories/:categoryId/posts',
  asyncRoute(async (req, res) => {
    const params = categoryParamsSchema.safeParse(req.params);
    const query = feedQuerySchema.safeParse(req.query);
    if (!params.success) throw validationError(params.error.issues);
    if (!query.success) throw validationError(query.error.issues);
    await requireCategory(params.data.categoryId);
    const result = await listFeedCandidates(canonicalUserId(req), {
      ...query.data,
      categoryId: params.data.categoryId,
    });
    return sendSuccess(
      req,
      res,
      { items: result.items, rankingVersion: result.rankingVersion },
      { nextCursor: result.nextCursor }
    );
  })
);

discoveryRouter.get(
  '/hashtags',
  asyncRoute(async (req, res) => {
    const parsed = hashtagListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const result = await listHashtags(canonicalUserId(req), parsed.data);
    return sendSuccess(req, res, { items: result.items }, { nextCursor: result.nextCursor });
  })
);

discoveryRouter.get(
  '/hashtags/:tag/posts',
  asyncRoute(async (req, res) => {
    const params = hashtagParamsSchema.safeParse(req.params);
    const query = feedQuerySchema.safeParse(req.query);
    if (!params.success) throw validationError(params.error.issues);
    if (!query.success) throw validationError(query.error.issues);
    await requireHashtag(params.data.tag);
    const result = await listFeedCandidates(canonicalUserId(req), {
      ...query.data,
      hashtag: params.data.tag,
    });
    return sendSuccess(
      req,
      res,
      { items: result.items, rankingVersion: result.rankingVersion },
      { nextCursor: result.nextCursor }
    );
  })
);

export { discoveryRouter };
