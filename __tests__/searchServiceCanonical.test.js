const mockCollection = jest.fn();
const mockDiscoveryEnabled = jest.fn(() => true);
const mockSearchDiscovery = jest.fn();

jest.mock('../src/config/firebase', () => ({
  firebaseEnabled: true,
  db: { collection: mockCollection },
}));

jest.mock('../src/config/FeatureFlags', () => ({
  isFeedDiscoveryV1Enabled: mockDiscoveryEnabled,
}));

jest.mock('../src/services/discoveryApiService', () => ({
  searchDiscovery: mockSearchDiscovery,
}));

const SearchService = require('../src/services/searchService').default;

beforeEach(() => {
  jest.clearAllMocks();
  SearchService.clearHistory();
  mockDiscoveryEnabled.mockReturnValue(true);
});

test('feature-enabled global search uses canonical profiles, posts, categories, and hashtags only', async () => {
  mockSearchDiscovery.mockResolvedValue({
    nextCursor: 'next-search-page',
    items: [
      {
        type: 'profile',
        profile: {
          userId: 'user-1',
          username: 'alex',
          displayName: 'Alex',
          avatarUrl: null,
        },
      },
      {
        type: 'post',
        post: {
          postId: 'post-1',
          title: 'Canonical post',
          caption: 'A source-backed result',
          author: { username: 'alex', avatarUrl: null },
          media: [{ kind: 'image', url: 'https://cdn.example.test/a.jpg' }],
        },
      },
      { type: 'category', category: { categoryId: 'category-1', slug: 'art', displayName: 'Art', description: '' } },
      { type: 'hashtag', hashtag: { tag: 'blyp' } },
    ],
  });

  await expect(SearchService.globalSearch('Blyp', { limit: 500 })).resolves.toEqual({
    users: [
      {
        id: 'user-1',
        username: 'alex',
        displayName: 'Alex',
        avatar: null,
        followers: null,
      },
    ],
    posts: [
      {
        id: 'post-1',
        type: 'photo',
        thumbnail: 'https://cdn.example.test/a.jpg',
        caption: 'A source-backed result',
        user: { username: 'alex', avatar: null },
      },
    ],
    hashtags: [{ hashtag: '#blyp', postCount: null, trending: false }],
    locations: [],
    categories: [{ id: 'category-1', slug: 'art', name: 'Art', description: '' }],
    nextCursor: 'next-search-page',
  });

  expect(mockSearchDiscovery).toHaveBeenCalledWith({
    query: 'blyp',
    limit: 500,
    types: undefined,
  });
  expect(mockCollection).not.toHaveBeenCalled();
  expect(SearchService.getHistory()).toEqual(['Blyp']);
});

test('canonical search failures return an explicit empty error state, not local or synthetic data', async () => {
  mockSearchDiscovery.mockRejectedValue(new Error('discovery unavailable'));

  await expect(SearchService.globalSearch('offline')).resolves.toEqual({
    users: [],
    posts: [],
    hashtags: [],
    locations: [],
    categories: [],
    recent: [],
    trending: [],
    error: 'Search temporarily unavailable',
  });
  expect(mockCollection).not.toHaveBeenCalled();
});
