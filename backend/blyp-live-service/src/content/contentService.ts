import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getEconomyInfra } from '../economy/infra';
import { ApiError } from '../platform/apiContract';
import { enqueueDomainEvent } from '../platform/events/outbox';
import { decodeCursor, encodeCursor } from '../platform/pagination';
import {
  requireTrustPolicy,
  requireTrustPolicyInTransaction,
} from '../trust/trustRelationshipService';
import {
  assertPostStateTransition,
  isAuthorEditablePostState,
  type PostLifecycleState,
} from './contentLifecycle';
import type {
  AuthoredPostQuery,
  ContentProfileUpsertInput,
  CreatePostInput,
  RemovePostInput,
  UpdatePostInput,
} from './contentSchemas';

export type ContentProfile = {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CanonicalPost = {
  postId: string;
  authorUserId: string;
  author: Pick<ContentProfile, 'userId' | 'username' | 'displayName' | 'avatarUrl'>;
  title: string;
  caption: string;
  visibility: 'public' | 'followers' | 'private';
  lifecycleState: PostLifecycleState;
  rankingSeed: string;
  media: Array<{
    mediaId: string;
    clientAssetId: string;
    kind: 'image' | 'video' | 'audio';
    url: string;
    thumbnailUrl: string | null;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    altText: string | null;
    position: number;
  }>;
  categories: Array<{ categoryId: string; slug: string; displayName: string }>;
  hashtags: string[];
  version: number;
  publishedAt: string | null;
  removedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function asIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canonicalSubject(value: string): string {
  const subject = String(value || '').trim();
  if (!subject || subject.length > 256) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'A canonical authenticated user is required.');
  }
  return subject;
}

function mapProfile(row: any): ContentProfile {
  return {
    userId: String(row.user_id),
    username: String(row.username),
    displayName: String(row.display_name),
    bio: String(row.bio || ''),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    version: Number(row.version),
    createdAt: asIso(row.created_at)!,
    updatedAt: asIso(row.updated_at)!,
  };
}

function rankingSeed(postId: string): string {
  const compact = postId.replace(/-/g, '').slice(0, 16);
  return BigInt.asIntN(63, BigInt(`0x${compact}`)).toString();
}

async function lockKey(trx: Knex.Transaction, key: string): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [key]);
}

async function requireCanonicalProfile(
  db: Knex | Knex.Transaction,
  userId: string
): Promise<any> {
  const row = await db('content_profiles').where({ user_id: userId }).first();
  if (!row) {
    throw new ApiError(
      409,
      'CONTENT_PROFILE_REQUIRED',
      'A canonical content profile is required before creating posts.'
    );
  }
  return row;
}

async function assertCategories(
  trx: Knex.Transaction,
  categoryIds: string[]
): Promise<void> {
  if (categoryIds.length === 0) return;
  const rows = await trx('content_categories')
    .select('category_id')
    .whereIn('category_id', categoryIds)
    .andWhere({ active: true });
  if (rows.length !== categoryIds.length) {
    throw new ApiError(
      400,
      'CONTENT_CATEGORY_INVALID',
      'One or more categories are unknown or inactive.'
    );
  }
}

async function replaceMedia(
  trx: Knex.Transaction,
  postId: string,
  media: CreatePostInput['media']
): Promise<void> {
  await trx('content_media_assets').where({ post_id: postId }).delete();
  if (media.length === 0) return;
  await trx('content_media_assets').insert(
    media.map((item, position) => ({
      media_id: randomUUID(),
      post_id: postId,
      client_asset_id: item.clientAssetId,
      media_kind: item.kind,
      media_url: item.url,
      thumbnail_url: item.thumbnailUrl ?? null,
      mime_type: item.mimeType ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
      duration_ms: item.durationMs ?? null,
      alt_text: item.altText ?? null,
      position,
    }))
  );
}

async function replaceCategories(
  trx: Knex.Transaction,
  postId: string,
  categoryIds: string[]
): Promise<void> {
  await assertCategories(trx, categoryIds);
  await trx('content_post_categories').where({ post_id: postId }).delete();
  if (categoryIds.length > 0) {
    await trx('content_post_categories').insert(
      categoryIds.map((categoryId) => ({ post_id: postId, category_id: categoryId }))
    );
  }
}

