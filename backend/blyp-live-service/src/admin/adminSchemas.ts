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

export const adminUpdateUserCapabilitiesSchema = z
    .object({
        verified: z.boolean().optional(),
        verificationNote: z.string().trim().max(500).optional(),
        messagingRestricted: z.boolean().optional(),
        liveRestricted: z.boolean().optional(),
        accountRestricted: z.boolean().optional(),
        reason: z.string().trim().max(500).optional(),
        expiresAt: z.string().datetime().optional(),
    })
    .refine(
        (v) =>
            v.verified !== undefined ||
            v.verificationNote !== undefined ||
            v.messagingRestricted !== undefined ||
            v.liveRestricted !== undefined ||
            v.accountRestricted !== undefined ||
            v.reason !== undefined ||
            v.expiresAt !== undefined,
        { message: 'At least one capability field is required' }
    );

export const adminDirectMessageSchema = z.object({
    subject: z.string().trim().max(180).optional(),
    message: z.string().trim().min(1).max(4000),
    channel: z.enum(['in_app', 'email']).default('in_app'),
});
