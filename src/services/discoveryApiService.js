import { platformApi } from './platformApiClient';
import { normalizePost } from './contentApiService';

function boundedLimit(value, fallback = 20, maximum = 50) {
  return Math.max(1, Math.min(Number(value) || fallback, maximum));
}

function buildFeedQuery({ cursor, limit = 20, mediaKind, categoryId, hashtag } = {}) {
  const query = new URLSearchParams({ limit: String(boundedLimit(limit)) });
  if (cursor) query.set('cursor', String(cursor));
  if (mediaKind) query.set('mediaKind', String(mediaKind));
  if (categoryId) query.set('categoryId', String(categoryId));
  if (hashtag) query.set('hashtag', String(hashtag).replace(/^#/, ''));
  return query;
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const post = normalizePost(candidate.post);
  if (!post) return null;
  return {
    post,
    rankingVersion: String(candidate.rankingVersion || ''),
    eligibilityReasons: Array.isArray(candidate.eligibilityReasons)
      ? candidate.eligibilityReasons
      : [],
  };
}

export async function getDiscoveryFeed(options = {}) {
  const query = buildFeedQuery(options);
  const result = await platformApi.get(`/api/v1/discovery/feed?${query.toString()}`);
  return {
    items: Array.isArray(result.data?.items)
      ? result.data.items.map(normalizeCandidate).filter(Boolean)
      : [],
    rankingVersion: result.data?.rankingVersion || null,
    nextCursor: result.meta?.nextCursor || null,
  };
}

export async function searchDiscovery({ query: searchTerm, cursor, limit = 20, types } = {}) {
  const params = new URLSearchParams({
    q: String(searchTerm || '').trim(),
    limit: String(boundedLimit(limit, 20, 40)),
  });
  if (cursor) params.set('cursor', String(cursor));
  if (Array.isArray(types) && types.length > 0) params.set('types', types.join(','));
  const result = await platformApi.get(`/api/v1/discovery/search?${params.toString()}`);
  return {
    items: Array.isArray(result.data?.items) ? result.data.items : [],
    nextCursor: result.meta?.nextCursor || null,
  };
}

export async function getDiscoveryCategories({ cursor, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(boundedLimit(limit, 50, 100)) });
  if (cursor) params.set('cursor', String(cursor));
  const result = await platformApi.get(`/api/v1/discovery/categories?${params.toString()}`);
  return {
    items: Array.isArray(result.data?.items) ? result.data.items : [],
    nextCursor: result.meta?.nextCursor || null,
  };
}

export async function getCategoryPosts(categoryId, options = {}) {
  const query = buildFeedQuery(options);
  const result = await platformApi.get(
    `/api/v1/discovery/categories/${encodeURIComponent(String(categoryId))}/posts?${query.toString()}`
  );
  return {
    items: Array.isArray(result.data?.items)
      ? result.data.items.map(normalizeCandidate).filter(Boolean)
      : [],
    rankingVersion: result.data?.rankingVersion || null,
    nextCursor: result.meta?.nextCursor || null,
  };
}

export async function getDiscoveryHashtags({ cursor, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(boundedLimit(limit, 50, 100)) });
  if (cursor) params.set('cursor', String(cursor));
  const result = await platformApi.get(`/api/v1/discovery/hashtags?${params.toString()}`);
  return {
    items: Array.isArray(result.data?.items) ? result.data.items : [],
    nextCursor: result.meta?.nextCursor || null,
  };
}

export async function getHashtagPosts(hashtag, options = {}) {
  const query = buildFeedQuery(options);
  const normalizedTag = String(hashtag || '').replace(/^#/, '');
  const result = await platformApi.get(
    `/api/v1/discovery/hashtags/${encodeURIComponent(normalizedTag)}/posts?${query.toString()}`
  );
  return {
    items: Array.isArray(result.data?.items)
      ? result.data.items.map(normalizeCandidate).filter(Boolean)
      : [],
    rankingVersion: result.data?.rankingVersion || null,
    nextCursor: result.meta?.nextCursor || null,
  };
}

export { buildFeedQuery, normalizeCandidate };