async function replaceHashtags(
  trx: Knex.Transaction,
  postId: string,
  hashtags: string[]
): Promise<void> {
  await trx('content_post_hashtags').where({ post_id: postId }).delete();
  if (hashtags.length === 0) return;

  for (const tag of hashtags) {
    await trx('content_hashtags')
      .insert({ hashtag_id: randomUUID(), tag })
      .onConflict('tag')
      .ignore();
  }
  const rows = await trx('content_hashtags').select('hashtag_id').whereIn('tag', hashtags);
  if (rows.length !== hashtags.length) {
    throw new ApiError(500, 'CONTENT_HASHTAG_STATE_INVALID', 'Hashtags were not persisted correctly.');
  }
  await trx('content_post_hashtags').insert(
    rows.map((row) => ({ post_id: postId, hashtag_id: row.hashtag_id }))
  );
}

export async function loadCanonicalPost(
  db: Knex | Knex.Transaction,
  postId: string
): Promise<CanonicalPost | null> {
  const row = await db('content_posts as post')
    .join('content_profiles as profile', 'profile.user_id', 'post.author_user_id')
    .select(
      'post.*',
      'profile.username as author_username',
      'profile.display_name as author_display_name',
      'profile.avatar_url as author_avatar_url'
    )
    .where('post.post_id', postId)
    .first();
  if (!row) return null;

  const [mediaRows, categoryRows, hashtagRows] = await Promise.all([
    db('content_media_assets')
      .where({ post_id: postId })
      .orderBy('position', 'asc'),
    db('content_post_categories as link')
      .join('content_categories as category', 'category.category_id', 'link.category_id')
      .select('category.category_id', 'category.slug', 'category.display_name')
      .where('link.post_id', postId)
      .orderBy('category.sort_order', 'asc')
      .orderBy('category.slug', 'asc'),
    db('content_post_hashtags as link')
      .join('content_hashtags as hashtag', 'hashtag.hashtag_id', 'link.hashtag_id')
      .select('hashtag.tag')
      .where('link.post_id', postId)
      .orderBy('hashtag.tag', 'asc'),
  ]);

  return {
    postId: String(row.post_id),
    authorUserId: String(row.author_user_id),
    author: {
      userId: String(row.author_user_id),
      username: String(row.author_username),
      displayName: String(row.author_display_name),
      avatarUrl: row.author_avatar_url ? String(row.author_avatar_url) : null,
    },
    title: String(row.title || ''),
    caption: String(row.caption || ''),
    visibility: row.visibility,
    lifecycleState: row.lifecycle_state,
    rankingSeed: String(row.ranking_seed),
    media: mediaRows.map((media) => ({
      mediaId: String(media.media_id),
      clientAssetId: String(media.client_asset_id),
      kind: media.media_kind,
      url: String(media.media_url),
      thumbnailUrl: media.thumbnail_url ? String(media.thumbnail_url) : null,
      mimeType: media.mime_type ? String(media.mime_type) : null,
      width: media.width === null ? null : Number(media.width),
      height: media.height === null ? null : Number(media.height),
      durationMs: media.duration_ms === null ? null : Number(media.duration_ms),
      altText: media.alt_text ? String(media.alt_text) : null,
      position: Number(media.position),
    })),
    categories: categoryRows.map((category) => ({
      categoryId: String(category.category_id),
      slug: String(category.slug),
      displayName: String(category.display_name),
    })),
    hashtags: hashtagRows.map((hashtag) => String(hashtag.tag)),
    version: Number(row.version),
    publishedAt: asIso(row.published_at),
    removedAt: asIso(row.removed_at),
    createdAt: asIso(row.created_at)!,
    updatedAt: asIso(row.updated_at)!,
  };
}

function requireOwner(row: any, actorUserId: string): void {
  if (String(row.author_user_id) !== actorUserId) {
    throw new ApiError(404, 'CONTENT_POST_NOT_FOUND', 'The post was not found.');
  }
}

function requireVersion(row: any, expectedVersion: number): void {
  if (Number(row.version) !== expectedVersion) {
    throw new ApiError(409, 'CONTENT_VERSION_CONFLICT', 'The content changed before this request was applied.', {
      expectedVersion,
      actualVersion: Number(row.version),
    });
  }
}

async function recordStateChange(
  trx: Knex.Transaction,
  input: {
    postId: string;
    actorUserId: string;
    fromState: PostLifecycleState | null;
    toState: PostLifecycleState;
    reasonCode: string;
    notes?: string | null;
    version: number;
    correlationId: string;
  }
): Promise<void> {
  await trx('content_moderation_history').insert({
    moderation_event_id: randomUUID(),
    post_id: input.postId,
    actor_user_id: input.actorUserId,
    from_state: input.fromState,
    to_state: input.toState,
    reason_code: input.reasonCode,
    notes: input.notes ?? null,
    post_version: input.version,
    correlation_id: input.correlationId,
  });
}

