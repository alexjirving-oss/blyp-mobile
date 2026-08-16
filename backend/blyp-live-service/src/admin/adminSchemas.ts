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

/** Owner launch-test gem credit (gem_available) — target from route param. */
export const adminCreditGemsBodySchema = z.object({
    gems: z.coerce.number().int().min(1).max(5_000),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
    reason: z.string().trim().min(1).max(200).optional(),
});

export const adminListReportsSchema = z.object({
    status: z.enum(['open', 'resolved', 'dismissed', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    reasonCode: z.string().trim().max(80).optional(),
});

export const adminResolveReportSchema = z.object({
    status: z.enum(['resolved', 'dismissed']),
    note: z.string().trim().max(500).optional(),
});

export const adminListWithdrawalsSchema = z.object({
    status: z
        .enum(['pending_review', 'pending', 'processing', 'paid', 'failed', 'rejected', 'all'])
        .default('pending_review'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

export const adminRejectWithdrawalSchema = z.object({
    reason: z.string().trim().min(1).max(500).optional(),
});

export const adminSetFeatureFlagsSchema = z.object({
    flags: z.record(z.string(), z.coerce.boolean()),
});

export const adminSetGiftEnabledSchema = z.object({
    enabled: z.coerce.boolean(),
});

export const adminListCommsMessagesSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

export const adminBroadcastMessageSchema = z.object({
    segment: z.enum(['all', 'active', 'banned']),
    subject: z.string().trim().max(200).nullable().optional(),
    message: z.string().trim().min(1).max(4000),
    deepLink: z.string().trim().max(500).nullable().optional(),
});

export const adminListLiveSchema = z.object({
    status: z.enum(['live', 'ended']).optional(),
});

export const adminListGlobalPostsSchema = z.object({
    q: z.string().trim().max(240).optional(),
    removed: z.enum(['all', 'live', 'removed']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});

export const adminSetStreamingConfigSchema = z.object({
    enabled: z.coerce.boolean(),
    reason: z.string().trim().max(500).optional(),
});

export const adminForceEndLiveSchema = z.object({
    reason: z.string().trim().max(500).optional(),
    /** Optional: also ban the stream host after force-end. */
    banHost: z.coerce.boolean().optional(),
    banReason: z.string().trim().max(500).optional(),
    hostUserId: z.string().trim().min(1).max(128).optional(),
});

export const adminApproveTeamApplicationSchema = z.object({
    teamName: z.string().trim().max(120).optional(),
    teamDesc: z.string().trim().max(500).optional(),
});

export const adminRejectTeamApplicationSchema = z.object({
    reason: z.string().trim().max(500).optional(),
});

export const adminListLedgerSchema = z.object({
    userId: cognitoSubSchema.optional(),
    ledgerId: z.string().trim().min(1).max(128).optional(),
    referenceId: z.string().trim().min(1).max(128).optional(),
    /** Exact entry_type or alias: credit|debit|gift|purchase|admin|iap */
    entryType: z.string().trim().max(80).optional(),
    cursor: z.string().trim().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminListIapPurchasesSchema = z.object({
    userId: cognitoSubSchema.optional(),
    platform: z.enum(['IOS', 'ANDROID', 'ios', 'android']).optional(),
    sku: z.string().trim().max(120).optional(),
    q: z.string().trim().max(120).optional(),
    cursor: z.string().trim().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminBanCacheProbeSchema = z.object({
    userId: cognitoSubSchema.optional(),
});

export const adminAuditExportSchema = z.object({
    q: z.string().trim().max(120).optional(),
    action: z.string().trim().max(80).optional(),
    /** Max rows for CSV (paged internally). */
    limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export const adminFraudSignalsSchema = z.object({
    hours: z.coerce.number().int().min(1).max(168).default(24),
    minGifts: z.coerce.number().int().min(2).max(100).default(8),
    limit: z.coerce.number().int().min(1).max(50).default(25),
});

export const adminListPromotionsSchema = z.object({
    status: z.enum(['active', 'pending', 'ended', 'cancelled', 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminAddStrikeSchema = z.object({
    reason: z.string().trim().min(1).max(500),
    surface: z.string().trim().max(80).nullable().optional(),
    relatedReportId: z.string().trim().max(120).nullable().optional(),
});

export const adminCreateAppealSchema = z.object({
    userId: cognitoSubSchema,
    statement: z.string().trim().min(1).max(4000),
    strikeId: z.string().trim().max(64).nullable().optional(),
});

export const adminResolveAppealSchema = z.object({
    status: z.enum(['upheld', 'overturned', 'dismissed']),
    note: z.string().trim().max(500).optional(),
});

export const adminListAppealsSchema = z.object({
    status: z.enum(['open', 'upheld', 'overturned', 'dismissed', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const adminAutoModPolicySchema = z.object({
    autoHideThreshold: z.coerce.number().int().min(1).max(50).optional(),
    criticalHideReporters: z.coerce.number().int().min(1).max(20).optional(),
    seriousHideReports: z.coerce.number().int().min(1).max(20).optional(),
    visionFailClosed: z.coerce.boolean().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
});

export const adminMassBanSchema = z.object({
    userIds: z.array(cognitoSubSchema).min(1).max(25),
    reason: z.string().trim().min(3).max(500),
    dryRun: z.coerce.boolean().default(true),
    confirmPhrase: z.string().trim().max(40).optional(),
});

export const adminFraudFlagsSchema = z.object({
    openChargebackCount: z.coerce.number().int().min(0).max(99).optional(),
    accountFrozen: z.coerce.boolean().optional(),
    underFraudReview: z.coerce.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional(),
});

export const adminDsarPurgeSchema = z.object({
    confirmPhrase: z.string().trim().min(1).max(40),
    confirmUserId: cognitoSubSchema,
});

export const adminGameDisputeCreateSchema = z.object({
    surface: z.enum(['battle', 'marble', 'live_game', 'other']).default('battle'),
    referenceId: z.string().trim().min(1).max(128),
    summary: z.string().trim().min(3).max(500),
    notes: z.string().trim().max(2000).nullable().optional(),
});

export const adminGameDisputeStatusSchema = z.object({
    status: z.enum(['open', 'investigating', 'noted_freeze', 'resolved', 'closed']),
    notes: z.string().trim().max(2000).nullable().optional(),
});

export const adminListScheduledPostsSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(80),
    status: z.enum(['scheduled', 'paused', 'all']).default('all'),
    userId: z.string().trim().min(1).max(128).optional(),
});

export const adminScheduledPostActionSchema = z.object({
    action: z.enum(['publish_now', 'pause', 'cancel', 'reschedule']),
    publishAt: z.coerce.number().int().positive().optional(),
});

export const adminCreateSocialImportSchema = z.object({
    uid: z.string().trim().min(8).max(128),
    platform: z.enum(['tiktok', 'youtube']).default('tiktok'),
    handle: z.string().trim().min(2).max(120),
    stagger: z
        .object({
            enabled: z.boolean().optional(),
            postsPerDay: z.coerce.number().int().min(1).max(48).optional(),
            intervalMs: z.coerce.number().int().min(60_000).max(7 * 24 * 60 * 60 * 1000).optional(),
            startAt: z.coerce.number().int().positive().optional(),
            jitterMs: z.coerce.number().int().min(0).max(2 * 60 * 60 * 1000).optional(),
        })
        .optional(),
});

const marketingNetworkSchema = z.enum(['facebook', 'instagram', 'tiktok', 'snapchat']);

export const adminMarketingMetaStartSchema = z.object({
    network: z.enum(['facebook', 'instagram']),
});

export const adminMarketingDisconnectSchema = z.object({
    network: marketingNetworkSchema,
});

export const adminMarketingScheduleSchema = z.object({
    enabled: z.coerce.boolean().optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7).optional(),
    timesLocal: z
        .array(z.string().regex(/^\d{2}:\d{2}$/))
        .min(1)
        .max(12)
        .optional(),
    sourceMode: z.enum(['recent_public', 'featured', 'promo_template', 'manual']).optional(),
    captionTemplate: z.string().trim().max(2000).nullable().optional(),
    networks: z.array(marketingNetworkSchema).min(1).max(8).optional(),
});

export const adminMarketingEnqueueSchema = z.object({
    networks: z.array(marketingNetworkSchema).min(1).max(8),
    sourceType: z.enum(['blyp_post', 'promo_template', 'manual']),
    sourceId: z.string().trim().min(1).max(128).nullable().optional(),
    caption: z.string().trim().max(2200).nullable().optional(),
    mediaUrl: z.string().trim().url().max(2000).nullable().optional(),
    linkUrl: z.string().trim().url().max(2000).nullable().optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
});

export const adminMarketingQueueListSchema = z.object({
    status: z.enum(['all', 'scheduled', 'publishing', 'published', 'failed', 'cancelled']).default('all'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});
