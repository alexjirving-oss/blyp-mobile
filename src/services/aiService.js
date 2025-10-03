import { geminiApiKey, geminiApiUrl } from '../config/firebase';

/**
 * AI Service for Blyp Mobile
 * 
 * Provides intelligent post generation using Google's Gemini API
 * Features:
 * - Voice-to-text transcription and enhancement
 * - Image/video content analysis
 * - Smart hashtag generation
 * - Social media optimized descriptions
 * - Multi-modal content understanding
 */

class AIService {
  constructor() {
    this.apiKey = geminiApiKey;
    this.apiUrl = geminiApiUrl;
    
    if (!this.apiKey) {
      console.warn('⚠️ Gemini API key not configured. AI features will be disabled.');
    }
  }

  /**
   * Check if AI service is available
   */
  isAvailable() {
    return Boolean(this.apiKey && this.apiUrl);
  }

  /**
   * Test API connectivity
   */
  async testConnection() {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      console.log('🧪 Testing Gemini API connection...');
      
      const testPayload = {
        contents: [{ 
          parts: [{ text: "Hello" }] 
        }],
        generationConfig: {
          maxOutputTokens: 10
        }
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload)
      });

      const success = response.ok;
      console.log(success ? '✅ API connection successful' : '❌ API connection failed');
      return success;

    } catch (error) {
      console.error('❌ API connection test failed:', error);
      return false;
    }
  }

  /**
   * Convert blob to base64 data URL for API transmission
   */
  async blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        const base64Data = result.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Convert file URI to base64 for React Native
   */
  async uriToBase64(uri) {
    try {
      const response = await fetch(uri);
      const blob = await response.blob();
      return await this.blobToBase64(blob);
    } catch (error) {
      console.error('Error converting URI to base64:', error);
      throw error;
    }
  }

  /**
   * Enhance user voice input with AI-powered content generation
   * 
   * @param {string} userVoiceInput - Raw transcribed voice input from user
   * @param {Array} mediaItems - Array of media objects with {uri, type} format
   * @param {Object} options - Configuration options
   * @returns {Promise<Object>} Generated content with title, description, hashtags
   */
  async generateSmartContent(userVoiceInput, mediaItems = [], options = {}) {
    if (!this.isAvailable()) {
      throw new Error('AI service is not available. Please configure Gemini API key.');
    }

    console.log('🤖 Starting AI content generation...');
    console.log('🤖 Voice input:', userVoiceInput);
    console.log('🤖 Media items:', mediaItems.length);

    try {
      // Build the prompt for intelligent content generation
      const prompt = this.buildContentPrompt(userVoiceInput, mediaItems, options);
      
      // Prepare API request parts
      let parts = [{ text: prompt }];

      // Add media analysis for images (videos not supported in API yet)
      const imageItems = mediaItems.filter(item => 
        item.type === 'photo' || 
        item.type === 'image' || 
        (item.mimeType && item.mimeType.startsWith('image/'))
      );

      // Process images for content analysis
      for (const mediaItem of imageItems) {
        try {
          console.log('🖼️ Processing image for AI analysis:', mediaItem.uri);
          
          const base64Data = await this.uriToBase64(mediaItem.uri);
          const mimeType = mediaItem.mimeType || 'image/jpeg';
          
          parts.push({
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          });

          console.log('✅ Image processed for AI analysis');
        } catch (error) {
          console.error('⚠️ Failed to process image for AI:', error);
          // Continue without this image
        }
      }

      // Make API request to Gemini
      const response = await this.makeGeminiRequest(parts);
      
      console.log('✅ AI content generated successfully');
      return response;

    } catch (error) {
      console.error('❌ AI content generation failed:', error);
      
      // Return fallback content
      return this.generateFallbackContent(userVoiceInput, mediaItems);
    }
  }

  /**
   * Build intelligent prompt for content generation
   */
  buildContentPrompt(userVoiceInput, mediaItems, options = {}) {
    const hasImages = mediaItems.some(item => 
      item.type === 'photo' || item.type === 'image' || 
      (item.mimeType && item.mimeType.startsWith('image/'))
    );
    const hasVideos = mediaItems.some(item => 
      item.type === 'video' || 
      (item.mimeType && item.mimeType.startsWith('video/'))
    );

    const mediaContext = hasImages ? 
      (hasVideos ? 'images and videos' : 'images') : 
      (hasVideos ? 'videos' : 'no media');

    const platformHint = options.platforms && options.platforms.length > 0 ?
      `This will be shared on: ${options.platforms.join(', ')}. ` : '';

    return `Act as a top-tier social media content creator and influencer. 

User's voice description: "${userVoiceInput}"
Media attached: ${mediaContext}
${platformHint}

Based on the user's voice input${hasImages ? ' and the attached images' : ''}, create engaging social media content.

Generate a JSON response with:
1. "title" - A short, catchy title (max 50 chars)
2. "description" - A compelling, human-sounding description with relevant emojis (max 280 chars)
3. "hashtags" - Array of 4-6 relevant hashtags (strings without #)
4. "mood" - The emotional tone (happy, inspiring, funny, thoughtful, etc.)
5. "engagement_hook" - A question or call-to-action to boost engagement

Make it authentic, engaging, and optimized for social media virality. Include relevant emojis naturally in the description.`;
  }

  /**
   * Make request to Gemini API
   */
  async makeGeminiRequest(parts) {
    const payload = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            "title": { "type": "STRING" },
            "description": { "type": "STRING" },
            "hashtags": { 
              "type": "ARRAY", 
              "items": { "type": "STRING" } 
            },
            "mood": { "type": "STRING" },
            "engagement_hook": { "type": "STRING" }
          },
          required: ["title", "description", "hashtags"]
        }
      }
    };

    console.log('🌐 Making Gemini API request...', {
      url: this.apiUrl,
      hasApiKey: !!this.apiKey,
      partsCount: parts.length
    });

    // Add timeout to prevent infinite loading
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('AI request timeout - using fallback content')), 30000); // 30 second timeout
    });

    const fetchPromise = fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Gemini API error:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('📄 Gemini API response received');
    
    if (!result.candidates || !result.candidates[0]) {
      console.error('❌ Invalid Gemini API response structure:', result);
      throw new Error('Invalid response from Gemini API');
    }

    const generatedText = result.candidates[0].content.parts[0].text;
    console.log('🎯 Generated text:', generatedText);
    
    const generatedData = JSON.parse(generatedText);

    return {
      title: generatedData.title || 'New Post',
      description: generatedData.description || '',
      hashtags: generatedData.hashtags || [],
      mood: generatedData.mood || 'neutral',
      engagementHook: generatedData.engagement_hook || '',
      isAIGenerated: true
    };
  }

  /**
   * Generate fallback content when AI is unavailable
   */
  generateFallbackContent(userVoiceInput, mediaItems) {
    console.log('🔄 Generating smart fallback content...');

    const hasMedia = mediaItems && mediaItems.length > 0;
    
    // Analyze input for intelligent fallback
    const input = userVoiceInput.toLowerCase();
    
    // Determine mood from keywords
    let mood = 'neutral';
    let emoji = '💭';
    let contextHashtags = [];
    
    if (input.includes('amazing') || input.includes('awesome') || input.includes('great')) {
      mood = 'excited';
      emoji = '✨';
      contextHashtags = ['amazing', 'excited'];
    } else if (input.includes('beautiful') || input.includes('stunning')) {
      mood = 'inspired';
      emoji = '🌟';
      contextHashtags = ['beautiful', 'inspiration'];
    } else if (input.includes('fun') || input.includes('enjoy')) {
      mood = 'happy';
      emoji = '😊';
      contextHashtags = ['fun', 'goodtimes'];
    } else if (hasMedia) {
      emoji = '📸';
      contextHashtags = ['moment', 'memories'];
    }

    // Extract any existing hashtags from voice input
    const existingHashtags = (userVoiceInput.match(/#\w+/g) || [])
      .map(tag => tag.substring(1));

    const allHashtags = [...new Set([...existingHashtags, ...contextHashtags, 'life', 'blyp'])];
    
    // Generate engagement hook based on content
    const engagementHooks = [
      "What do you think?",
      "Anyone else feeling this?",
      "Share your thoughts below!",
      "Who can relate?",
      "Let me know in the comments!"
    ];
    const randomHook = engagementHooks[Math.floor(Math.random() * engagementHooks.length)];
    
    return {
      title: userVoiceInput.substring(0, 50) || 'New Post',
      description: userVoiceInput ? `${emoji} ${userVoiceInput}` : `${emoji} Sharing a special moment`,
      hashtags: allHashtags.slice(0, 5),
      mood: mood,
      engagementHook: randomHook,
      isAIGenerated: false
    };
  }

  /**
   * Enhance existing text with AI suggestions
   * 
   * @param {string} existingText - Current post text
   * @param {Array} mediaItems - Associated media
   * @returns {Promise<Object>} Enhanced content suggestions
   */
  async enhanceExistingContent(existingText, mediaItems = []) {
    if (!this.isAvailable()) {
      return this.generateFallbackContent(existingText, mediaItems);
    }

    try {
      const prompt = `Enhance this social media post while keeping the original meaning:

Original: "${existingText}"

Improve it by:
1. Adding relevant emojis naturally
2. Making it more engaging
3. Suggesting better hashtags
4. Keeping the authentic voice

Provide JSON with: title, description, hashtags, mood, engagement_hook`;

      const parts = [{ text: prompt }];
      return await this.makeGeminiRequest(parts);

    } catch (error) {
      console.error('Failed to enhance content:', error);
      return this.generateFallbackContent(existingText, mediaItems);
    }
  }

  /**
   * Generate hashtags based on content analysis
   * 
   * @param {string} text - Post content
   * @param {Array} mediaItems - Associated media
   * @returns {Promise<Array>} Array of hashtag suggestions
   */
  async generateHashtags(text, mediaItems = []) {
    try {
      const content = await this.generateSmartContent(text, mediaItems);
      return content.hashtags;
    } catch (error) {
      console.error('Failed to generate hashtags:', error);
      
      // Fallback hashtag generation
      const words = text.toLowerCase().split(/\s+/);
      const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were'];
      const relevantWords = words.filter(word => 
        word.length > 3 && !commonWords.includes(word)
      );
      
      return [...relevantWords.slice(0, 3), 'blyp'];
    }
  }

  /**
   * Analyze sentiment of content
   * 
   * @param {string} text - Text to analyze
   * @returns {Promise<Object>} Sentiment analysis result
   */
  async analyzeSentiment(text) {
    if (!this.isAvailable()) {
      return { mood: 'neutral', confidence: 0.5 };
    }

    try {
      const prompt = `Analyze the emotional tone of this text: "${text}"

Return JSON with:
- mood: (happy, sad, excited, calm, angry, funny, thoughtful, inspiring, etc.)
- confidence: (0.0-1.0)
- keywords: array of emotional keywords found`;

      const parts = [{ text: prompt }];
      const response = await this.makeGeminiRequest(parts);
      
      return {
        mood: response.mood || 'neutral',
        confidence: 0.8,
        keywords: response.keywords || []
      };

    } catch (error) {
      console.error('Failed sentiment analysis:', error);
      return { mood: 'neutral', confidence: 0.5 };
    }
  }
}

// Export singleton instance
export default new AIService();

// Export class for testing
export { AIService };