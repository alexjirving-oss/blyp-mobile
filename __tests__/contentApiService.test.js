const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockPatch = jest.fn();
const mockRequest = jest.fn();
const mockCreateIdempotencyKey = jest.fn((operation) => `generated:${operation}`);

jest.mock('../src/services/platformApiClient', () => ({
  platformApi: {
    get: mockGet,
    post: mockPost,
    put: mockPut,
    patch: mockPatch,
  },
  platformApiRequest: mockRequest,
  createIdempotencyKey: mockCreateIdempotencyKey,
}));

const ContentApiService = require('../src/services/contentApiService');

beforeEach(() => {
  jest.clearAllMocks();
});

test('upserts the authenticated canonical profile without client identity fields', async () => {
  const profile = { username: 'alex', displayName: 'Alex', bio: '', avatarUrl: null };
  mockPut.mockResolvedValue({ data: { profile: { userId: 'cognito-sub', ...profile, version: 1 } } });

  await expect(
    ContentApiService.upsertContentProfile({ profile, idempotencyKey: 'profile-key' })
  ).resolves.toMatchObject({ userId: 'cognito-sub', username: 'alex' });
  expect(mockPut).toHaveBeenCalledWith('/api/v1/content/profiles/me', profile, {
    idempotencyKey: 'profile-key',
  });
});

test('creates and updates posts with generated idempotency keys and normalized arrays', async () => {
  mockPost.mockResolvedValueOnce({ data: { post: { postId: 'post-1', caption: 'hello' } } });
  mockPatch.mockResolvedValueOnce({
    data: { post: { postId: 'post-1', caption: 'updated', hashtags: ['blyp'] } },
  });

  await expect(
    ContentApiService.createContentPost({ post: { caption: 'hello', publish: false } })
  ).resolves.toEqual({
    postId: 'post-1',
    caption: 'hello',
    media: [],
    categories: [],
    hashtags: [],
  });
  await ContentApiService.updateContentPost({
    postId: 'post/1',
    changes: { expectedVersion: 1, caption: 'updated' },
  });

  expect(mockCreateIdempotencyKey).toHaveBeenNthCalledWith(1, 'content-post-create');
  expect(mockCreateIdempotencyKey).toHaveBeenNthCalledWith(2, 'content-post-update');
  expect(mockPost).toHaveBeenCalledWith(
    '/api/v1/content/posts',
    { caption: 'hello', publish: false },
    { idempotencyKey: 'generated:content-post-create' }
  );
  expect(mockPatch).toHaveBeenCalledWith(
    '/api/v1/content/posts/post%2F1',
    { expectedVersion: 1, caption: 'updated' },
    { idempotencyKey: 'generated:content-post-update' }
  );
});

test('publishes and removes with optimistic versions through idempotent server contracts', async () => {
  mockPost.mockResolvedValue({ data: { post: { postId: 'post-1', lifecycleState: 'published' } } });
  mockRequest.mockResolvedValue({ data: { post: { postId: 'post-1', lifecycleState: 'removed' } } });

  await ContentApiService.publishContentPost({
    postId: 'post-1',
    expectedVersion: 2,
    idempotencyKey: 'publish-key',
  });
  await ContentApiService.removeContentPost({
    postId: 'post-1',
    expectedVersion: 3,
    reasonCode: 'AUTHOR_REMOVED',
    idempotencyKey: 'remove-key',
  });

  expect(mockPost).toHaveBeenCalledWith(
    '/api/v1/content/posts/post-1/publish',
    { expectedVersion: 2 },
    { idempotencyKey: 'publish-key' }
  );
  expect(mockRequest).toHaveBeenCalledWith('/api/v1/content/posts/post-1', {
    method: 'DELETE',
    body: { expectedVersion: 3, reasonCode: 'AUTHOR_REMOVED' },
    idempotencyKey: 'remove-key',
  });
});

test('bounds own-post pagination and preserves the server cursor', async () => {
  mockGet.mockResolvedValue({
    data: { items: [{ postId: 'post-1' }] },
    meta: { nextCursor: 'next/one' },
  });

  await expect(
    ContentApiService.getOwnContentPosts({ cursor: 'cursor/one', limit: 999, state: 'draft' })
  ).resolves.toEqual({
    items: [{ postId: 'post-1', media: [], categories: [], hashtags: [] }],
    nextCursor: 'next/one',
  });
  expect(mockGet).toHaveBeenCalledWith(
    '/api/v1/content/me/posts?limit=50&cursor=cursor%2Fone&state=draft'
  );
});
