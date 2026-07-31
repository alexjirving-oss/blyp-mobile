import { Router } from 'express';
import { z } from 'zod';
import { cognitoJwtMiddleware } from '../auth/cognitoJwtMiddleware';
import { verifyFirebaseIdToken } from '../config/firebaseAdmin';
import { getEconomyInfra } from '../economy/infra';
import { ApiError, asyncRoute, sendSuccess } from './apiContract';
import { registeredEventTypes } from './events/eventRegistry';
import { enqueueDomainEvent } from './events/outbox';
import { getEvaluatedFeatureFlags } from './featureFlags';
import { createInProcessRateLimit, requireClientVersion } from './gatewayMiddleware';
import { requireMutationIdempotency } from './idempotency';

const firebaseLinkBody = z.object({
  firebaseIdToken: z.string().min(100).max(8192),
});

const platformRouter = Router();
platformRouter.use(requireClientVersion);
platformRouter.use(cognitoJwtMiddleware);
platformRouter.use(
  createInProcessRateLimit({
    keyPrefix: 'platform-v1',
    windowMs: 60_000,
    maxRequests: 120,
  })
);

platformRouter.get(
  '/capabilities',
  asyncRoute(async (req, res) => {
    return sendSuccess(req, res, {
      apiVersion: 'v1',
      identityAuthority: 'cognito_sub',
      persistenceAuthority: 'postgresql',
      eventEnvelopeVersion: 1,
      registeredEventTypes: registeredEventTypes(),
    });
  })
);

platformRouter.get(
  '/feature-flags',
  asyncRoute(async (req, res) => {
    const { db } = getEconomyInfra();
    const flags = await getEvaluatedFeatureFlags(db, req.user!.sub);
    return sendSuccess(req, res, { flags });
  })
);

platformRouter.get(
  '/identity-links',
  asyncRoute(async (req, res) => {
    const { db } = getEconomyInfra();
    const rows = await db('identity_links')
      .select('provider', 'legacy_user_id', 'status', 'linked_at', 'verified_at', 'revoked_at')
      .where({ canonical_user_id: req.user!.sub })
      .orderBy('provider', 'asc');

    return sendSuccess(req, res, {
      links: rows.map((row) => ({
        provider: row.provider,
        legacyUserId: row.legacy_user_id,
        status: row.status,
        linkedAt: new Date(row.linked_at).toISOString(),
        verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      })),
    });
  })
);

platformRouter.post(
  '/identity-links/firebase',
  createInProcessRateLimit({
    keyPrefix: 'identity-link',
    windowMs: 15 * 60_000,
    maxRequests: 10,
  }),
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const parsed = firebaseLinkBody.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_FAILED', 'A valid Firebase ID token is required.');
    }

    let legacyClaims;
    try {
      legacyClaims = await verifyFirebaseIdToken(parsed.data.firebaseIdToken);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('[config]')) {
        throw new ApiError(503, 'LEGACY_IDENTITY_NOT_CONFIGURED', 'Legacy account linking is temporarily unavailable.');
      }
      throw new ApiError(401, 'LEGACY_PROOF_INVALID', 'The Firebase identity proof is invalid or expired.');
    }

    const legacyUserId = String(legacyClaims.uid || '').trim();
    if (!legacyUserId) {
      throw new ApiError(401, 'LEGACY_PROOF_INVALID', 'The Firebase identity proof has no user identifier.');
    }

    const { db } = getEconomyInfra();
    const canonicalUserId = req.user!.sub;
    const result = await db.transaction(async (trx) => {
      const [legacyOwner, canonicalLink] = await Promise.all([
        trx('identity_links').where({ provider: 'firebase', legacy_user_id: legacyUserId }).forUpdate().first(),
        trx('identity_links').where({ provider: 'firebase', canonical_user_id: canonicalUserId }).forUpdate().first(),
      ]);

      if (legacyOwner && legacyOwner.canonical_user_id !== canonicalUserId) {
        throw new ApiError(409, 'LEGACY_IDENTITY_ALREADY_LINKED', 'This legacy identity is already linked to another account.');
      }
      if (canonicalLink && canonicalLink.legacy_user_id !== legacyUserId) {
        throw new ApiError(409, 'CANONICAL_IDENTITY_ALREADY_LINKED', 'This account is already linked to another legacy identity.');
      }

      const alreadyVerified = legacyOwner?.status === 'verified';
      if (!alreadyVerified) {
        await trx('identity_links')
          .insert({
            provider: 'firebase',
            legacy_user_id: legacyUserId,
            canonical_user_id: canonicalUserId,
            status: 'verified',
            verification_method: 'firebase_id_token',
            metadata: JSON.stringify({ firebaseProjectId: legacyClaims.firebase?.sign_in_provider || null }),
            linked_at: trx.fn.now(),
            verified_at: trx.fn.now(),
            revoked_at: null,
          })
          .onConflict(['provider', 'legacy_user_id'])
          .merge({
            canonical_user_id: canonicalUserId,
            status: 'verified',
            verification_method: 'firebase_id_token',
            verified_at: trx.fn.now(),
            revoked_at: null,
          });

        await enqueueDomainEvent(trx, {
          eventType: 'identity.linked.v1',
          eventVersion: 1,
          aggregate: { type: 'user', id: canonicalUserId },
          actorUserId: canonicalUserId,
          correlationId: req.context!.correlationId,
          payload: {
            provider: 'firebase',
            legacyUserId,
            canonicalUserId,
            verificationMethod: 'firebase_id_token',
          },
        });
      }

      return { legacyUserId, linked: !alreadyVerified };
    });

    return sendSuccess(req, res, result, { status: result.linked ? 201 : 200 });
  })
);

platformRouter.delete(
  '/identity-links/firebase',
  requireMutationIdempotency,
  asyncRoute(async (req, res) => {
    const { db } = getEconomyInfra();
    const canonicalUserId = req.user!.sub;
    const result = await db.transaction(async (trx) => {
      const link = await trx('identity_links')
        .where({ provider: 'firebase', canonical_user_id: canonicalUserId, status: 'verified' })
        .forUpdate()
        .first();
      if (!link) {
        throw new ApiError(404, 'IDENTITY_LINK_NOT_FOUND', 'No active Firebase identity link exists.');
      }

      await trx('identity_links')
        .where({ provider: 'firebase', canonical_user_id: canonicalUserId })
        .update({ status: 'revoked', revoked_at: trx.fn.now() });
      await enqueueDomainEvent(trx, {
        eventType: 'identity.link_revoked.v1',
        eventVersion: 1,
        aggregate: { type: 'user', id: canonicalUserId },
        actorUserId: canonicalUserId,
        correlationId: req.context!.correlationId,
        payload: {
          provider: 'firebase',
          legacyUserId: link.legacy_user_id,
          canonicalUserId,
        },
      });
      return { provider: 'firebase', legacyUserId: link.legacy_user_id, status: 'revoked' };
    });

    return sendSuccess(req, res, result);
  })
);

export { platformRouter };
