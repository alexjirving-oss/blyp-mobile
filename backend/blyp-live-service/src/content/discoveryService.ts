import type { Knex } from 'knex';
import { getEconomyInfra } from '../economy/infra';
import { ApiError } from '../platform/apiContract';
import { decodeCursor, encodeCursor } from '../platform/pagination';
import { evaluateTrustPolicy } from '../trust/trustRelationshipService';
import { loadCanonicalPost, type CanonicalPost } from './contentService';
import type {
  CategoryListQuery,
  FeedQuery,
  HashtagListQuery,
  SearchQuery,
} from './discoverySchemas';

export const FEED_RANKING_VERSION = 'candidate.recency.v1';

export type FeedCandidate = {
  post: CanonicalPost;
  rankingVersion: typeof FEED_RANKING_VERSION;
  eligibilityReasons: ['CANONICAL_PUBLISHED', 'PUBLIC_VISIBILITY', 'TRUST_ELIGIBLE'];
};

export type DiscoverySearchResult =
  | {
      type: 'profile';
      id: string;
      score: number;
      profile: {
        userId: string;
        username: string;
        displayName: string;
        bio: string;
        avatarUrl: string | null;
        version: number;
        updatedAt: string;
      };
    }
  | { type: 'post'; id: string; score: number; post: CanonicalPost }
  | {
      type: 'category';
      id: string;
      score: number;
      category: { categoryId: string; slug: string; displayName: string; description: string };
    }
  | { type: 'hashtag'; id: string; score: number; hashtag: { tag: string } };

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canonicalSubject(value: string): string {
  const subject = String(value || '').trim();
  if (!subject || subject.length > 256) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'A canonical authenticated user is required.');
  }
  return subject;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

