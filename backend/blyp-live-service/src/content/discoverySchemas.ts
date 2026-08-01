import { z } from 'zod';

export const feedQuerySchema = z
  .object({
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    mediaKind: z.enum(['image', 'video', 'audio']).optional(),
    categoryId: z.string().uuid().optional(),
    hashtag: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .transform((value) => value.replace(/^#/, '').toLocaleLowerCase('en-US'))
      .refine((value) => /^[\p{L}\p{N}_]+$/u.test(value), 'The hashtag is invalid.')
      .optional(),
  })
  .strict();

export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(40).default(20),
    types: z
      .string()
      .trim()
      .default('profile,post,category,hashtag')
      .transform((value) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))])
      .refine(
        (values) =>
          values.length > 0 &&
          values.length <= 4 &&
          values.every((value) => ['profile', 'post', 'category', 'hashtag'].includes(value)),
        'types contains an unsupported search type.'
      ),
  })
  .strict();

export const categoryListQuerySchema = z
  .object({
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const categoryParamsSchema = z.object({ categoryId: z.string().uuid() }).strict();

export const hashtagListQuerySchema = z
  .object({
    cursor: z.string().max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const hashtagParamsSchema = z
  .object({
    tag: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .transform((value) => value.replace(/^#/, '').toLocaleLowerCase('en-US'))
      .refine((value) => /^[\p{L}\p{N}_]+$/u.test(value), 'The hashtag is invalid.'),
  })
  .strict();

export type FeedQuery = z.infer<typeof feedQuerySchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type CategoryListQuery = z.infer<typeof categoryListQuerySchema>;
export type HashtagListQuery = z.infer<typeof hashtagListQuerySchema>;
