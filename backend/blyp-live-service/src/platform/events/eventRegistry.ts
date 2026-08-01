import { z } from 'zod';
import { ApiError } from '../apiContract';

const identityLinkedPayload = z.object({
  provider: z.literal('firebase'),
  legacyUserId: z.string().min(1).max(256),
  canonicalUserId: z.string().min(1).max(256),
  verificationMethod: z.literal('firebase_id_token'),
});

const identityLinkRevokedPayload = z.object({
  provider: z.literal('firebase'),
  legacyUserId: z.string().min(1).max(256),
  canonicalUserId: z.string().min(1).max(256),
});

const featureFlagUpdatedPayload = z.object({
  flagKey: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/),
  enabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100),
});

const trustConsentChangedPayload = z.object({
  userId: z.string().min(1).max(256),
  consentStatus: z.enum(['accepted', 'withdrawn']),
  policyVersion: z.string().min(1).max(64),
  ageBand: z.enum(['under_13', '13_15', '16_17', '18_plus']),
  jurisdiction: z.string().regex(/^[A-Z]{2}$/),
  profileVersion: z.number().int().positive(),
});

const trustPrivacyChangedPayload = z.object({
  userId: z.string().min(1).max(256),
  settingsVersion: z.number().int().positive(),
  changedFields: z.array(z.string().min(1).max(64)).min(1).max(8),
});

const trustRelationshipChangedPayload = z.object({
  actorUserId: z.string().min(1).max(256),
  targetUserId: z.string().min(1).max(256),
  controlType: z.enum(['block', 'mute']),
  action: z.enum(['added', 'removed']),
  reasonCode: z.string().min(1).max(64).nullable(),
  expiresAt: z.string().datetime().nullable(),
  controlVersion: z.number().int().positive(),
});

const eventSchemas = {
  'identity.linked.v1': identityLinkedPayload,
  'identity.link_revoked.v1': identityLinkRevokedPayload,
  'platform.feature_flag.updated.v1': featureFlagUpdatedPayload,
  'trust.consent.changed.v1': trustConsentChangedPayload,
  'trust.privacy.changed.v1': trustPrivacyChangedPayload,
  'trust.relationship.changed.v1': trustRelationshipChangedPayload,
} as const;

export type RegisteredEventType = keyof typeof eventSchemas;

export function validateEventVersion(eventType: string, eventVersion: number): void {
  const match = eventType.match(/\.v(\d+)$/);
  const registered = eventSchemas[eventType as RegisteredEventType];
  if (!registered || !match) {
    throw new ApiError(500, 'EVENT_TYPE_UNREGISTERED', `Event type is not registered: ${eventType}`);
  }
  if (!Number.isInteger(eventVersion) || Number(match[1]) !== eventVersion) {
    throw new ApiError(
      500,
      'EVENT_VERSION_MISMATCH',
      `Event version does not match the registered type: ${eventType}`
    );
  }
}

export function validateEventPayload(eventType: string, payload: unknown): Record<string, unknown> {
  const schema = eventSchemas[eventType as RegisteredEventType];
  if (!schema) {
    throw new ApiError(500, 'EVENT_TYPE_UNREGISTERED', `Event type is not registered: ${eventType}`);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(500, 'EVENT_PAYLOAD_INVALID', `Event payload is invalid: ${eventType}`, {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
    });
  }
  return parsed.data;
}

export function registeredEventTypes(): RegisteredEventType[] {
  return Object.keys(eventSchemas) as RegisteredEventType[];
}
