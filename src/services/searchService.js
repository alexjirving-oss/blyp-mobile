import { collection, query, where, orderBy, limit, getDocs, startAt, endAt } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';

class SearchService {
  constructor() {
    this.searchHistory = [];
    this.trendingHashtags = [
      '#viral', '#trending', '#fyp', '#explore', '#love', '#instagood',
      '#photooftheday', '#beautiful', '#happy', '#cute', '#tbt', '#like4like',
      '#followme', '#nature', '#art', '#photography', '#music', '#travel'
    ];
    this.suggestedUsers = [
      { id: 'user1', username: 'alex_creator', displayName: 'Alex Creator', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop', followers: '12.5K', verified: true },
      { id: 'user2', username: 'sarah_photos', displayName: 'Sarah Photos', avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b95c?w=100&h=100&fit=crop', followers: '8.2K', verified: false },
      { id: 'user3', username: 'mike_travel', displayName: 'Mike Travel', avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop', followers: '15.1K', verified: true },
      { id: 'user4', username: 'emma_art', displayName: 'Emma Art', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop', followers: '6.7K', verified: false },
      { id: 'user5', username: 'david_food', displayName: 'David Food', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop', followers: '9.3K', verified: true }
    ];
  }

  /**
   * Global search across all content types
   */
  async globalSearch(searchTerm, filters = {}) {
    try {
      console.log('🔍 Performing global search:', { searchTerm, filters });
      
      if (!searchTerm || searchTerm.trim().length < 2) {
        return this.getSearchSuggestions();
      }

      const results = {
        users: [],
        posts: [],
        hashtags: [],
        locations: []
      };

      // Search users
      if (!filters.type || filters.type === 'users') {
        results.users = await this.searchUsers(searchTerm, filters.limit || 10);
      }

      // Search posts
      if (!filters.type || filters.type === 'posts') {
        results.posts = await this.searchPosts(searchTerm, filters.limit || 20);
      }

      // Search hashtags
      if (!filters.type || filters.type === 'hashtags') {
        results.hashtags = await this.searchHashtags(searchTerm, filters.limit || 15);
      }

      // Search locations
      if (!filters.type || filters.type === 'locations') {
        results.locations = await this.searchLocations(searchTerm, filters.limit || 10);
      }

      // Add to search history
      this.addToHistory(searchTerm);

      return results;
    } catch (error) {
      console.error('❌ Global search error:', error);
      return this.getFallbackResults(searchTerm);
    }
  }

  /**
   * Search for users by username or display name
   */
  async searchUsers(searchTerm, limitCount = 10) {
    try {
      console.log('👤 Searching users:', searchTerm);
      
      const term = searchTerm.toLowerCase().trim();
      
      // Mock Firebase search - in real app, use proper Firebase queries
      const filteredUsers = this.suggestedUsers.filter(user => 
        user.username.toLowerCase().includes(term) ||
        user.displayName.toLowerCase().includes(term)
      ).slice(0, limitCount);

      // Add some dynamic users based on search term
      const dynamicUsers = this.generateDynamicUsers(term, limitCount - filteredUsers.length);
      
      return [...filteredUsers, ...dynamicUsers];
    } catch (error) {
      console.error('❌ User search error:', error);
      return this.suggestedUsers.slice(0, limitCount);
    }
  }

  /**
   * Search for posts by caption or description
   */
  async searchPosts(searchTerm, limitCount = 20) {
    try {
      console.log('📝 Searching posts:', searchTerm);
      
      // Mock post search results
      const mockPosts = this.generateMockPosts(searchTerm, limitCount);
      return mockPosts;
    } catch (error) {
      console.error('❌ Post search error:', error);
      return [];
    }
  }

  /**
   * Search for hashtags
   */
  async searchHashtags(searchTerm, limitCount = 15) {
    try {
      console.log('🏷️ Searching hashtags:', searchTerm);
      
      const term = searchTerm.toLowerCase().replace('#', '');
      
      // Filter trending hashtags
      const matchingTrending = this.trendingHashtags.filter(tag => 
        tag.toLowerCase().includes(term)
      );

      // Generate related hashtags
      const relatedTags = this.generateRelatedHashtags(term, limitCount);
      
      const allTags = [...matchingTrending, ...relatedTags]
        .slice(0, limitCount)
        .map(tag => ({
          hashtag: tag,
          postCount: Math.floor(Math.random() * 50000) + 1000,
          trending: this.trendingHashtags.includes(tag)
        }));

      return allTags;
    } catch (error) {
      console.error('❌ Hashtag search error:', error);
      return [];
    }
  }

  /**
   * Search for locations
   */
  async searchLocations(searchTerm, limitCount = 10) {
    try {
      console.log('📍 Searching locations:', searchTerm);
      
      // Mock location search
      const mockLocations = [
        { id: 1, name: 'New York, NY', postCount: 15420, type: 'city' },
        { id: 2, name: 'Los Angeles, CA', postCount: 12350, type: 'city' },
        { id: 3, name: 'London, UK', postCount: 9800, type: 'city' },
        { id: 4, name: 'Paris, France', postCount: 8900, type: 'city' },
        { id: 5, name: 'Tokyo, Japan', postCount: 11200, type: 'city' }
      ].filter(location => 
        location.name.toLowerCase().includes(searchTerm.toLowerCase())
      ).slice(0, limitCount);

      return mockLocations;
    } catch (error) {
      console.error('❌ Location search error:', error);
      return [];
    }
  }

  /**
   * Get search suggestions when no query provided
   */
  getSearchSuggestions() {
    return {
      users: this.suggestedUsers.slice(0, 5),
      posts: [],
      hashtags: this.trendingHashtags.slice(0, 8).map(tag => ({
        hashtag: tag,
        postCount: Math.floor(Math.random() * 50000) + 1000,
        trending: true
      })),
      locations: [],
      recent: this.searchHistory.slice(0, 5),
      trending: [
        'sunset photography',
        'coffee art',
        'street style',
        'nature walks',
        'weekend vibes'
      ]
    };
  }

  /**
   * Get fallback results when search fails
   */
  getFallbackResults(searchTerm) {
    return {
      users: this.suggestedUsers.slice(0, 3),
      posts: [],
      hashtags: [
        { hashtag: `#${searchTerm.replace(/\s+/g, '')}`, postCount: 0, trending: false }
      ],
      locations: [],
      error: 'Search temporarily unavailable'
    };
  }

  /**
   * Generate dynamic users based on search term
   */
  generateDynamicUsers(term, count) {
    const users = [];
    for (let i = 0; i < Math.min(count, 3); i++) {
      users.push({
        id: `dynamic_${term}_${i}`,
        username: `${term}_user${i + 1}`,
        displayName: `${term.charAt(0).toUpperCase() + term.slice(1)} User ${i + 1}`,
        avatar: `https://images.unsplash.com/photo-${1500000000000 + i}?w=100&h=100&fit=crop`,
        followers: `${(Math.random() * 10).toFixed(1)}K`,
        verified: Math.random() > 0.7
      });
    }
    return users;
  }

  /**
   * Generate mock posts for search results
   */
  generateMockPosts(searchTerm, count) {
    const posts = [];
    for (let i = 0; i < Math.min(count, 10); i++) {
      posts.push({
        id: `post_${searchTerm}_${i}`,
        type: Math.random() > 0.5 ? 'video' : 'photo',
        thumbnail: `https://images.unsplash.com/photo-${1500000000000 + i}?w=300&h=300&fit=crop`,
        caption: `Amazing ${searchTerm} content! Check this out 🔥`,
        user: {
          username: `creator${i + 1}`,
          avatar: `https://images.unsplash.com/photo-${1400000000000 + i}?w=50&h=50&fit=crop`
        },
        likes: Math.floor(Math.random() * 1000) + 50,
        views: Math.floor(Math.random() * 10000) + 500
      });
    }
    return posts;
  }

  /**
   * Generate related hashtags
   */
  generateRelatedHashtags(term, count) {
    const related = [
      `#${term}`,
      `#${term}life`,
      `#${term}love`,
      `#${term}vibes`,
      `#daily${term}`,
      `#${term}inspiration`,
      `#${term}community`,
      `#${term}art`
    ];
    return related.slice(0, count);
  }

  /**
   * Add search term to history
   */
  addToHistory(searchTerm) {
    const term = searchTerm.trim();
    if (!term || this.searchHistory.includes(term)) return;
    
    this.searchHistory.unshift(term);
    if (this.searchHistory.length > 10) {
      this.searchHistory = this.searchHistory.slice(0, 10);
    }
  }

  /**
   * Clear search history
   */
  clearHistory() {
    this.searchHistory = [];
  }

  /**
   * Get search history
   */
  getHistory() {
    return this.searchHistory;
  }

  /**
   * Get trending searches
   */
  getTrendingSearches() {
    return [
      'sunset photography',
      'coffee art',
      'street style',
      'nature walks',
      'weekend vibes',
      'urban exploration',
      'food photography',
      'minimalist design'
    ];
  }
}

export default new SearchService();