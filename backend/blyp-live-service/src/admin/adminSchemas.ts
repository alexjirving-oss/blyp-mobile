import { z } from 'zod';

export const adminListUsersSchema = z.object({
    q: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const banUserSchema = z.object({
    reason: z.string().trim().min(1).max(500).optional(),
    bannedUntil: z.string().datetime().optional(),
});

export const unbanUserSchema = z.object({
    reason: z.string().trim().min(1).max(500).optional(),
});

export const adminListUserPostsSchema = z.object({
    q: z.string().trim().max(240).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const moderatePostSchema = z.object({
    reason: z.string().trim().min(1).max(500).optional(),
    userId: z.string().trim().min(1).max(200).optional(),
});

export const adminSetCapabilitiesSchema = z.object({
    verified: z.coerce.boolean().default(false),
    role: z.enum(['user', 'admin', 'manager']).optional(),
    verificationNote: z.string().trim().max(500).optional(),
    messagingRestricted: z.coerce.boolean().default(false),
    liveRestricted: z.coerce.boolean().default(false),
    loginRestricted: z.coerce.boolean().default(false),
    accountRestricted: z.coerce.boolean().default(false),
    reason: z.string().trim().max(500).optional(),
    expiresAt: z.string().datetime().optional(),
});

export const adminCreditCoinsSchema = z.object({
    coins: z.coerce.number().int().min(1).max(1_000_000),
    reason: z.string().trim().max(200).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    // Admin's own login password, re-entered to authorise this sensitive action.
    password: z.string().min(1).max(200),
});

export const adminQueueUserMessageSchema = z.object({
    subject: z.string().trim().max(200).optional(),
    channel: z.enum(['in_app', 'email']).default('in_app'),
    message: z.string().trim().min(1).max(4000),
});

export const adminListPostsSchema = z.object({
    q: z.string().trim().max(240).optional(),
    postType: z.string().trim().max(60).optional(),
    removed: z.enum(['all', 'removed', 'live']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const adminListLiveSchema = z.object({
    status: z.enum(['live', 'ended']).optional(),
});

export const adminBroadcastSchema = z.object({
    segment: z.enum(['all', 'active', 'banned']).default('all'),
    subject: z.string().trim().max(200).optional(),
    message: z.string().trim().min(1).max(4000),
});

export const adminListMessagesSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

export const adminSetFlagsSchema = z.object({
    flags: z.record(z.string(), z.coerce.boolean()),
});

export const adminSetGiftSchema = z.object({
    enabled: z.coerce.boolean(),
});

export const adminListAuditSchema = z.object({
    q: z.string().trim().max(240).optional(),
    action: z.string().trim().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
