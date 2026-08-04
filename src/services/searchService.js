import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import { findUsersByName } from './userWatchService';

class SearchService {
  constructor() {
    this.searchHistory = [];
  }

  /**
   * Global search across users + posts (real Firestore data).
   */
  async globalSearch(searchTerm, filters = {}) {
    try {
      if (!searchTerm || searchTerm.trim().length < 2) {
        return this.getSearchSuggestions();
      }

      const results = {
        users: [],
        posts: [],
        hashtags: [],
        locations: [],
      };

      if (!filters.type || filters.type === 'users') {
        results.users = await this.searchUsers(searchTerm, filters.limit || 10);
      }

      if (!filters.type || filters.type === 'posts') {
        results.posts = await this.searchPosts(searchTerm, filters.limit || 20);
      }

      if (!filters.type || filters.type === 'hashtags') {
        results.hashtags = await this.searchHashtags(searchTerm, filters.limit || 15);
      }

      // Locations are not indexed yet — return empty rather than mock cities.
      if (!filters.type || filters.type === 'locations') {
        results.locations = [];
      }

      this.addToHistory(searchTerm);
      return results;
    } catch (error) {
      console.error('❌ Global search error:', error);
      return this.getFallbackResults(searchTerm);
    }
  }

  async searchUsers(searchTerm, limitCount = 10) {
    try {
      const users = await findUsersByName(searchTerm, null, limitCount);
      return (users || []).map((u) => ({
        id: u.id,
        username: u.username || '',
        displayName: u.displayName || u.username || 'User',
        avatar: u.photoURL || '',
        followers: '',
        verified: false,
      }));
    } catch (error) {
      console.error('❌ User search error:', error);
      return [];
    }
  }

  async searchPosts(searchTerm, limitCount = 20) {
    try {
      const term = String(searchTerm || '').toLowerCase().trim();
      if (!term || !db) return [];

      const postsRef = collection(db, 'posts');
      const snap = await getDocs(query(postsRef, orderBy('date', 'desc'), limit(120)));
      const matched = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const hay = [
          data.caption,
          data.description,
          data.transcript,
          data.title,
          ...(Array.isArray(data.hashtags) ? data.hashtags : []),
          ...(Array.isArray(data.tags) ? data.tags : []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(term)) return;
        matched.push({
          id: docSnap.id,
          ...data,
          caption: data.caption || data.description || data.transcript || '',
          username: data.username || data.user?.username || 'User',
          likes: data.likeCount || data.likes || 0,
        });
      });

      return matched.slice(0, limitCount);
    } catch (error) {
      console.error('❌ Post search error:', error);
      return [];
    }
  }

  async searchHashtags(searchTerm, limitCount = 15) {
    try {
      const term = String(searchTerm || '').toLowerCase().replace(/^#/, '').trim();
      if (!term || !db) return [];

      const postsRef = collection(db, 'posts');
      const snap = await getDocs(query(postsRef, orderBy('date', 'desc'), limit(120)));
      const counts = new Map();

      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const tags = [
          ...(Array.isArray(data.hashtags) ? data.hashtags : []),
          ...(Array.isArray(data.tags) ? data.tags : []),
        ];
        // Also scrape #words from caption text.
        const caption = String(data.caption || data.description || '');
        const fromCaption = caption.match(/#[A-Za-z0-9_]+/g) || [];
        for (const raw of [...tags, ...fromCaption]) {
          const tag = String(raw || '').replace(/^#/, '').toLowerCase();
          if (!tag || !tag.includes(term)) continue;
          counts.set(tag, (counts.get(tag) || 0) + 1);
        }
      });

      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limitCount)
        .map(([tag, postCount]) => ({
          hashtag: `#${tag}`,
          postCount,
          trending: postCount >= 3,
        }));
    } catch (error) {
      console.error('❌ Hashtag search error:', error);
      return [];
    }
  }

  async searchLocations() {
    return [];
  }

  getSearchSuggestions() {
    return {
      users: [],
      posts: [],
      hashtags: [],
      locations: [],
      recent: this.searchHistory.slice(0, 5),
      trending: [],
    };
  }

  getFallbackResults(searchTerm) {
    return {
      users: [],
      posts: [],
      hashtags: searchTerm
        ? [{ hashtag: `#${String(searchTerm).replace(/\s+/g, '')}`, postCount: 0, trending: false }]
        : [],
      locations: [],
      error: 'Search temporarily unavailable',
    };
  }

  addToHistory(searchTerm) {
    const term = String(searchTerm || '').trim();
    if (!term) return;
    this.searchHistory = [term, ...this.searchHistory.filter((t) => t !== term)].slice(0, 20);
  }

  getSearchHistory() {
    return this.searchHistory;
  }

  clearHistory() {
    this.searchHistory = [];
  }
}

export default new SearchService();
