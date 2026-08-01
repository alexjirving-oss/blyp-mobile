import { Router } from 'express';
import { cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { ApiError, asyncRoute, sendSuccess } from '../platform/apiContract';
import { createInProcessRateLimit, requireClientVersion } from '../platform/gatewayMiddleware';
import { requireMutationIdempotency } from '../platform/idempotency';
import {
  acceptConsentSchema,
  policyDecisionSchema,
  privacyUpdateSchema,
  relationshipControlSchema,
  withdrawConsentSchema,
} from './trustSchemas';
import {
  acceptConsent,
  getTrustSnapshot,
  updatePrivacySettings,
  withdrawConsent,
} from './trustService';
import {
  evaluateTrustPolicy,
  listRelationshipControls,
  removeRelationshipControl,
  setRelationshipControl,
  type RelationshipControlType,
} from './trustRelationshipService';

function validationError(issues: { path: PropertyKey[]; code: string }[]): ApiError {
  return new ApiError(400, 'VALIDATION_FAILED', 'The Trust request body is invalid.', {
    issues: issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
  });
}

const trustRouter = Router();
trustRouter.use(requireClientVersion);
trustRouter.use(cognitoJwtMiddleware);
trustRouter.use(
  createInProcessRateLimit({
    keyPrefix: 'trust-v1',
    windowMs: 60_000,
    maxRequests: 120,
  })
);

trustRouter.get(
  '/me',
  asyncRoute(async (req, res) => {
    const snapshot = await getTrustSnapshot(req.user!.sub);
    return sendSuccess(req, res, snapshot);
  })
);

trustRouter.post(
  '/me/consent/accept',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = acceptConsentSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const state = await acceptConsent(req.user!.sub, parsed.data, req.context!.correlationId);
    return sendSuccess(req, res, state);
  })
);

trustRouter.post(
  '/me/consent/withdraw',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = withdrawConsentSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const profile = await withdrawConsent(req.user!.sub, parsed.data, req.context!.correlationId);
    return sendSuccess(req, res, { profile });
  })
);

trustRouter.post(
  '/me/privacy',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = privacyUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const privacy = await updatePrivacySettings(req.user!.sub, parsed.data, req.context!.correlationId);
    return sendSuccess(req, res, { privacy });
  })
);

trustRouter.get(
  '/me/relationships',
  asyncRoute(async (req, res) => {
    const rawType = req.query.type;
    if (rawType !== undefined && rawType !== 'block' && rawType !== 'mute') {
      throw new ApiError(400, 'CONTROL_TYPE_INVALID', 'type must be block or mute.');
    }
    const controls = await listRelationshipControls(
      req.user!.sub,
      rawType as RelationshipControlType | undefined
    );
    return sendSuccess(req, res, { controls });
  })
);

trustRouter.post(
  '/me/relationships',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = relationshipControlSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const control = await setRelationshipControl(
      req.user!.sub,
      parsed.data,
      req.context!.correlationId
    );
    return sendSuccess(req, res, { control });
  })
);

trustRouter.delete(
  '/me/relationships/:controlType/:targetUserId',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const controlType = req.params.controlType;
    if (controlType !== 'block' && controlType !== 'mute') {
      throw new ApiError(400, 'CONTROL_TYPE_INVALID', 'controlType must be block or mute.');
    }
    const result = await removeRelationshipControl(
      req.user!.sub,
      req.params.targetUserId,
      controlType,
      req.context!.correlationId
    );
    return sendSuccess(req, res, result);
  })
);

trustRouter.post(
  '/decisions',
  asyncRoute(async (req, res) => {
    const parsed = policyDecisionSchema.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error.issues);
    const decision = await evaluateTrustPolicy(req.user!.sub, parsed.data);
    return sendSuccess(req, res, { decision });
  })
);

export { trustRouter };
