import { z } from 'zod';

const subjectSchema = z.string().trim().min(1).max(256);
const normalizedUsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/);
const optionalHttpsUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((value) => new URL(value).protocol === 'https:', 'Only HTTPS URLs are accepted.')
  .nullable()
  .optional();

export const contentVisibilitySchema = z.enum(['public', 'followers', 'private']);
export const postLifecycleStateSchema = z.enum([
  'draft',
  'pending_review',
  'published',
  'restricted',
  'rejected',
  'removed',
]);
export const mediaKindSchema = z.enum(['image', 'video', 'audio']);

export const contentProfileUpsertSchema = z
  .object({
    username: normalizedUsernameSchema,
    displayName: z.string().trim().min(1).max(80),
    bio: z.string().trim().max(500).default(''),
    avatarUrl: optionalHttpsUrl,
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict();

export const mediaInputSchema = z
  .object({
    clientAssetId: z.string().trim().min(1).max(128),
    kind: mediaKindSchema,
    url: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => new URL(value).protocol === 'https:', 'Only HTTPS media URLs are accepted.'),
    thumbnailUrl: optionalHttpsUrl,
    mimeType: z.string().trim().min(3).max(128).nullable().optional(),
    width: z.number().int().positive().max(32768).nullable().optional(),
    height: z.number().int().positive().max(32768).nullable().optional(),
    durationMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).nullable().optional(),
    altText: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.width === null || value.width === undefined) !== (value.height === null || value.height === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['width'],
        message: 'width and height must be supplied together.',
      });
    }
  });

const hashtagSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value) => value.replace(/^#/, '').toLocaleLowerCase('en-US'))
  .refine((value) => /^[\p{L}\p{N}_]+$/u.test(value), 'Hashtags may contain letters, numbers, and underscores only.');

const postFields = {
  title: z.string().trim().max(160).default(''),
  caption: z.string().trim().max(5000).default(''),
  visibility: contentVisibilitySchema.default('followers'),
  media: z.array(mediaInputSchema).max(10).default([]),
  categoryIds: z.array(z.string().uuid()).max(5).default([]),
  hashtags: z.array(hashtagSchema).max(20).default([]),
};

export const createPostSchema = z
  .object({
    ...postFields,
    publish: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.title && !value.caption && value.media.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['caption'],
        message: 'A post requires a title, caption, or media item.',
      });
    }
    if (new Set(value.media.map((item) => item.clientAssetId)).size !== value.media.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['media'],
        message: 'clientAssetId values must be unique within a post.',
      });
    }
    if (new Set(value.categoryIds).size !== value.categoryIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categoryIds'],
        message: 'categoryIds must be unique.',
      });
    }
    if (new Set(value.hashtags).size !== value.hashtags.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hashtags'],
        message: 'hashtags must be unique.',
      });
    }
  });

export const updatePostSchema = z
  .object({
    title: postFields.title.optional(),
    caption: postFields.caption.optional(),
    visibility: postFields.visibility.optional(),
    media: postFields.media.optional(),
    categoryIds: postFields.categoryIds.optional(),
    hashtags: postFields.hashtags.optional(),
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== 'expectedVersion'),
    'At least one mutable post field is required.'
  );

export const publishPostSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
  })
  .strict();

export const removePostSchema = z
  .object({
    expectedVersion: z.coerce.number().int().positive(),
    reasonCode: z.string().trim().min(1).max(64).default('AUTHOR_REMOVED'),
  })
  .strict();

export const moderationTransitionSchema = z
  .object({
    nextState: postLifecycleStateSchema,
    reasonCode: z.string().trim().min(1).max(64),
    expectedVersion: z.number().int().positive(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const authoredPostQuerySchema = z
  .object({
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    state: postLifecycleStateSchema.optional(),
  })
  .strict();

export const profileLookupParamsSchema = z.object({ userId: subjectSchema }).strict();
export const postLookupParamsSchema = z.object({ postId: z.string().uuid() }).strict();

export type ContentProfileUpsertInput = z.infer<typeof contentProfileUpsertSchema>;
export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type PublishPostInput = z.infer<typeof publishPostSchema>;
export type RemovePostInput = z.infer<typeof removePostSchema>;
export type ModerationTransitionInput = z.infer<typeof moderationTransitionSchema>;
export type AuthoredPostQuery = z.infer<typeof authoredPostQuerySchema>;
