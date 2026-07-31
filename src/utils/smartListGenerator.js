import { GoogleGenerativeAI } from '@google/generative-ai';
import { geminiApiKey } from '../config/firebase';

const AI_ENABLED = !!geminiApiKey;

// Initialize Gemini AI with proper API key
const genAI = AI_ENABLED ? new GoogleGenerativeAI(geminiApiKey) : null;

/**
 * Rate limiting and caching system
 */
class RateLimiter {
  constructor() {
    this.lastCall = {};
    this.cache = {};
    this.minInterval = 5000; // 5 seconds between calls
    this.cacheExpiry = 300000; // 5 minutes cache
  }

  canMakeCall(key) {
    const now = Date.now();
    const lastCall = this.lastCall[key];
    return !lastCall || (now - lastCall) > this.minInterval;
  }

  recordCall(key) {
    this.lastCall[key] = Date.now();
  }

  getCached(key) {
    const cached = this.cache[key];
    if (!cached) return null;
    
    const now = Date.now();
    if ((now - cached.timestamp) > this.cacheExpiry) {
      delete this.cache[key];
      return null;
    }
    return cached.data;
  }

  setCache(key, data) {
    this.cache[key] = {
      data,
      timestamp: Date.now()
    };
  }
}

/**
 * AI-powered smart list generator for categories and hashtags
 */