export async function upsertContentProfile(
  actorUserId: string,
  input: ContentProfileUpsertInput,
  correlationId: string
): Promise<{ profile: ContentProfile; created: boolean }> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    await lockKey(trx, `content-profile:${actorUserId}`);
    await requireTrustPolicyInTransaction(trx, actorUserId, {
      targetUserId: actorUserId,
      capability: 'transact',
    });
    const existing = await trx('content_profiles').where({ user_id: actorUserId }).forUpdate().first();
    const usernameOwner = await trx('content_profiles')
      .select('user_id')
      .whereRaw('lower(username) = lower(?)', [input.username])
      .first();
    if (usernameOwner && String(usernameOwner.user_id) !== actorUserId) {
      throw new ApiError(409, 'CONTENT_USERNAME_TAKEN', 'That username is not available.');
    }

    const created = !existing;
    let version = 1;
    if (existing) {
      if (input.expectedVersion === undefined) {
        throw new ApiError(409, 'CONTENT_PROFILE_VERSION_REQUIRED', 'expectedVersion is required when updating a profile.');
      }
      requireVersion(existing, input.expectedVersion);
      version = Number(existing.version) + 1;
      await trx('content_profiles').where({ user_id: actorUserId }).update({
        username: input.username,
        display_name: input.displayName,
        bio: input.bio,
        avatar_url: input.avatarUrl ?? null,
        version,
        updated_at: trx.fn.now(),
      });
    } else {
      if (input.expectedVersion !== undefined) {
        throw new ApiError(409, 'CONTENT_PROFILE_NOT_FOUND', 'The profile does not exist at the supplied version.');
      }
      await trx('content_profiles').insert({
        user_id: actorUserId,
        username: input.username,
        display_name: input.displayName,
        bio: input.bio,
        avatar_url: input.avatarUrl ?? null,
      });
    }

    await enqueueDomainEvent(trx, {
      eventType: 'content.profile.changed.v1',
      eventVersion: 1,
      aggregate: { type: 'content_profile', id: actorUserId },
      actorUserId,
      correlationId,
      payload: {
        userId: actorUserId,
        changeType: created ? 'created' : 'updated',
        version,
      },
    });
    const row = await trx('content_profiles').where({ user_id: actorUserId }).first();
    return { profile: mapProfile(row), created };
  });
}

export async function getContentProfile(actorUserId: string, targetUserId: string): Promise<ContentProfile> {
  actorUserId = canonicalSubject(actorUserId);
  targetUserId = canonicalSubject(targetUserId);
  const { db } = getEconomyInfra();
  if (actorUserId === targetUserId) {
    await requireTrustPolicy(actorUserId, { targetUserId, capability: 'transact' });
  } else {
    await requireTrustPolicy(actorUserId, { targetUserId, capability: 'view' });
  }
  const row = await db('content_profiles').where({ user_id: targetUserId }).first();
  if (!row) throw new ApiError(404, 'CONTENT_PROFILE_NOT_FOUND', 'The content profile was not found.');
  return mapProfile(row);
}

export async function createPost(
  actorUserId: string,
  input: CreatePostInput,
  correlationId: string
): Promise<CanonicalPost> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    await requireTrustPolicyInTransaction(trx, actorUserId, {
      targetUserId: actorUserId,
      capability: 'transact',
    });
    await requireCanonicalProfile(trx, actorUserId);
    await assertCategories(trx, input.categoryIds);

    const postId = randomUUID();
    const lifecycleState: PostLifecycleState = input.publish ? 'published' : 'draft';
    await trx('content_posts').insert({
      post_id: postId,
      author_user_id: actorUserId,
      title: input.title,
      caption: input.caption,
      visibility: input.visibility,
      lifecycle_state: lifecycleState,
      ranking_seed: rankingSeed(postId),
      published_at: input.publish ? trx.fn.now() : null,
    });
    await replaceMedia(trx, postId, input.media);
    await replaceCategories(trx, postId, input.categoryIds);
    await replaceHashtags(trx, postId, input.hashtags);
    await recordStateChange(trx, {
      postId,
      actorUserId,
      fromState: null,
      toState: lifecycleState,
      reasonCode: input.publish ? 'AUTHOR_CREATED_PUBLISHED' : 'AUTHOR_CREATED_DRAFT',
      version: 1,
      correlationId,
    });
    await enqueueDomainEvent(trx, {
      eventType: 'content.post.created.v1',
      eventVersion: 1,
      aggregate: { type: 'content_post', id: postId },
      actorUserId,
      correlationId,
      payload: {
        postId,
        authorUserId: actorUserId,
        lifecycleState,
        visibility: input.visibility,
        version: 1,
      },
    });
    const post = await loadCanonicalPost(trx, postId);
    if (!post) throw new ApiError(500, 'CONTENT_STATE_INVALID', 'The post was not persisted.');
    return post;
  });
}

