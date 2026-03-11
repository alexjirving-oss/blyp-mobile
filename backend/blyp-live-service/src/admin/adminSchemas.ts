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
