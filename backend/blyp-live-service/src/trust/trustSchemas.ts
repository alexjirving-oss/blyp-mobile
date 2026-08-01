import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must use YYYY-MM-DD.');
const jurisdiction = z.string().regex(/^[A-Z]{2}$/, 'jurisdiction must be an ISO 3166-1 alpha-2 code.');
const policyVersion = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/);
const acceptanceSource = z.enum(['mobile', 'web', 'admin', 'migration']);

export const acceptConsentSchema = z
  .object({
    dateOfBirth: isoDate,
    jurisdiction,
    policyVersion,
    acceptanceSource,
  })
  .strict();

export const withdrawConsentSchema = z
  .object({
    policyVersion,
    acceptanceSource,
  })
  .strict();

export const privacyUpdateSchema = z
  .object({
    accountVisibility: z.enum(['public', 'followers', 'private']).optional(),
    contentVisibility: z.enum(['public', 'followers', 'private']).optional(),
    messagePermission: z.enum(['everyone', 'followers', 'nobody']).optional(),
    discoverability: z.enum(['discoverable', 'followers_only', 'hidden']).optional(),
    locationPrecision: z.enum(['off', 'approximate', 'precise']).optional(),
    allowPersonalization: z.boolean().optional(),
    allowAnalytics: z.boolean().optional(),
    allowAiTraining: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one privacy setting must be supplied.',
  });

const canonicalSubject = z.string().trim().min(1).max(256);
const reasonCode = z.string().trim().min(1).max(64).regex(/^[A-Z0-9_]+$/);

export const relationshipControlSchema = z
  .object({
    targetUserId: canonicalSubject,
    controlType: z.enum(['block', 'mute']),
    reasonCode: reasonCode.optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.controlType === 'block' && value.expiresAt !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Blocks cannot expire automatically.',
      });
    }
  });

export const policyDecisionSchema = z
  .object({
    targetUserId: canonicalSubject,
    capability: z.enum(['view', 'contact', 'discover', 'join', 'transact']),
    minimumAgeBand: z.enum(['under_13', '13_15', '16_17', '18_plus']).optional(),
  })
  .strict();

export type AcceptConsentInput = z.infer<typeof acceptConsentSchema>;
export type WithdrawConsentInput = z.infer<typeof withdrawConsentSchema>;
export type PrivacyUpdateInput = z.infer<typeof privacyUpdateSchema>;
export type RelationshipControlInput = z.infer<typeof relationshipControlSchema>;
export type PolicyDecisionInput = z.infer<typeof policyDecisionSchema>;