export async function updatePost(
  actorUserId: string,
  postId: string,
  input: UpdatePostInput,
  correlationId: string
): Promise<CanonicalPost> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    await lockKey(trx, `content-post:${postId}`);
    const row = await trx('content_posts').where({ post_id: postId }).forUpdate().first();
    if (!row) throw new ApiError(404, 'CONTENT_POST_NOT_FOUND', 'The post was not found.');
    requireOwner(row, actorUserId);
    requireVersion(row, input.expectedVersion);
    if (!isAuthorEditablePostState(row.lifecycle_state)) {
      throw new ApiError(409, 'CONTENT_POST_NOT_EDITABLE', 'The post cannot be edited in its current state.');
    }
    await requireTrustPolicyInTransaction(trx, actorUserId, {
      targetUserId: actorUserId,
      capability: 'transact',
    });

    const update: Record<string, unknown> = {
      version: Number(row.version) + 1,
      updated_at: trx.fn.now(),
    };
    const changedFields: string[] = [];
    if (input.title !== undefined) {
      update.title = input.title;
      changedFields.push('title');
    }
    if (input.caption !== undefined) {
      update.caption = input.caption;
      changedFields.push('caption');
    }
    if (input.visibility !== undefined) {
      update.visibility = input.visibility;
      changedFields.push('visibility');
    }
    await trx('content_posts').where({ post_id: postId }).update(update);
    if (input.media !== undefined) {
      await replaceMedia(trx, postId, input.media);
      changedFields.push('media');
    }
    if (input.categoryIds !== undefined) {
      await replaceCategories(trx, postId, input.categoryIds);
      changedFields.push('categories');
    }
    if (input.hashtags !== undefined) {
      await replaceHashtags(trx, postId, input.hashtags);
      changedFields.push('hashtags');
    }

    const version = Number(row.version) + 1;
    await enqueueDomainEvent(trx, {
      eventType: 'content.post.updated.v1',
      eventVersion: 1,
      aggregate: { type: 'content_post', id: postId },
      actorUserId,
      correlationId,
      payload: {
        postId,
        authorUserId: actorUserId,
        changedFields,
        version,
      },
    });
    const post = await loadCanonicalPost(trx, postId);
    if (!post) throw new ApiError(500, 'CONTENT_STATE_INVALID', 'The post update was not persisted.');
    return post;
  });
}

export async function publishPost(
  actorUserId: string,
  postId: string,
  expectedVersion: number,
  correlationId: string
): Promise<CanonicalPost> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    await lockKey(trx, `content-post:${postId}`);
    const row = await trx('content_posts').where({ post_id: postId }).forUpdate().first();
    if (!row) throw new ApiError(404, 'CONTENT_POST_NOT_FOUND', 'The post was not found.');
    requireOwner(row, actorUserId);
    requireVersion(row, expectedVersion);
    assertPostStateTransition(row.lifecycle_state, 'published');
    await requireTrustPolicyInTransaction(trx, actorUserId, {
      targetUserId: actorUserId,
      capability: 'transact',
    });
    const version = Number(row.version) + 1;
    await trx('content_posts').where({ post_id: postId }).update({
      lifecycle_state: 'published',
      moderation_reason_code: null,
      published_at: trx.fn.now(),
      removed_at: null,
      version,
      updated_at: trx.fn.now(),
    });
    await recordStateChange(trx, {
      postId,
      actorUserId,
      fromState: row.lifecycle_state,
      toState: 'published',
      reasonCode: 'AUTHOR_PUBLISHED',
      version,
      correlationId,
    });
    await enqueueDomainEvent(trx, {
      eventType: 'content.post.state_changed.v1',
      eventVersion: 1,
      aggregate: { type: 'content_post', id: postId },
      actorUserId,
      correlationId,
      payload: {
        postId,
        authorUserId: actorUserId,
        fromState: row.lifecycle_state,
        toState: 'published',
        reasonCode: 'AUTHOR_PUBLISHED',
        version,
      },
    });
    const post = await loadCanonicalPost(trx, postId);
    if (!post) throw new ApiError(500, 'CONTENT_STATE_INVALID', 'The post publication was not persisted.');
    return post;
  });
}