export class SmartListGenerator {
  constructor() {
    this.model = genAI ? genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' }) : null;
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Generate smart categories for posts based on content analysis
   */
  async generateCategories(posts) {
    try {
      if (!this.model) {
        return this.getFallbackCategories();
      }
      const cacheKey = 'categories';
      
      // Check cache first
      const cached = this.rateLimiter.getCached(cacheKey);
      if (cached) {
        console.log('📦 Using cached categories');
        return cached;
      }

      // Check rate limit
      if (!this.rateLimiter.canMakeCall(cacheKey)) {
        console.log('⏱️ Rate limited - using fallback categories');
        return this.getFallbackCategories();
      }

      console.log('🤖 AI: Analyzing posts for smart categories...');
      this.rateLimiter.recordCall(cacheKey);
      
      // Prepare content for analysis
      const contentSample = posts.slice(0, 20).map(post => ({
        description: post.description || '',
        type: post.type,
        hasMedia: post.media?.length > 0 || post.videoUrl || post.imageUrl,
      }));

      const prompt = `
Analyze the following social media posts and generate smart category lists. 
Create 6-8 intelligent categories that would help users discover content efficiently.

Posts data: ${JSON.stringify(contentSample)}

Generate categories in this JSON format:
{
  "categories": [
    {
      "id": "trending_now",
      "name": "🔥 Trending Now",
      "description": "Hot topics everyone's talking about",
      "color": "#ec4899",
      "icon": "trending-up",
      "keywords": ["viral", "trending", "popular"]
    }
  ]
}

Focus on:
- Visual content (photos, videos)
- Popular themes (lifestyle, travel, tech, etc.)
- Trending topics
- Content types (tutorials, entertainment, etc.)
- Engagement patterns

Make categories engaging and discoverable. Use emojis in names.
`;

      // Add timeout to AI call
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI timeout')), 10000)
      );
      
      const result = await Promise.race([
        this.model.generateContent(prompt),
        timeoutPromise
      ]);
      const response = await result.response;
      const text = response.text();
      
      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const categoriesData = JSON.parse(jsonMatch[0]);
        console.log('✅ AI: Generated', categoriesData.categories.length, 'smart categories');
        
        // Cache the result
        this.rateLimiter.setCache('categories', categoriesData.categories);
        return categoriesData.categories;
      }

      // Fallback categories if AI fails
      return this.getFallbackCategories();

    } catch (error) {
      console.error('❌ AI category generation error:', error);
      return this.getFallbackCategories();
    }
  }

  /**
   * Generate smart hashtag recommendations
   */
  async generateHashtags(posts, userInteractions = []) {
    try {
      if (!this.model) {
        return this.getFallbackHashtags();
      }
      const cacheKey = 'hashtags';
      
      // Check cache first
      const cached = this.rateLimiter.getCached(cacheKey);
      if (cached) {
        console.log('📦 Using cached hashtags');
        return cached;
      }

      // Check rate limit
      if (!this.rateLimiter.canMakeCall(cacheKey)) {
        console.log('⏱️ Rate limited - using fallback hashtags');
        return this.getFallbackHashtags();
      }

      console.log('🤖 AI: Generating smart hashtag recommendations...');
      this.rateLimiter.recordCall(cacheKey);
      
      // Analyze recent posts and user interactions
      const contentSample = posts.slice(0, 15).map(post => ({
        description: post.description || '',
        type: post.type,
        likes: post.likes || 0,
        comments: post.comments?.length || 0,
      }));

      const prompt = `
Analyze these social media posts and generate smart hashtag recommendations.
Create trending, personalized, and discoverable hashtag lists.

Posts: ${JSON.stringify(contentSample)}
User interactions: ${JSON.stringify(userInteractions.slice(0, 10))}

Generate hashtags in this JSON format:
{
  "hashtags": [
    {
      "id": "trending_hashtags",
      "name": "🔥 Trending",
      "hashtags": ["#viral", "#trending", "#fyp"],
      "color": "#ef4444",
      "description": "What's hot right now"
    }
  ]
}

Create 5-6 hashtag categories:
1. Trending hashtags (viral, popular)
2. Personalized (based on user content)
3. Niche communities
4. Daily/seasonal hashtags
5. Content type hashtags
6. Local/geographic hashtags

Each category should have 8-12 relevant hashtags.
`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const hashtagsData = JSON.parse(jsonMatch[0]);
        console.log('✅ AI: Generated', hashtagsData.hashtags.length, 'hashtag categories');
        return hashtagsData.hashtags;
      }

      // Fallback hashtags if AI fails
      return this.getFallbackHashtags();

    } catch (error) {
      console.error('❌ AI hashtag generation error:', error);
      return this.getFallbackHashtags();
    }
  }

  /**
   * Filter posts by category using AI analysis
   */
  async filterPostsByCategory(posts, category) {
    try {
      const relevantPosts = posts.filter(post => {
        if (!post.description) return false;
        
        const description = post.description.toLowerCase();
        const keywords = category.keywords || [];
        
        // Check if post matches category keywords
        return keywords.some(keyword => 
          description.includes(keyword.toLowerCase())
        );
      });

      // If no keyword matches, use AI for deeper analysis
      if (relevantPosts.length < 3) {
        return posts.slice(0, 10); // Return sample posts
      }

      return relevantPosts;
    } catch (error) {
      console.error('❌ Category filtering error:', error);
      return posts.slice(0, 10);
    }
  }

  /**
   * Filter posts by hashtag
   */
  filterPostsByHashtag(posts, hashtag) {
    return posts.filter(post => {
      const description = (post.description || '').toLowerCase();
      const cleanHashtag = hashtag.replace('#', '').toLowerCase();
      
      return description.includes(`#${cleanHashtag}`) || 
             description.includes(cleanHashtag);
    });
  }

  /**
   * Fallback categories when AI is unavailable
   */
  getFallbackCategories() {
    return [
      {
        id: 'trending',
        name: '🔥 Trending',
        description: 'Hot content right now',
        color: '#ef4444',
        icon: 'trending-up',
        keywords: ['viral', 'trending', 'popular', 'hot']
      },
      {
        id: 'lifestyle',
        name: '✨ Lifestyle',
        description: 'Daily life and inspiration',
        color: '#8b5cf6',
        icon: 'heart',
        keywords: ['lifestyle', 'daily', 'life', 'inspiration']
      },
      {
        id: 'entertainment',
        name: '🎬 Entertainment',
        description: 'Fun videos and content',
        color: '#f59e0b',
        icon: 'play-circle',
        keywords: ['funny', 'entertainment', 'fun', 'comedy']
      },
      {
        id: 'travel',
        name: '🌍 Travel',
        description: 'Explore the world',
        color: '#10b981',
        icon: 'airplane',
        keywords: ['travel', 'adventure', 'explore', 'vacation']
      },
      {
        id: 'food',
        name: '🍔 Food',
        description: 'Delicious recipes and reviews',
        color: '#f97316',
        icon: 'restaurant',
        keywords: ['food', 'recipe', 'cooking', 'restaurant']
      },
      {
        id: 'technology',
        name: '📱 Tech',
        description: 'Latest in technology',
        color: '#3b82f6',
        icon: 'phone-portrait',
        keywords: ['tech', 'technology', 'gadget', 'app']
      }
    ];
  }

  scorePostsByRecordedEngagement(posts = []) {
    return posts
      .filter((post) => post.id && !String(post.id).startsWith('video-'))
      .map((post) => {
        const likes = Array.isArray(post.likes) ? post.likes.length : Number(post.likes || 0);
        const comments = Array.isArray(post.comments)
          ? post.comments.length
          : Number(post.commentCount || post.comments || 0);
        const shares = Array.isArray(post.shares) ? post.shares.length : Number(post.shares || 0);
        const views = Number(post.views || post.viewCount || 0);
        const engagementScore = likes + (comments * 2) + (shares * 3) + (views * 0.1);

        return {
          ...post,
          engagementScore,
          metrics: { likes, comments, shares, views },
        };
      })
      .sort((a, b) => b.engagementScore - a.engagementScore);
  }

  /**
   * Generate popularity rankings from recorded engagement metrics.
   */
  async generatePopularityRankings(posts) {
    try {
      const sortedPosts = this.scorePostsByRecordedEngagement(posts);
      if (!this.model) {
        return this.getFallbackPopularityRankings(sortedPosts);
      }
      const cacheKey = 'popularity';
      
      // Check cache first
      const cached = this.rateLimiter.getCached(cacheKey);
      if (cached) {
        console.log('📦 Using cached popularity rankings');
        return cached;
      }

      // Check rate limit
      if (!this.rateLimiter.canMakeCall(cacheKey)) {
        console.log('⏱️ Rate limited - using recorded engagement rankings');
        return this.getFallbackPopularityRankings(sortedPosts);
      }

      console.log('🚀 AI: Categorizing recorded content popularity...');
      this.rateLimiter.recordCall(cacheKey);

      const prompt = `
Create 4 social media popularity categories in this exact JSON format:
{
  "popularityCategories": [
    {
      "id": "viral_content",
      "name": "🔥 Viral Content",
      "description": "Posts that are trending everywhere",
      "icon": "flame",
      "color": "#ef4444",
      "criteria": "High engagement across all metrics",
      "minEngagementScore": 300
    },
    {
      "id": "most_loved",
      "name": "❤️ Most Loved",
      "description": "Content with the most likes",
      "icon": "heart",
      "color": "#ec4899",
      "criteria": "Highest like count",
      "minEngagementScore": 200
    },
    {
      "id": "most_shared",
      "name": "� Most Shared",
      "description": "Posts people can't stop sharing",
      "icon": "share",
      "color": "#10b981",
      "criteria": "Highest share count",
      "minEngagementScore": 100
    },
    {
      "id": "hot_discussions",
      "name": "💬 Hot Discussions",
      "description": "Posts sparking conversations",
      "icon": "chatbubbles",
      "color": "#8b5cf6",
      "criteria": "High comment engagement",
      "minEngagementScore": 50
    }
  ]
}

Respond with only the JSON, nothing else.`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        console.log('✅ AI: Generated', data.popularityCategories.length, 'popularity categories');
        
        const result = {
          categories: data.popularityCategories,
          rankedPosts: sortedPosts,
        };
        
        // Cache the result
        this.rateLimiter.setCache('popularity', result);
        return result;
      }

      // Fallback to manual popularity categories
      return this.getFallbackPopularityRankings(sortedPosts);

    } catch (error) {
      console.error('❌ AI popularity analysis error:', error);
      return this.getFallbackPopularityRankings(this.scorePostsByRecordedEngagement(posts));
    }
  }

  /**
   * Filter posts by popularity criteria
   */
  filterPostsByPopularity(posts, category) {
    const minScore = category.minEngagementScore || 0;
    
    return this.scorePostsByRecordedEngagement(posts)
      .filter((post) => post.engagementScore >= minScore)
      .slice(0, 50); // Limit to top 50 posts per category
  }

  /**
   * Fallback popularity rankings when AI is unavailable
   */
  getFallbackPopularityRankings(sortedPosts) {
    return {
      categories: [
        {
          id: 'top_viral',
          name: '🔥 Most Viral',
          description: 'Content that\'s breaking the internet',
          icon: 'trending-up',
          color: '#ef4444',
          criteria: 'Highest overall engagement',
          minEngagementScore: 200
        },
        {
          id: 'most_liked',
          name: '❤️ Most Loved', 
          description: 'Posts with the most likes',
          icon: 'heart',
          color: '#ec4899',
          criteria: 'Highest like count',
          minEngagementScore: 100
        },
        {
          id: 'most_shared',
          name: '📤 Most Shared',
          description: 'Content people can\'t stop sharing',
          icon: 'share',
          color: '#10b981',
          criteria: 'Highest share count',
          minEngagementScore: 50
        },
        {
          id: 'most_discussed',
          name: '💬 Most Discussed',
          description: 'Posts sparking conversations',
          icon: 'chatbubbles',
          color: '#8b5cf6',
          criteria: 'Highest comment count',
          minEngagementScore: 30
        },
        {
          id: 'rising_stars',
          name: '⭐ Rising Stars',
          description: 'New content gaining momentum',
          icon: 'star',
          color: '#f59e0b',
          criteria: 'Recent with growing engagement',
          minEngagementScore: 20
        }
      ],
      rankedPosts: sortedPosts
    };
  }

  /**
   * Fallback hashtags when AI is unavailable
   */
  getFallbackHashtags() {
    return [
      {
        id: 'trending_tags',
        name: '🔥 Trending',
        hashtags: ['#viral', '#trending', '#fyp', '#popular', '#hot', '#awesome'],
        color: '#ef4444',
        description: 'What\'s hot right now'
      },
      {
        id: 'lifestyle_tags',
        name: '✨ Lifestyle',
        hashtags: ['#lifestyle', '#daily', '#mood', '#vibes', '#aesthetic', '#selfcare'],
        color: '#8b5cf6',
        description: 'Daily life inspiration'
      },
      {
        id: 'creative_tags',
        name: '🎨 Creative',
        hashtags: ['#art', '#creative', '#design', '#photography', '#artist', '#inspiration'],
        color: '#f59e0b',
        description: 'For creative minds'
      },
      {
        id: 'social_tags',
        name: '👥 Social',
        hashtags: ['#friends', '#family', '#together', '#community', '#love', '#fun'],
        color: '#10b981',
        description: 'Connect with others'
      },
      {
        id: 'motivation_tags',
        name: '💪 Motivation',
        hashtags: ['#motivation', '#success', '#goals', '#inspiration', '#hustle', '#grind'],
        color: '#ec4899',
        description: 'Stay motivated'
      }
    ];
  }
}

// Export singleton instance
export const smartListGenerator = new SmartListGenerator();