async function trustAllows(
  actorUserId: string,
  targetUserId: string,
  capability: 'view' | 'discover',
  cache: Map<string, boolean>
): Promise<boolean> {
  const cacheKey = `${capability}:${targetUserId}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const decision = await evaluateTrustPolicy(actorUserId, {
      targetUserId,
      capability: actorUserId === targetUserId ? 'transact' : capability,
    });
    cache.set(cacheKey, decision.allowed);
    return decision.allowed;
  } catch {
    cache.set(cacheKey, false);
    return false;
  }
}

function applyFeedFilters(builder: Knex.QueryBuilder, query: FeedQuery): void {
  if (query.mediaKind) {
    builder.whereExists(function mediaKindFilter() {
      this.select(1)
        .from('content_media_assets as media')
        .whereRaw('media.post_id = post.post_id')
        .andWhere('media.media_kind', query.mediaKind!);
    });
  }
  if (query.categoryId) {
    builder.whereExists(function categoryFilter() {
      this.select(1)
        .from('content_post_categories as category_link')
        .whereRaw('category_link.post_id = post.post_id')
        .andWhere('category_link.category_id', query.categoryId!);
    });
  }
  if (query.hashtag) {
    builder.whereExists(function hashtagFilter() {
      this.select(1)
        .from('content_post_hashtags as hashtag_link')
        .join('content_hashtags as hashtag', 'hashtag.hashtag_id', 'hashtag_link.hashtag_id')
        .whereRaw('hashtag_link.post_id = post.post_id')
        .andWhere('hashtag.tag', query.hashtag!);
    });
  }
}

export async function listFeedCandidates(
  actorUserId: string,
  query: FeedQuery
): Promise<{ items: FeedCandidate[]; nextCursor: string | null; rankingVersion: string }> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  const cursor = decodeCursor(query.cursor);
  const scanLimit = Math.min(query.limit * 10, 250);
  const builder = db('content_posts as post')
    .select('post.post_id', 'post.author_user_id', 'post.published_at')
    .where({ 'post.lifecycle_state': 'published', 'post.visibility': 'public' })
    .whereNotNull('post.published_at')
    .orderBy('post.published_at', 'desc')
    .orderBy('post.post_id', 'desc')
    .limit(scanLimit + 1);
  if (cursor) {
    builder.andWhereRaw('(post.published_at, post.post_id) < (?, ?::uuid)', [
      cursor.sortValue,
      cursor.id,
    ]);
  }
  applyFeedFilters(builder, query);

  const rows = await builder;
  const trustCache = new Map<string, boolean>();
  const items: FeedCandidate[] = [];
  let lastScanned: any = null;
  let stoppedEarly = false;
  for (const row of rows.slice(0, scanLimit)) {
    lastScanned = row;
    if (!(await trustAllows(actorUserId, String(row.author_user_id), 'view', trustCache))) continue;
    const post = await loadCanonicalPost(db, String(row.post_id));
    if (!post || post.lifecycleState !== 'published' || post.visibility !== 'public') continue;
    items.push({
      post,
      rankingVersion: FEED_RANKING_VERSION,
      eligibilityReasons: ['CANONICAL_PUBLISHED', 'PUBLIC_VISIBILITY', 'TRUST_ELIGIBLE'],
    });
    if (items.length === query.limit) {
      stoppedEarly = rows.indexOf(row) < rows.length - 1;
      break;
    }
  }
  const hasMore = stoppedEarly || rows.length > scanLimit;
  return {
    items,
    rankingVersion: FEED_RANKING_VERSION,
    nextCursor:
      hasMore && lastScanned
        ? encodeCursor({
            sortValue: asIso(lastScanned.published_at),
            id: String(lastScanned.post_id),
          })
        : null,
  };
}

async function hasVisibleLinkedPost(
  db: Knex,
  actorUserId: string,
  kind: 'category' | 'hashtag',
  entityId: string,
  trustCache: Map<string, boolean>
): Promise<boolean> {
  const linkTable = kind === 'category' ? 'content_post_categories' : 'content_post_hashtags';
  const linkColumn = kind === 'category' ? 'category_id' : 'hashtag_id';
  const candidates = await db(`${linkTable} as link`)
    .join('content_posts as post', 'post.post_id', 'link.post_id')
    .distinct('post.author_user_id')
    .where(`link.${linkColumn}`, entityId)
    .andWhere({ 'post.lifecycle_state': 'published', 'post.visibility': 'public' })
    .limit(100);
  for (const row of candidates) {
    if (await trustAllows(actorUserId, String(row.author_user_id), 'view', trustCache)) return true;
  }
  return false;
}

async function materializeSearchResult(
  db: Knex,
  actorUserId: string,
  row: any,
  trustCache: Map<string, boolean>
): Promise<DiscoverySearchResult | null> {
  const type = String(row.entity_type);
  const id = String(row.entity_id);
  const score = Number(row.score || 0);

  if (type === 'profile') {
    if (!(await trustAllows(actorUserId, String(row.owner_user_id), 'discover', trustCache))) return null;
    const profile = await db('content_profiles').where({ user_id: id }).first();
    if (!profile) return null;
    return {
      type: 'profile',
      id,
      score,
      profile: {
        userId: String(profile.user_id),
        username: String(profile.username),
        displayName: String(profile.display_name),
        bio: String(profile.bio || ''),
        avatarUrl: profile.avatar_url ? String(profile.avatar_url) : null,
        version: Number(profile.version),
        updatedAt: asIso(profile.updated_at),
      },
    };
  }

  if (type === 'post') {
    if (!(await trustAllows(actorUserId, String(row.owner_user_id), 'view', trustCache))) return null;
    const post = await loadCanonicalPost(db, id);
    if (!post || post.lifecycleState !== 'published' || post.visibility !== 'public') return null;
    return { type: 'post', id, score, post };
  }

  if (type === 'category') {
    const category = await db('content_categories').where({ category_id: id, active: true }).first();
    if (!category) return null;
    return {
      type: 'category',
      id,
      score,
      category: {
        categoryId: String(category.category_id),
        slug: String(category.slug),
        displayName: String(category.display_name),
        description: String(category.description || ''),
      },
    };
  }

  if (type === 'hashtag') {
    if (!(await hasVisibleLinkedPost(db, actorUserId, 'hashtag', id, trustCache))) return null;
    const hashtag = await db('content_hashtags').where({ hashtag_id: id }).first();
    if (!hashtag) return null;
    return { type: 'hashtag', id, score, hashtag: { tag: String(hashtag.tag) } };
  }

  return null;
}

export async function searchCanonicalContent(
  actorUserId: string,
  query: SearchQuery
): Promise<{ items: DiscoverySearchResult[]; nextCursor: string | null }> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  const cursor = decodeCursor(query.cursor);
  const scanLimit = Math.min(query.limit * 10, 250);
  const searchText = query.q.trim();
  const likeText = `%${escapeLike(searchText)}%`;
  const scoreSql = `ts_rank_cd(search_document, websearch_to_tsquery('simple', ?))`;

  const builder = db('content_search_documents')
    .select('*')
    .select(db.raw(`${scoreSql} AS score`, [searchText]))
    .whereIn('entity_type', query.types)
    .andWhere((where) =>
      where
        .whereRaw(`search_document @@ websearch_to_tsquery('simple', ?)`, [searchText])
        .orWhereRaw(`title ILIKE ? ESCAPE '\\'`, [likeText])
        .orWhereRaw(`subtitle ILIKE ? ESCAPE '\\'`, [likeText])
    )
    .orderBy('updated_at', 'desc')
    .orderByRaw(`entity_type || ':' || entity_id DESC`)
    .limit(scanLimit + 1);
  if (cursor) {
    builder.andWhereRaw(`(updated_at, entity_type || ':' || entity_id) < (?, ?)`, [
      cursor.sortValue,
      cursor.id,
    ]);
  }

  const rows = await builder;
  const trustCache = new Map<string, boolean>();
  const items: DiscoverySearchResult[] = [];
  let lastScanned: any = null;
  let stoppedEarly = false;
  for (const row of rows.slice(0, scanLimit)) {
    lastScanned = row;
    const result = await materializeSearchResult(db, actorUserId, row, trustCache);
    if (result) items.push(result);
    if (items.length === query.limit) {
      stoppedEarly = rows.indexOf(row) < rows.length - 1;
      break;
    }
  }
  const hasMore = stoppedEarly || rows.length > scanLimit;
  return {
    items,
    nextCursor:
      hasMore && lastScanned
        ? encodeCursor({
            sortValue: asIso(lastScanned.updated_at),
            id: `${lastScanned.entity_type}:${lastScanned.entity_id}`,
          })
        : null,
  };
}

export async function listCategories(
  query: CategoryListQuery
): Promise<{
  items: Array<{ categoryId: string; slug: string; displayName: string; description: string }>;
  nextCursor: string | null;
}> {
  const { db } = getEconomyInfra();
  const cursor = decodeCursor(query.cursor);
  const builder = db('content_categories')
    .select('category_id', 'slug', 'display_name', 'description')
    .where({ active: true })
    .orderBy('slug', 'asc')
    .orderBy('category_id', 'asc')
    .limit(query.limit + 1);
  if (cursor) {
    builder.andWhereRaw('(slug, category_id) > (?, ?::uuid)', [cursor.sortValue, cursor.id]);
  }
  const rows = await builder;
  const hasMore = rows.length > query.limit;
  const visible = hasMore ? rows.slice(0, query.limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map((row) => ({
      categoryId: String(row.category_id),
      slug: String(row.slug),
      displayName: String(row.display_name),
      description: String(row.description || ''),
    })),
    nextCursor:
      hasMore && last
        ? encodeCursor({ sortValue: String(last.slug), id: String(last.category_id) })
        : null,
  };
}

export async function listHashtags(
  actorUserId: string,
  query: HashtagListQuery
): Promise<{ items: Array<{ hashtagId: string; tag: string }>; nextCursor: string | null }> {
  actorUserId = canonicalSubject(actorUserId);
  const { db } = getEconomyInfra();
  const cursor = decodeCursor(query.cursor);
  const scanLimit = Math.min(query.limit * 10, 500);
  const builder = db('content_hashtags')
    .select('hashtag_id', 'tag')
    .orderBy('tag', 'asc')
    .orderBy('hashtag_id', 'asc')
    .limit(scanLimit + 1);
  if (cursor) {
    builder.andWhereRaw('(tag, hashtag_id) > (?, ?::uuid)', [cursor.sortValue, cursor.id]);
  }
  const rows = await builder;
  const trustCache = new Map<string, boolean>();
  const items: Array<{ hashtagId: string; tag: string }> = [];
  let lastScanned: any = null;
  let stoppedEarly = false;
  for (const row of rows.slice(0, scanLimit)) {
    lastScanned = row;
    if (
      await hasVisibleLinkedPost(
        db,
        actorUserId,
        'hashtag',
        String(row.hashtag_id),
        trustCache
      )
    ) {
      items.push({ hashtagId: String(row.hashtag_id), tag: String(row.tag) });
    }
    if (items.length === query.limit) {
      stoppedEarly = rows.indexOf(row) < rows.length - 1;
      break;
    }
  }
  const hasMore = stoppedEarly || rows.length > scanLimit;
  return {
    items,
    nextCursor:
      hasMore && lastScanned
        ? encodeCursor({ sortValue: String(lastScanned.tag), id: String(lastScanned.hashtag_id) })
        : null,
  };
}
