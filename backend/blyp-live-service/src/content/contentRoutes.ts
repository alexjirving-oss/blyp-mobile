import { Router } from 'express';
import type { ZodIssue } from 'zod';
import { cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { getEconomyInfra } from '../economy/infra';
import { ApiError, asyncRoute, sendSuccess, type PlatformRequest } from '../platform/apiContract';
import { isFeatureEnabled } from '../platform/featureFlags';
import { createInProcessRateLimit, requireClientVersion } from '../platform/gatewayMiddleware';
import { requireMutationIdempotency } from '../platform/idempotency';
import {
  authoredPostQuerySchema,
  contentProfileUpsertSchema,
  createPostSchema,
  postLookupParamsSchema,
  profileLookupParamsSchema,
  publishPostSchema,
  removePostSchema,
  updatePostSchema,
} from './contentSchemas';
import {
  createPost,
  getContentProfile,
  getOwnPost,
  getPublishedPost,
  listOwnPosts,
  publishPost,
  removePost,
  updatePost,
  upsertContentProfile,
} from './contentService';

const CONTENT_FLAG = 'content.api_v1';

function canonicalUserId(req: PlatformRequest): string {
  const userId = String(req.user?.sub || '').trim();
  if (!userId) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'A canonical authenticated user is required.');
  }
  return userId;
}

function validationError(issues: ZodIssue[]): ApiError {
  return new ApiError(400, 'VALIDATION_FAILED', 'The content request is invalid.', {
    issues: issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
  });
}

async function requireContentApi(req: PlatformRequest): Promise<void> {
  const userId = canonicalUserId(req);
  const { db } = getEconomyInfra();
  if (!(await isFeatureEnabled(db, CONTENT_FLAG, userId))) {
    throw new ApiError(404, 'FEATURE_DISABLED', 'The requested content contract is not available.');
  }
}

const contentRouter = Router();
contentRouter.use(requireClientVersion);
contentRouter.use(cognitoJwtMiddleware);
contentRouter.use(
  createInProcessRateLimit({
    keyPrefix: 'content-v1',
    windowMs: 60_000,
    maxRequests: 180,
  })
);
contentRouter.use(
  asyncRoute(async (req, _res, next) => {
    await requireContentApi(req);
    next();
  })
);

contentRouter.put(
  '/profiles/me',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = contentProfileUpsertSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const result = await upsertContentProfile(
      canonicalUserId(req),
      parsed.data,
      req.context!.correlationId
    );
    return sendSuccess(req, res, { profile: result.profile }, { status: result.created ? 201 : 200 });
  })
);

contentRouter.get(
  '/profiles/:userId',
  asyncRoute(async (req, res) => {
    const parsed = profileLookupParamsSchema.safeParse(req.params);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const profile = await getContentProfile(canonicalUserId(req), parsed.data.userId);
    return sendSuccess(req, res, { profile });
  })
);

contentRouter.get(
  '/me/posts',
  asyncRoute(async (req, res) => {
    const parsed = authoredPostQuerySchema.safeParse(req.query);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const result = await listOwnPosts(canonicalUserId(req), parsed.data);
    return sendSuccess(req, res, { items: result.items }, { nextCursor: result.nextCursor });
  })
);

contentRouter.get(
  '/me/posts/:postId',
  asyncRoute(async (req, res) => {
    const parsed = postLookupParamsSchema.safeParse(req.params);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const post = await getOwnPost(canonicalUserId(req), parsed.data.postId);
    return sendSuccess(req, res, { post });
  })
);

contentRouter.get(
  '/posts/:postId',
  asyncRoute(async (req, res) => {
    const parsed = postLookupParamsSchema.safeParse(req.params);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const post = await getPublishedPost(canonicalUserId(req), parsed.data.postId);
    return sendSuccess(req, res, { post });
  })
);

contentRouter.post(
  '/posts',
  createInProcessRateLimit({ keyPrefix: 'content-create-v1', windowMs: 60_000, maxRequests: 20 }),
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = createPostSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const post = await createPost(canonicalUserId(req), parsed.data, req.context!.correlationId);
    return sendSuccess(req, res, { post }, { status: 201 });
  })
);

contentRouter.patch(
  '/posts/:postId',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const params = postLookupParamsSchema.safeParse(req.params);
    const body = updatePostSchema.safeParse(req.body);
    if (!params.success) throw validationError(params.error.issues);
    if (!body.success) throw validationError(body.error.issues);
    const post = await updatePost(
      canonicalUserId(req),
      params.data.postId,
      body.data,
      req.context!.correlationId
    );
    return sendSuccess(req, res, { post });
  })
);

contentRouter.post(
  '/posts/:postId/publish',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const params = postLookupParamsSchema.safeParse(req.params);
    const body = publishPostSchema.safeParse(req.body);
    if (!params.success) throw validationError(params.error.issues);
    if (!body.success) throw validationError(body.error.issues);
    const post = await publishPost(
      canonicalUserId(req),
      params.data.postId,
      body.data.expectedVersion,
      req.context!.correlationId
    );
    return sendSuccess(req, res, { post });
  })
);

contentRouter.delete(
  '/posts/:postId',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const params = postLookupParamsSchema.safeParse(req.params);
    const body = removePostSchema.safeParse(req.body);
    if (!params.success) throw validationError(params.error.issues);
    if (!body.success) throw validationError(body.error.issues);
    const post = await removePost(
      canonicalUserId(req),
      params.data.postId,
      body.data,
      req.context!.correlationId
    );
    return sendSuccess(req, res, { post });
  })
);

export { contentRouter };
