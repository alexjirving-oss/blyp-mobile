import * as FileSystem from 'expo-file-system/legacy';
import { geminiApiKey } from '../config/firebase';

// Construct API URL with current key
const getApiUrl = () => `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

class MediaDescriptionService {
  /**
   * Test connection to Gemini API with a simple text request.
   * Returns true when API is reachable and responds OK; otherwise false.
   */
  async testConnection() {
    // Precompute request details so they are available in both try and catch
    const payload = {
      contents: [{
        parts: [{
          text: "Say 'Hello, API is working!' in exactly those words."
        }]
      }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 50
      }
    };
    const apiUrl = getApiUrl();

    try {
      console.log('🧪 Testing Gemini API connection with simple text request...');

      if (!geminiApiKey) {
        console.log('⚠️ No Gemini API key configured; skipping connection test.');
        return false;
      }

      console.log('🔗 API URL:', apiUrl.substring(0, 80) + '...');
      console.log('📦 Test payload size:', JSON.stringify(payload).length, 'chars');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for test

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('📊 Test response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log('❌ Test response error:', errorText);
        throw new Error(`API test failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ API test successful:', data);
      return true;

    } catch (error) {
      console.log('❌ Gemini API test error:', error.message);

      // If aborted, try once more with longer timeout
      if (error.name === 'AbortError' || (typeof error.message === 'string' && error.message.includes('Aborted'))) {
        console.log('🔄 Retrying API test with longer timeout...');
        try {
          const retryController = new AbortController();
          const retryTimeoutId = setTimeout(() => retryController.abort(), 20000); // 20 second timeout

          const retryResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: retryController.signal,
          });

          clearTimeout(retryTimeoutId);

          if (retryResponse.ok) {
            console.log('✅ API test successful on retry');
            return true;
          }
        } catch (retryError) {
          console.log('❌ API test retry also failed:', retryError.message);
        }
      }

      return false;
    }
  }

  /**
   * Returns true when the description is too generic, time-based,
   * an AI refusal, truncated, or otherwise useless.
   */
  isGenericDescription(raw) {
    if (raw == null) return true;

    const text = String(raw).trim();
    if (!text) return true;

    const lower = text.toLowerCase();

    // Very generic single words
    const veryGenericSingles = ['photo', 'image', 'picture'];
    if (veryGenericSingles.includes(lower)) {
      return true;
    }

    // Generic / template-y openings
    const genericPrefixes = [
      'a photo',
      'photo of',
      'an image',
      'image of',
      'the image shows',
      'this is a picture',
      'this picture',
      'this photo',
      'i see a photo',
      'i see an image',
    ];
    if (genericPrefixes.some(prefix => lower.startsWith(prefix))) {
      return true;
    }

    // "Truncated" markers from Gemini / mocks
    if (lower.startsWith('truncated')) {
      return true;
    }

    // Too short to be meaningful
    if (lower.length <= 5) {
      return true;
    }

    // Time / timestamp / date patterns
    const timeOrDatePattern = /\b(\d{1,2}:\d{2}\s*(am|pm)?|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
    if (timeOrDatePattern.test(lower)) {
      return true;
    }

    // AI refusal style messages
    const refusalFragments = [
      'sorry, i cannot',
      "sorry, i can't",
      'as an ai',
      'i am unable',
      'i cannot describe',
      "i can't describe",
      'i cannot provide',
      "i can't provide",
      'i see a photo',
      'i see an image',
    ];
    if (refusalFragments.some(fragment => lower.includes(fragment))) {
      return true;
    }

    return false;
  }

  /**
   * Helper: Call Gemini API for description with optional simpler prompt.
   */
  async callGeminiForDescription(mediaItem, { simplePrompt }) {
    const base64Data = await FileSystem.readAsStringAsync(mediaItem.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const prompt = simplePrompt
      ? `Describe this ${mediaItem.type} in one short casual sentence. No emojis.`
      : `Describe this ${mediaItem.type} in a natural, casual way like someone would actually talk. One casual sentence, no emojis.`;

    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: 'image/jpeg',
              data: base64Data,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: simplePrompt ? 100 : 1000,
      },
    };

    const body = JSON.stringify(payload);
    this.log('📦 Description payload size:', body.length, 'chars');

    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    this.log('📊 Description response status:', response.status, response.statusText);

    const json = await response.json();
    this.log('📊 Description API Response:', json);
    return json;
  }

  /**
   * Helper: Extract candidate text and finishReason from Gemini response.
   * Returns { text, finishReason } or null for malformed/blocked responses.
   */
  extractCandidate(apiResponse) {
    const candidates = apiResponse?.candidates;

    if (!Array.isArray(candidates) || candidates.length === 0) {
      this.log('❌ Unexpected description response structure:', apiResponse);
      return null;
    }

    const candidate = candidates[0];
    this.log('📋 Candidate structure:', candidate);

    // Safety filter blocked content
    if (candidate.finishReason === 'SAFETY') {
      this.log('❌ Description blocked by safety filter');
      return null;
    }

    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts) || parts.length === 0) {
      this.log('❌ Missing content.parts in candidate');
      return null;
    }

    const text = parts
      .map(p => (typeof p.text === 'string' ? p.text : ''))
      .join(' ')
      .trim();

    if (!text) {
      this.log('❌ Empty description text in candidate');
      return null;
    }

    return {
      text,
      finishReason: candidate.finishReason || 'STOP',
    };
  }

  /**
   * Internal log helper.
   */
  log(...args) {
    console.log(...args);
  }

  /**
   * Generate full post data with image analysis and context from multiple media
   * @param {string} mediaUri - URI of the primary image to analyze
   * @param {string} contextPrompt - Context about what to create
   * @param {Array} mediaDescriptions - Array of descriptions for all media
   * @returns {Promise<Object>} - Generated post data with title, description, hashtags
   */
  async generateFullPostDataWithContext(mediaUri, contextPrompt, mediaDescriptions = []) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 20000); // Reduced to 20 seconds
    
    try {
      console.log('🚀 Starting contextual post generation', { mediaUri, contextPrompt, descriptionsCount: mediaDescriptions.length });
      
      if (!geminiApiKey) {
        console.log('❌ No Gemini API key configured, using fallback');
        return this.getContextualFallback(mediaDescriptions);
      }
      
      if (!mediaUri) {
        console.log('❌ No media URI provided');
        return this.getContextualFallback(mediaDescriptions);
      }

      // Check if this is a video file and skip processing
      if (mediaUri.includes('.mp4') || mediaUri.includes('.mov') || mediaUri.includes('.avi')) {
        console.log('⚠️ Video file detected, using fallback description');
        return this.getVideoFallbackDescription();
      }
      
      // Check file size before reading to prevent memory issues
      let fileInfo;
      try {
        fileInfo = await FileSystem.getInfoAsync(mediaUri);
        if (fileInfo.size > 5000000) { // 5MB limit
          console.log('⚠️ File too large for processing', { size: fileInfo.size });
          return this.getContextualFallback(mediaDescriptions);
        }
      } catch (sizeError) {
        console.log('⚠️ Could not check file size, proceeding carefully');
      }

      // Read image as base64 with error handling
      let base64Data;
      try {
        base64Data = await FileSystem.readAsStringAsync(mediaUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        console.log('✅ Media file read for description', { size: base64Data.length });
      } catch (fileError) {
        console.log('❌ Failed to read media file:', fileError.message);
        return this.getContextualFallback(mediaDescriptions);
      }

      // Check if image is too large (reduced to 2MB to prevent memory issues)
      if (base64Data.length > 2000000) {
        console.log('⚠️ Image too large for description, using fallback', { size: base64Data.length });
        return this.getContextualFallback(mediaDescriptions);
      }

      // Extract user voice/text from contextPrompt - this should be the PRIMARY focus
      let promptText = "Create a social media post. Return ONLY valid JSON with title, description, and hashtags.";
      
      // Check if this is a user-focused prompt (contains voice or user input)
      if (contextPrompt && (contextPrompt.includes('voice description') || contextPrompt.includes('USER\'S MESSAGE') || contextPrompt.includes('what the user SAID'))) {
        // Extract the user's voice input - this is the MAIN content
        let voiceMatch = contextPrompt.match(/voice description "([^"]+)"/i);
        if (!voiceMatch) {
          voiceMatch = contextPrompt.match(/USER'S MESSAGE.*?: "([^"]+)"/i);
        }
        if (!voiceMatch) {
          voiceMatch = contextPrompt.match(/user SAID: "([^"]+)"/i);
        }
        
        if (voiceMatch && voiceMatch[1]) {
          const userVoiceContent = voiceMatch[1];
          promptText = `IGNORE THE IMAGE COMPLETELY. Write a social media post ONLY about what the user said: "${userVoiceContent}".

CRITICAL INSTRUCTION: 
- The image is IRRELEVANT - do not describe what you see
- Write ONLY about: "${userVoiceContent}"
- If they mention feelings/thoughts/activities not visible, INCLUDE them
- Write naturally and casually like a real person
- Use some casual language but don't overdo slang abbreviations
- Make it about their MESSAGE, not the photo
- Generate a SHORT TITLE (50 characters max) based on "${userVoiceContent}"

EXAMPLE: 
- User says "I'm so tired" → Write about being tired, NOT about what's in photo
- User says "loving this coffee" → Write about coffee, even if not visible
- User says "stressed about work" → Focus on stress, not visual elements

Photo context (minimal): ${mediaDescriptions.join('. ')}

Write about "${userVoiceContent}" as the main story. Include a short catchy title (50 chars max). Return ONLY valid JSON.`;
        }
      } else if (mediaDescriptions.length > 1) {
        promptText = `Create a social media post about these photos: ${mediaDescriptions.join('. ')}. Return ONLY valid JSON format.`;
      } else if (mediaDescriptions.length === 1) {
        promptText = `Create a social media post about: ${mediaDescriptions[0]}. Return ONLY valid JSON format.`;
      }

      const payload = {
        contents: [{
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              "title": { "type": "STRING" },
              "description": { "type": "STRING" },
              "hashtags": { 
                "type": "ARRAY", 
                "items": { "type": "STRING" } 
              }
            },
            required: ["title", "description", "hashtags"]
          }
        }
      };

      console.log('🌐 Sending contextual request to Gemini API...');
      const apiUrl = getApiUrl();
      console.log('📦 Payload size:', JSON.stringify(payload).length, 'chars');

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: abortController.signal
      });

      clearTimeout(timeoutId);
      console.log('📡 Received contextual API response', { status: response.status, ok: response.ok });

      if (!response.ok) {
        const errorText = await response.text();
        console.log('❌ API Error Response:', errorText);
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Raw contextual response:', data);

      if (data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        
        // Check for MAX_TOKENS or other issues
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.log('⚠️ Response truncated due to token limit, using fallback');
          return this.getContextualFallback(mediaDescriptions);
        }
        
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          try {
            const responseText = candidate.content.parts[0].text;
            console.log('🎯 Contextual response text:', responseText);
            
            const generatedContent = JSON.parse(responseText);
            console.log('✅ Parsed contextual content:', generatedContent);
            
            const result = {
              title: generatedContent.title || 'My Photos',
              description: generatedContent.description || this.getContextualFallback(mediaDescriptions).description,
              hashtags: Array.isArray(generatedContent.hashtags) ? generatedContent.hashtags : ['photos', 'memories', 'life']
            };
            
            console.log('✅ Final contextual content:', result);
            return result;
          } catch (parseError) {
            console.log('❌ Failed to parse contextual response:', parseError.message);
            return this.getContextualFallback(mediaDescriptions);
          }
        } else {
          console.log('⚠️ Missing content parts in response');
          return this.getContextualFallback(mediaDescriptions);
        }
      }

      console.log('❌ Unexpected contextual response structure');
      return this.getContextualFallback(mediaDescriptions);

    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError' || error.message.includes('aborted')) {
        console.log('⏰ AI generation timed out after 20 seconds, using smart fallback');
      } else {
        console.log('❌ Error in contextual generation:', error.message);
      }
      
      // Create a smarter fallback that uses the context prompt if available
      const smartFallback = this.getSmartContextualFallback(contextPrompt, mediaDescriptions);
      return smartFallback;
    }
  }

  /**
   * Generate full post data with image analysis and user prompt
   * @param {string} mediaUri - URI of the image to analyze
   * @param {string} userPrompt - User's voice input or text prompt
   * @returns {Promise<Object>} - Generated post data with title, description, hashtags
   */
  async generateFullPostData(mediaUri, userPrompt = '') {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 20000); // Reduced to 20 seconds for better UX
    
    try {
      console.log('🚀 Starting full post data generation', { mediaUri, userPrompt });
      
      if (!geminiApiKey) {
        console.log('❌ No Gemini API key configured, using fallback');
        return this.getSmartFallbackDescription(null, userPrompt);
      }
      
      if (!mediaUri) {
        console.log('❌ No media URI provided');
        return this.getSmartFallbackDescription(null, userPrompt);
      }

      // Read image as base64 with error handling
      let base64Data;
      try {
        base64Data = await FileSystem.readAsStringAsync(mediaUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        console.log('✅ Media file read successfully', { size: base64Data.length });
      } catch (fileError) {
        console.log('❌ Failed to read media file:', fileError.message);
        return this.getSmartFallbackDescription(null, userPrompt);
      }

      // Check if image is too large (limit to ~2MB base64 = ~1.5MB original)
      if (base64Data.length > 2000000) {
        console.log('⚠️ Image too large, using fallback', { size: base64Data.length });
        return this.getSmartFallbackDescription(null, userPrompt);
      }

      const enhancedPrompt = `Create a social media post based on this image. User context: "${userPrompt}"

Return JSON format:
{
  "title": "Short catchy title (max 50 chars)", 
  "description": "Engaging post description with 2-3 emojis",
  "hashtags": ["tag1", "tag2", "tag3", "tag4"]
}

Make it fun and authentic based on what you see and the user's context: "${userPrompt}"`;

      const payload = {
        contents: [{
          parts: [
            { text: enhancedPrompt },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Data
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1500,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              "title": { "type": "STRING" },
              "description": { "type": "STRING" },
              "hashtags": { 
                "type": "ARRAY", 
                "items": { "type": "STRING" } 
              }
            },
            required: ["title", "description", "hashtags"]
          }
        }
      };

      console.log('🌐 Sending request to Gemini API...');
      const apiUrl = getApiUrl();
      console.log('🔗 API URL:', apiUrl.substring(0, 80) + '...');
      console.log('📦 Payload size:', JSON.stringify(payload).length, 'chars');
      console.log('🖼️ Image size:', base64Data.length, 'chars');
      console.log('💬 User prompt:', userPrompt);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: abortController.signal
      });

      clearTimeout(timeoutId);

      console.log('📡 Received API response', { 
        status: response.status, 
        statusText: response.statusText,
        ok: response.ok 
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log('❌ API Error Response:', errorText);
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Raw Gemini response:', data);

      if (data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        
        // Check for MAX_TOKENS or other issues
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.log('⚠️ Response truncated due to token limit, using fallback');
          return this.getSmartFallbackDescription(null, userPrompt);
        }
        
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
          try {
            const responseText = candidate.content.parts[0].text;
            console.log('🎯 Raw AI response text:', responseText);
            
            // Check if response looks like instructions instead of JSON
            if (responseText.includes('Generate an engaging') || responseText.includes('Create compelling content')) {
              console.log('❌ AI returned instructions instead of content, using fallback');
              return this.getSmartFallbackDescription(null, userPrompt);
            }
            
            const generatedContent = JSON.parse(responseText);
            console.log('✅ Parsed generated content:', generatedContent);
            
            // Validate and ensure all required fields
            const result = {
              title: generatedContent.title || 'My Story',
              description: generatedContent.description || this.getSmartFallbackDescription(null, userPrompt).description,
              hashtags: Array.isArray(generatedContent.hashtags) ? generatedContent.hashtags : ['story', 'moment', 'life']
            };
            
            console.log('✅ Final generated content:', result);
            return result;
          } catch (parseError) {
            console.log('❌ Failed to parse AI response:', parseError.message);
            return this.getSmartFallbackDescription(null, userPrompt);
          }
        }
      }

      console.log('❌ Unexpected API response structure');
      return this.getSmartFallbackDescription(null, userPrompt);

    } catch (error) {
      clearTimeout(timeoutId);
      console.log('❌ Error in generateFullPostData', { error: error.message, stack: error.stack });
      
      if (error.name === 'AbortError') {
        console.log('⏰ Request timed out');
      }
      
      return this.getSmartFallbackDescription(null, userPrompt);
    }
  }

  /**
   * Generate a 1-sentence description for a single media item
   * @param {Object} mediaItem - Media item with uri and type
   * @returns {Promise<string|null>} - Single sentence description or null if failed/generic
   */
  async generateMediaDescription(mediaItem) {
    try {
      this.log('🚀 Starting AI media description for ' + mediaItem.type + '...');

      if (!geminiApiKey) {
        this.log('❌ No Gemini API key configured');
        return null;
      }

      if (!mediaItem?.uri) {
        this.log('❌ No media URI provided');
        return null;
      }

      // FIRST CALL – normal prompt
      const primaryJson = await this.callGeminiForDescription(mediaItem, { simplePrompt: false });
      let candidate = this.extractCandidate(primaryJson);

      if (!candidate) {
        // empty candidates / missing content / safety → no description
        return null;
      }

      if (candidate.finishReason === 'MAX_TOKENS') {
        this.log('⚠️ MAX_TOKENS hit, retrying with simpler prompt...');

        const retryJson = await this.callGeminiForDescription(mediaItem, { simplePrompt: true });
        candidate = this.extractCandidate(retryJson);

        if (!candidate) {
          return null;
        }

        if (this.isGenericDescription(candidate.text)) {
          return null;
        }

        this.log('✅ AI description generated (retry):', candidate.text);
        return candidate.text;
      }

      // Normal STOP path
      if (this.isGenericDescription(candidate.text)) {
        return null;
      }

      this.log('✅ AI description generated:', candidate.text);
      return candidate.text;

    } catch (error) {
      this.log('❌ Error in generateMediaDescription:', error?.message ?? error);
      return null;
    }
  }

  /**
   * Generate descriptions for multiple media items
   * @param {Array} mediaItems - Array of media items
   * @returns {Promise<Array>} - Array of descriptions
   */
  async generateMediaDescriptions(mediaItems) {
    this.log('🎯 Generating descriptions for %d media items...', mediaItems.length);
    this.log('📋 Media items to process:', mediaItems);

    // Tests expect this call to consume the first fetch mock
    await this.testConnection();

    const rawResults = [];

    // Sequential to keep fetch order predictable
    for (let i = 0; i < mediaItems.length; i += 1) {
      rawResults[i] = await this.generateMediaDescription(mediaItems[i], i);
    }

    const finalResults = rawResults.map((desc, index) => {
      if (desc && !this.isGenericDescription(desc)) {
        return desc;
      }
      return this.getFallbackDescription(mediaItems[index], index);
    });

    this.log('✅ Generated descriptions:', finalResults);
    return finalResults;
  }

  /**
   * Get fallback description for a single media item
   * @param {Object} mediaItem - Media item
   * @param {number} index - Item index for numbering
   * @returns {string} - Fallback description
   */
  getFallbackDescription(mediaItem, index = 0) {
    const base = mediaItem?.type === 'video' ? 'Video' : 'Photo';

    if (index === 0) {
      return `${base} shared by the user`;
    }

    const displayIndex = index + 1;
    return `${base} ${displayIndex} shared by the user`;
  }

  /**
   * Get smart fallback description that incorporates user input
   * @param {Object} mediaItem - Media item (can be null)
   * @param {string} userPrompt - User's voice input or text
   * @returns {Object} - Fallback post data with title, description, hashtags
   */
  getSmartFallbackDescription(mediaItem, userPrompt = '') {
    console.log('🔄 Creating smart fallback with user input:', userPrompt);
    
    // Clean and use the user's actual words
    const cleanPrompt = userPrompt.trim();
    
    if (cleanPrompt && cleanPrompt.length > 0) {
      return {
        title: 'My Story',
        description: `${cleanPrompt} 📱✨`,
        hashtags: ['story', 'personal', 'life', 'sharing', 'moment']
      };
    }
    
    // Default fallback if no user input
    return {
      title: 'Captured Moment',
      description: 'A moment worth sharing ✨📸',
      hashtags: ['moment', 'capture', 'memories', 'life']
    };
  }

  /**
   * Get contextual fallback based on media descriptions
   * @param {Array} mediaDescriptions - Array of media descriptions
   * @returns {Object} - Fallback post data
   */
  getContextualFallback(mediaDescriptions = []) {
    console.log('🔄 Creating contextual fallback with descriptions:', mediaDescriptions.length);
    
    if (mediaDescriptions.length > 1) {
      return {
        title: 'Photo Collection',
        description: 'Sharing some awesome moments! 📸✨',
        hashtags: ['photos', 'collection', 'memories', 'life', 'moments']
      };
    } else if (mediaDescriptions.length === 1) {
      return {
        title: 'My Photo',
        description: 'Captured a great moment! 📷✨',
        hashtags: ['photo', 'moment', 'life', 'capture']
      };
    }
    
    return {
      title: 'My Post',
      description: 'Sharing something special 📱✨',
      hashtags: ['post', 'sharing', 'life']
    };
  }

  /**
   * Get smart contextual fallback that uses voice input context
   * @param {string} contextPrompt - User's voice input or context
   * @param {Array} mediaDescriptions - Array of media descriptions
   * @returns {Object} - Smart fallback post data
   */
  getSmartContextualFallback(contextPrompt = '', mediaDescriptions = []) {
    console.log('🧠 Creating smart contextual fallback', { contextPrompt, descriptionsCount: mediaDescriptions.length });
    
    // If we have voice input context, use it
    if (contextPrompt && contextPrompt.trim()) {
      const voiceText = contextPrompt.trim();
      return {
        title: mediaDescriptions.length > 1 ? 'Photo Collection' : 'My Photo',
        description: `${voiceText} 📸✨`,
        hashtags: ['photo', 'voice', 'moment', 'life', 'capture']
      };
    }
    
    // Fall back to regular contextual fallback
    return this.getContextualFallback(mediaDescriptions);
  }

  /**
   * Get video-specific fallback when video processing is skipped
   * @returns {Object} - Video fallback post data
   */
  getVideoFallbackDescription() {
    const timestamp = new Date().toLocaleTimeString();
    return {
      title: 'Video Content',
      description: `Check out this video content captured at ${timestamp} 🎥✨`,
      hashtags: ['video', 'content', 'media', 'capture']
    };
  }
}

export default new MediaDescriptionService();