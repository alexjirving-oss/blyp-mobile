import { db, firebaseEnabled } from '../config/firebase';
import { isFeedDiscoveryV1Enabled } from '../config/FeatureFlags';
import { searchDiscovery } from './discoveryApiService';

const DEFAULT_READ_LIMIT = 100;

const emptyResults = (extra = {}) => ({
  users: [],
  posts: [],
  hashtags: [],
    locations: [],
  categories: [],
  ...extra,

});

const normalize = (value) => String(value ?? '').trim().toLowerCase();

const formatCount = (value) => {
  const count = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`;
  return String(Math.floor(count));
};

const getSnapshotData = (snapshot) => {
  if (!snapshot) return {};
  if (typeof snapshot.data === 'function') return snapshot.data() || {};
  return snapshot.data || {};
};

const getFollowerCount = (data) => {
  if (Number.isFinite(Number(data.followersCount))) return Number(data.followersCount);
  if (Number.isFinite(Number(data.followerCount))) return Number(data.followerCount);
  if (Array.isArray(data.followers)) return data.followers.length;
  return 0;
};

const getPostText = (data) => [
  data.title,
  data.caption,
  data.description,
  data.transcript,
  Array.isArray(data.tags) ? data.tags.join(' ') : data.tags,
].filter(Boolean).join(' ');

const getPostThumbnail = (data) => (
  data.thumbnail
  || data.imageUrl
  || data.media?.[0]?.thumbnail
  || data.media?.[0]?.url
  || null
);

const extractPostHashtags = (data) => {
  const tags = new Set();
  const explicitTags = Array.isArray(data.tags) ? data.tags : [];
  explicitTags.forEach((tag) => {
    const normalizedTag = normalize(tag).replace(/^#/, '');
    if (normalizedTag) tags.add(normalizedTag);
  });

  const text = getPostText(data);
  const matches = text.match(/#[\p{L}\p{N}_]+/gu) || [];
  matches.forEach((tag) => tags.add(normalize(tag).replace(/^#/, '')));
  return [...tags];
};

class SearchService {
  constructor() {
    this.searchHistory = [];
  }

  async readCollection(collectionName, limitCount = DEFAULT_READ_LIMIT) {
    if (!firebaseEnabled) return [];

    const snapshot = await db.collection(collectionName).limit(limitCount).get();
    return (snapshot?.docs || []).map((doc) => ({
      id: doc.id,
      ...getSnapshotData(doc),
    }));
  }

  /**
   * Search only source-backed records. Failures return an explicit empty state;
   * they never fall back to fabricated people, posts, counts, or locations.
   */
    async globalSearch(searchTerm, filters = {}) {
    const term = normalize(searchTerm);
    if (term.length < 2) return this.getSearchSuggestions();

    try {
      if (isFeedDiscoveryV1Enabled()) {
        const typeMap = {
          users: 'profile',
          posts: 'post',
          hashtags: 'hashtag',
          categories: 'category',
        };
        const response = await searchDiscovery({
          query: term,
          limit: filters.limit || 20,
          types: filters.type && typeMap[filters.type] ? [typeMap[filters.type]] : undefined,
        });
        const results = emptyResults();
        response.items.forEach((item) => {
          if (item.type === 'profile' && item.profile) {
            results.users.push({
              id: item.profile.userId,
              username: item.profile.username,
              displayName: item.profile.displayName,
              avatar: item.profile.avatarUrl || null,
              followers: null,
            });
          } else if (item.type === 'post' && item.post) {
            const media = item.post.media?.[0] || null;
            results.posts.push({
              id: item.post.postId,
              type: media?.kind === 'image' ? 'photo' : media?.kind || 'text',
              thumbnail: media?.thumbnailUrl || media?.url || null,
              caption: item.post.caption || item.post.title || '',
              user: {
                username: item.post.author?.username || null,
                avatar: item.post.author?.avatarUrl || null,
              },
            });
          } else if (item.type === 'hashtag' && item.hashtag) {
            results.hashtags.push({
              hashtag: `#${item.hashtag.tag}`,
              postCount: null,
              trending: false,
            });
          } else if (item.type === 'category' && item.category) {
            results.categories.push({
              id: item.category.categoryId,
              slug: item.category.slug,
              name: item.category.displayName,
              description: item.category.description,
            });
          }
        });
        this.addToHistory(searchTerm);
        return { ...results, nextCursor: response.nextCursor };
      }

      const results = emptyResults();

      const limitCount = filters.limit || 20;

      if (!filters.type || filters.type === 'users') {
        results.users = await this.searchUsers(term, limitCount);
      }
      if (!filters.type || filters.type === 'posts') {
        results.posts = await this.searchPosts(term, limitCount);
      }
      if (!filters.type || filters.type === 'hashtags') {
        results.hashtags = await this.searchHashtags(term, limitCount);
      }
      if (!filters.type || filters.type === 'locations') {
        results.locations = await this.searchLocations(term, limitCount);
      }

      this.addToHistory(searchTerm);
      return results;
    } catch (error) {
      console.error('Search unavailable:', error);
      return this.getFallbackResults();
    }
  }

  async searchUsers(searchTerm, limitCount = 10) {
    const term = normalize(searchTerm);
    if (!term || !firebaseEnabled) return [];

    try {
      const users = await this.readCollection('users');
      return users
        .filter((user) => [
          user.username,
          user.handle,
          user.displayName,
          user.name,
        ].some((value) => normalize(value).includes(term)))
        .slice(0, limitCount)
        .map((user) => ({
          id: user.id,
          username: user.username || user.handle || user.displayName || user.id,
          displayName: user.displayName || user.name || user.username || 'Blyp user',
          avatar: user.photoURL || user.avatar || user.avatarUrl || null,
          followers: formatCount(getFollowerCount(user)),
          verified: Boolean(user.verified || user.isVerified),
        }));
    } catch (error) {
      console.error('User search unavailable:', error);
      return [];
    }
  }

  async searchPosts(searchTerm, limitCount = 20) {
    const term = normalize(searchTerm);
    if (!term || !firebaseEnabled) return [];

    try {
      const posts = await this.readCollection('posts');
      return posts
        .filter((post) => normalize(getPostText(post)).includes(term))
        .slice(0, limitCount)
        .map((post) => ({
          id: post.id,
          type: post.type || (post.videoUrl ? 'video' : 'photo'),
          thumbnail: getPostThumbnail(post),
          caption: post.caption || post.description || post.title || '',
          user: post.user || {
            username: post.username || 'Blyp user',
            avatar: post.userPhotoURL || null,
          },
          likes: Number(post.likes ?? post.likeCount ?? 0) || 0,
          views: Number(post.views ?? post.viewCount ?? 0) || 0,
        }));
    } catch (error) {
      console.error('Post search unavailable:', error);
      return [];
    }
  }

  async searchHashtags(searchTerm, limitCount = 15) {
    const term = normalize(searchTerm).replace(/^#/, '');
    if (!term || !firebaseEnabled) return [];

    try {
      const posts = await this.readCollection('posts');
      const counts = new Map();
      posts.forEach((post) => {
        extractPostHashtags(post).forEach((tag) => {
          if (tag.includes(term)) counts.set(tag, (counts.get(tag) || 0) + 1);
        });
      });

      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, limitCount)
        .map(([tag, postCount]) => ({
          hashtag: `#${tag}`,
          postCount,
          trending: false,
        }));
    } catch (error) {
      console.error('Hashtag search unavailable:', error);
      return [];
    }
  }

  async searchLocations(searchTerm, limitCount = 10) {
    const term = normalize(searchTerm);
    if (!term || !firebaseEnabled) return [];

    try {
      const posts = await this.readCollection('posts');
      const locations = new Map();

      posts.forEach((post) => {
        const location = post.location;
        const name = typeof location === 'string'
          ? location
          : location?.name || location?.label || post.locationName;
        if (!name || !normalize(name).includes(term)) return;

        const id = typeof location === 'object' && location?.id
          ? String(location.id)
          : normalize(name).replace(/[^a-z0-9]+/g, '-');
        const current = locations.get(id) || { id, name, postCount: 0, type: location?.type || 'place' };
        current.postCount += 1;
        locations.set(id, current);
      });

      return [...locations.values()]
        .sort((a, b) => b.postCount - a.postCount || a.name.localeCompare(b.name))
        .slice(0, limitCount);
    } catch (error) {
      console.error('Location search unavailable:', error);
      return [];
    }
  }

  getSearchSuggestions() {
    return emptyResults({
      recent: this.searchHistory.slice(0, 5),
      trending: [],
      unavailable: !firebaseEnabled,
    });
  }

  getFallbackResults() {
    return emptyResults({
      recent: this.searchHistory.slice(0, 5),
      trending: [],
      error: 'Search temporarily unavailable',
    });
  }

  addToHistory(searchTerm) {
    const term = String(searchTerm ?? '').trim();
    if (!term || this.searchHistory.includes(term)) return;

    this.searchHistory.unshift(term);
    if (this.searchHistory.length > 10) {
      this.searchHistory = this.searchHistory.slice(0, 10);
    }
  }

  addToSearchHistory(searchTerm) {
    this.addToHistory(searchTerm);
  }

  clearHistory() {
    this.searchHistory = [];
  }

  getHistory() {
    return [...this.searchHistory];
  }

  getTrendingSearches() {
    return [];
  }
}

export default new SearchService();
