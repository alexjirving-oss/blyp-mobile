import {
  createIdempotencyKey,
  platformApi,
  platformApiRequest,
} from './platformApiClient';

function mutationOptions(operation, idempotencyKey) {
  const key = idempotencyKey || createIdempotencyKey(operation);
  return { key, options: { idempotencyKey: key } };
}

function boundedLimit(value, fallback = 20, maximum = 50) {
  return Math.max(1, Math.min(Number(value) || fallback, maximum));
}

function normalizePost(post) {
  if (!post || typeof post !== 'object') return null;
  return {
    ...post,
    media: Array.isArray(post.media) ? post.media : [],
    categories: Array.isArray(post.categories) ? post.categories : [],
    hashtags: Array.isArray(post.hashtags) ? post.hashtags : [],
  };
}

export async function upsertContentProfile({ profile, idempotencyKey }) {
  const mutation = mutationOptions('content-profile', idempotencyKey);
  const result = await platformApi.put('/api/v1/content/profiles/me', profile, mutation.options);
  return result.data?.profile || null;
}

export async function getContentProfile(userId) {
  const result = await platformApi.get(`/api/v1/content/profiles/${encodeURIComponent(String(userId))}`);
  return result.data?.profile || null;
}

export async function createContentPost({ post, idempotencyKey }) {
  const mutation = mutationOptions('content-post-create', idempotencyKey);
  const result = await platformApi.post('/api/v1/content/posts', post, mutation.options);
  return normalizePost(result.data?.post);
}

export async function updateContentPost({ postId, changes, idempotencyKey }) {
  const mutation = mutationOptions('content-post-update', idempotencyKey);
  const result = await platformApi.patch(
    `/api/v1/content/posts/${encodeURIComponent(String(postId))}`,
    changes,
    mutation.options
  );
  return normalizePost(result.data?.post);
}

export async function publishContentPost({ postId, expectedVersion, idempotencyKey }) {
  const mutation = mutationOptions('content-post-publish', idempotencyKey);
  const result = await platformApi.post(
    `/api/v1/content/posts/${encodeURIComponent(String(postId))}/publish`,
    { expectedVersion },
    mutation.options
  );
  return normalizePost(result.data?.post);
}

export async function removeContentPost({ postId, expectedVersion, reasonCode, idempotencyKey }) {
  const mutation = mutationOptions('content-post-remove', idempotencyKey);
  const result = await platformApiRequest(
    `/api/v1/content/posts/${encodeURIComponent(String(postId))}`,
    {
      method: 'DELETE',
      body: {
        expectedVersion,
        ...(reasonCode ? { reasonCode } : {}),
      },
      ...mutation.options,
    }
  );
  return normalizePost(result.data?.post);
}

export async function getContentPost(postId, { own = false } = {}) {
  const prefix = own ? '/api/v1/content/me/posts' : '/api/v1/content/posts';
  const result = await platformApi.get(`${prefix}/${encodeURIComponent(String(postId))}`);
  return normalizePost(result.data?.post);
}

export async function getOwnContentPosts({ cursor, limit = 20, state } = {}) {
  const query = new URLSearchParams({ limit: String(boundedLimit(limit)) });
  if (cursor) query.set('cursor', String(cursor));
  if (state) query.set('state', String(state));
  const result = await platformApi.get(`/api/v1/content/me/posts?${query.toString()}`);
  return {
    items: Array.isArray(result.data?.items)
      ? result.data.items.map(normalizePost).filter(Boolean)
      : [],
    nextCursor: result.meta?.nextCursor || null,
  };
}

export { normalizePost };
