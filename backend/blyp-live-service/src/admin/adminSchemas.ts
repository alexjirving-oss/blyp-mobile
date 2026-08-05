import { z } from 'zod';
import { COGNITO_SUB_REGEX } from '../auth/cognitoSub';

const cognitoSubSchema = z
    .string()
    .trim()
    .regex(COGNITO_SUB_REGEX, 'must be a Cognito sub');

export const adminListUsersSchema = z.object({
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const banUserSchema = z.object({
    // Dashboard sends null for empty optional fields; accept null or omit.
    reason: z.string().trim().min(1).max(500).nullable().optional(),
    bannedUntil: z.string().datetime().nullable().optional(),
});

export const unbanUserSchema = z.object({
    reason: z.string().trim().min(1).max(500).nullable().optional(),
});

export const adminListAuditSchema = z.object({
    q: z.string().trim().max(120).optional(),
    action: z.string().trim().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

export const adminListUserPostsSchema = z.object({
    q: z.string().trim().max(240).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const moderatePostSchema = z.object({
    reason: z.string().trim().min(1).max(500).optional(),
    userId: cognitoSubSchema.optional(),
});

/**
 * Per-post For You priority (writes Firestore posts.feedPriority).
 * Canonical 5 tiers; `less` accepted as alias for `low`.
 */
export const adminFeedPrioritySchema = z.object({
    priority: z.enum(['suppress', 'low', 'less', 'standard', 'high', 'boost']),
    reason: z.string().trim().min(1).max(500).optional(),
});

/**
 * Account-wide For You / discovery weight (writes users.feedPriorityAccount
 * + Postgres user_admin_state.metadata.feedPriorityAccount).
 */
export const adminAccountFeedPrioritySchema = z.object({
    priority: z.enum(['suppress', 'low', 'standard', 'high', 'boost']),
    reason: z.string().trim().min(1).max(500).optional(),
});

export const adminSetCapabilitiesSchema = z.object({
    verified: z.coerce.boolean().default(false),
    role: z.enum(['user', 'admin', 'manager']).optional(),
    verificationNote: z.string().trim().max(500).nullable().optional(),
    messagingRestricted: z.coerce.boolean().default(false),
    liveRestricted: z.coerce.boolean().default(false),
    loginRestricted: z.coerce.boolean().default(false),
    accountRestricted: z.coerce.boolean().default(false),
    reason: z.string().trim().max(500).nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    // Dashboard PersonDetail sends avatarFrame; null/"" clears. Keep catalog tiny.
    avatarFrame: z.union([z.literal('gold_crown'), z.literal(''), z.null()]).optional(),
});

export const adminQueueUserMessageSchema = z.object({
    subject: z.string().trim().max(200).nullable().optional(),
    channel: z.enum(['in_app', 'email']).default('in_app'),
    message: z.string().trim().min(1).max(4000),
});

export const adminSetAppVersionPolicySchema = z.object({
    enabled: z.coerce.boolean(),
    minimumAndroidVersionCode: z.coerce.number().int().positive().nullable().optional(),
    message: z.string().trim().min(1).max(280).optional(),
    storeUrl: z.string().trim().url().max(500).optional(),
}).superRefine((value, ctx) => {
    if (value.enabled && !value.minimumAndroidVersionCode) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['minimumAndroidVersionCode'],
            message: 'A positive minimum Android version code is required when enforcement is enabled.',
        });
    }
});

/** Dashboard coin credit — targetUserId comes from the route param. */
export const adminCreditCoinsBodySchema = z.object({
    coins: z.coerce.number().int().min(1).max(1_000_000),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
    reason: z.string().trim().min(1).max(200).optional(),
});

export const adminListReportsSchema = z.object({
    status: z.enum(['open', 'resolved', 'dismissed', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminResolveReportSchema = z.object({
    status: z.enum(['resolved', 'dismissed']),
    note: z.string().trim().max(500).optional(),
});
