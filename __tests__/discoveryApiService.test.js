const mockGet = jest.fn();

jest.mock('../src/services/platformApiClient', () => ({
  platformApi: { get: mockGet },
}));

const DiscoveryApiService = require('../src/services/discoveryApiService');

beforeEach(() => {
  jest.clearAllMocks();
});

test('reads bounded feed candidates with server ranking and Trust eligibility metadata', async () => {
  mockGet.mockResolvedValue({
    data: {
      rankingVersion: 'candidate.recency.v1',
      items: [
        {
          post: { postId: 'post-1', media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] },
          rankingVersion: 'candidate.recency.v1',
          eligibilityReasons: ['CANONICAL_PUBLISHED', 'PUBLIC_VISIBILITY', 'TRUST_ELIGIBLE'],
        },
      ],
    },
    meta: { nextCursor: 'next-1' },
  });

  await expect(
    DiscoveryApiService.getDiscoveryFeed({
      cursor: 'cursor/one',
      limit: 999,
      mediaKind: 'image',
      hashtag: '#Blyp',
    })
  ).resolves.toMatchObject({
    rankingVersion: 'candidate.recency.v1',
    nextCursor: 'next-1',
    items: [{ post: { postId: 'post-1', categories: [], hashtags: [] } }],
  });
  expect(mockGet).toHaveBeenCalledWith(
    '/api/v1/discovery/feed?limit=50&cursor=cursor%2Fone&mediaKind=image&hashtag=Blyp'
  );
});

test('encodes real multi-domain search and preserves an empty server result without fallback', async () => {
  mockGet.mockResolvedValueOnce({ data: { items: [] }, meta: { nextCursor: null } });

  await expect(
    DiscoveryApiService.searchDiscovery({
      query: 'alice & blyp',
      cursor: 'next/page',
      limit: 500,
      types: ['profile', 'post', 'category', 'hashtag'],
    })
  ).resolves.toEqual({ items: [], nextCursor: null });
  expect(mockGet).toHaveBeenCalledWith(
    '/api/v1/discovery/search?q=alice+%26+blyp&limit=40&cursor=next%2Fpage&types=profile%2Cpost%2Ccategory%2Chashtag'
  );
});

test('uses distinct category and hashtag post contracts rather than collapsing all tabs to one query', async () => {
  mockGet
    .mockResolvedValueOnce({ data: { items: [], rankingVersion: 'candidate.recency.v1' }, meta: {} })
    .mockResolvedValueOnce({ data: { items: [], rankingVersion: 'candidate.recency.v1' }, meta: {} });

  await DiscoveryApiService.getCategoryPosts('category/one', { limit: 10, mediaKind: 'video' });
  await DiscoveryApiService.getHashtagPosts('#hello world', { limit: 15 });

  expect(mockGet).toHaveBeenNthCalledWith(
    1,
    '/api/v1/discovery/categories/category%2Fone/posts?limit=10&mediaKind=video'
  );
  expect(mockGet).toHaveBeenNthCalledWith(
    2,
    '/api/v1/discovery/hashtags/hello%20world/posts?limit=15'
  );
});

test('normalizes malformed list bodies to truthful empty states', async () => {
  mockGet
    .mockResolvedValueOnce({ data: { items: null }, meta: {} })
    .mockResolvedValueOnce({ data: {}, meta: {} });

  await expect(DiscoveryApiService.getDiscoveryCategories()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
  await expect(DiscoveryApiService.getDiscoveryHashtags()).resolves.toEqual({
    items: [],
    nextCursor: null,
  });
});