export async function removePost(
  actorUserId: string,
  postId: string,
  input: RemovePostInput,
  correlationId: string
): Promise<CanonicalPost> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  return db.transaction(async (trx) => {
    await lockKey(trx, `content-post:${postId}`);
    const row = await trx('content_posts').where({ post_id: postId }).forUpdate().first();
    if (!row) throw new ApiError(404, 'CONTENT_POST_NOT_FOUND', 'The post was not found.');
    requireOwner(row, actorUserId);
    requireVersion(row, input.expectedVersion);
    assertPostStateTransition(row.lifecycle_state, 'removed');
    await requireTrustPolicyInTransaction(trx, actorUserId, {
      targetUserId: actorUserId,
      capability: 'transact',
    });
    const version = Number(row.version) + 1;
    await trx('content_posts').where({ post_id: postId }).update({
      lifecycle_state: 'removed',
      moderation_reason_code: input.reasonCode,
      removed_at: trx.fn.now(),
      version,
      updated_at: trx.fn.now(),
    });
    await recordStateChange(trx, {
      postId,
      actorUserId,
      fromState: row.lifecycle_state,
      toState: 'removed',
      reasonCode: input.reasonCode,
      version,
      correlationId,
    });
    await enqueueDomainEvent(trx, {
      eventType: 'content.post.state_changed.v1',
      eventVersion: 1,
      aggregate: { type: 'content_post', id: postId },
      actorUserId,
      correlationId,
      payload: {
        postId,
        authorUserId: actorUserId,
        fromState: row.lifecycle_state,
        toState: 'removed',
        reasonCode: input.reasonCode,
        version,
      },
    });
    const post = await loadCanonicalPost(trx, postId);
    if (!post) throw new ApiError(500, 'CONTENT_STATE_INVALID', 'The post removal was not persisted.');
    return post;
  });
}

export async function getOwnPost(actorUserId: string, postId: string): Promise<CanonicalPost> {
  actorUserId = canonicalSubject(actorUserId);
  await requireTrustPolicy(actorUserId, { targetUserId: actorUserId, capability: 'transact' });
  const { db } = getEconomyInfra();
  const post = await loadCanonicalPost(db, postId);
  if (!post || post.authorUserId !== actorUserId) {
    throw new ApiError(404, 'CONTENT_POST_NOT_FOUND', 'The post was not found.');
  }
  return post;
}

export async function getPublishedPost(actorUserId: string, postId: string): Promise<CanonicalPost> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  const post = await loadCanonicalPost(db, postId);
  if (!post || post.lifecycleState !== 'published') {
    throw new ApiError(404, 'CONTENT_POST_NOT_FOUND', 'The post was not found.');
  }
  if (post.authorUserId === actorUserId) {
    await requireTrustPolicy(actorUserId, { targetUserId: actorUserId, capability: 'transact' });
  } else {
    await requireTrustPolicy(actorUserId, { targetUserId: post.authorUserId, capability: 'view' });
  }
  return post;
}

export async function listOwnPosts(
  actorUserId: string,
  query: AuthoredPostQuery
): Promise<{ items: CanonicalPost[]; nextCursor: string | null }> {
  actorUserId = canonicalSubject(actorUserId);
  await requireTrustPolicy(actorUserId, { targetUserId: actorUserId, capability: 'transact' });
  const { db } = getEconomyInfra();
  const cursor = decodeCursor(query.cursor);
  const builder = db('content_posts')
    .select('post_id', 'created_at')
    .where({ author_user_id: actorUserId })
    .orderBy('created_at', 'desc')
    .orderBy('post_id', 'desc')
    .limit(query.limit + 1);
  if (query.state) builder.andWhere({ lifecycle_state: query.state });
  if (cursor) {
    builder.andWhereRaw('(created_at, post_id) < (?, ?::uuid)', [cursor.sortValue, cursor.id]);
  }
  const rows = await builder;
  const hasMore = rows.length > query.limit;
  const visibleRows = hasMore ? rows.slice(0, query.limit) : rows;
  const items = await Promise.all(visibleRows.map((row) => loadCanonicalPost(db, String(row.post_id))));
  const last = visibleRows.at(-1);
  return {
    items: items.filter((post): post is CanonicalPost => post !== null),
    nextCursor:
      hasMore && last
        ? encodeCursor({ sortValue: asIso(last.created_at)!, id: String(last.post_id) })
        : null,
  };
}
