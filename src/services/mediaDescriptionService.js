import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { geminiApiKey, geminiApiUrl, geminiAuthHeaders } from '../config/firebase';

// P7.4: route through the authenticated server proxy (key stays server-side).
const getApiUrl = () => geminiApiUrl;

class MediaDescriptionService {
  constructor() {
    this.lastConnectionError = null;
  }

  async ensureReadableFileUri(inputUri, { prefix = 'blyp', extension = '' } = {}) {
    if (!inputUri || typeof inputUri !== 'string') return null;

    // Most Expo APIs can work with file:// directly.
    if (inputUri.startsWith('file://')) {
      return inputUri;
    }

    // Android gallery often returns content:// URIs; copy to cache first.
    if (inputUri.startsWith('content://')) {
      try {
        const safeExt = extension ? `.${extension.replace(/^\./, '')}` : '';
        const dest = `${FileSystem.cacheDirectory}${prefix}-${Date.now()}${safeExt}`;
        await FileSystem.copyAsync({ from: inputUri, to: dest });
        return dest;
      } catch (e) {
        this.log('⚠️ Failed to copy content URI to cache:', e?.message ?? e);
        return null;
      }
    }

    // Already some other scheme (e.g. http(s), asset), return as-is and let callers decide.
    return inputUri;
  }

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
        this.lastConnectionError = { code: 'NO_KEY', message: 'Missing Gemini API key' };
        return false;
      }

      console.log('🔗 API URL:', apiUrl.substring(0, 80) + '...');
      console.log('📦 Test payload size:', JSON.stringify(payload).length, 'chars');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout for test

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: await geminiAuthHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('📊 Test response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.log('❌ Test response error:', errorText);
        this.lastConnectionError = {
          code: 'HTTP_ERROR',
          status: response.status,
          message: errorText?.slice?.(0, 300) || String(errorText)
        };
        throw new Error(`API test failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ API test successful:', data);
      this.lastConnectionError = null;
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
            headers: await geminiAuthHeaders(),
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

  async getImageUriForMedia(mediaItem) {
    if (!mediaItem?.uri) return null;

    if (mediaItem.type !== 'video') {
      // Ensure we can read it as a file if possible (content:// on Android).
      return await this.ensureReadableFileUri(mediaItem.uri, { prefix: 'blyp-image', extension: 'jpg' }) || mediaItem.uri;
    }

    try {
      const videoUri = await this.ensureReadableFileUri(mediaItem.uri, { prefix: 'blyp-video', extension: 'mp4' }) || mediaItem.uri;

      // Some videos can't thumbnail at 1000ms (very short, keyframe placement, etc).
      // Try a few times and accept the first that works.
      const candidateTimesMs = [0, 500];

      for (const time of candidateTimesMs) {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
            time,
            quality: 0.55,
          });

          if (!uri) continue;

          // Ensure the thumbnail file actually exists.
          try {
            const info = await FileSystem.getInfoAsync(uri);
            if (info?.exists) {
              return uri;
            }
          } catch {
            // If getInfoAsync fails, still return and let read step decide.
            return uri;
          }
        } catch (inner) {
          this.log(`⚠️ Video thumbnail failed at ${time}ms:`, inner?.message ?? inner);
        }
      }

      return null;
    } catch (e) {
      this.log('⚠️ Failed to generate video thumbnail for description:', e?.message ?? e);
      return null;
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
    const imageUri = await this.getImageUriForMedia(mediaItem);
    if (!imageUri) {
      throw new Error('No image available for description');
    }

    let base64Data;
    try {
      base64Data = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } catch (e) {
      // If the thumbnail was a content:// URI or otherwise unreadable, try copying to cache and reading again.
      const copied = await this.ensureReadableFileUri(imageUri, { prefix: 'blyp-thumb', extension: 'jpg' });
      if (copied && copied !== imageUri) {
        base64Data = await FileSystem.readAsStringAsync(copied, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } else {
        throw e;
      }
    }

    const promptType = mediaItem.type === 'video' ? 'video (based on a frame)' : mediaItem.type;
    const prompt = simplePrompt
      ? `Describe this ${promptType} in one short casual sentence. No emojis.`
      : `Describe this ${promptType} in a natural, casual way like someone would actually talk. One casual sentence, no emojis.`;

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
      headers: await geminiAuthHeaders(),
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
   * POST to the Gemini endpoint with exponential backoff on rate-limit (429)
   * and transient (503) responses, plus a per-attempt timeout. Keeps bursty
   * AI flows alive against the free-tier per-minute rate limit.
   */
  async postGeminiWithRetry(payload, { maxRetries = 1, baseDelayMs = 1200, timeoutMs = 20000 } = {}) {
    const url = getApiUrl();
    const headers = await geminiAuthHeaders();
    let attempt = 0;
    let lastResponse = null;

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        lastResponse = response;

        if (response.ok) return response;

        if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
          const retryAfter = parseInt(response.headers?.get?.('retry-after') || '', 10);
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15000)
            : baseDelayMs * Math.pow(2, attempt);
          this.log(`⏳ Gemini ${response.status}; retrying in ${waitMs}ms (${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, waitMs));
          attempt += 1;
          continue;
        }

        return response;
      } catch (error) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          const waitMs = baseDelayMs * Math.pow(2, attempt);
          this.log(`⏳ Gemini request error (${error?.message}); retrying in ${waitMs}ms`);
          await new Promise((r) => setTimeout(r, waitMs));
          attempt += 1;
          continue;
        }
        throw error;
      }
    }

    return lastResponse;
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

      // If this is a video file, generate a thumbnail frame and analyze that.
      let effectiveUri = mediaUri;
      if (typeof mediaUri === 'string' && /\.(mp4|mov|avi)(\?|$)/i.test(mediaUri)) {
        console.log('🎬 Video detected for contextual generation; generating thumbnail frame...');
        const thumb = await VideoThumbnails.getThumbnailAsync(mediaUri, { time: 1000, quality: 0.8 });
        if (thumb?.uri) {
          effectiveUri = thumb.uri;
          console.log('✅ Using video thumbnail for contextual generation:', effectiveUri);
        } else {
          console.log('⚠️ Thumbnail generation returned no uri; using fallback');
          return this.getVideoFallbackDescription();
        }
      }
      
      // Check file size before reading to prevent memory issues
      let fileInfo;
      try {
        fileInfo = await FileSystem.getInfoAsync(effectiveUri);
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
        base64Data = await FileSystem.readAsStringAsync(effectiveUri, {
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
        headers: await geminiAuthHeaders(),
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
   * Generate multiple selectable post-description variants.
   *
   * Fuses the literal per-photo descriptions (visual context for EVERY photo)
   * with the user's own description of the post's intent, then returns `count`
   * genuinely distinct caption options for the user to choose from.
   *
   * @param {string[]} perPhotoDescriptions - Literal description of each photo.
   * @param {string} userIntent - What the user said the post is about / aims to achieve.
   * @param {Object} [options]
   * @param {number} [options.count=3] - Variants to return (clamped to 2-3).
   * @returns {Promise<{ variants: Array<{description: string, hashtags: string[]}>, title: string }>}
   */
  async generatePostDescriptionVariants(perPhotoDescriptions = [], userIntent = '', options = {}) {
    const count = Math.max(2, Math.min(3, options.count || 3));
    const descriptions = (perPhotoDescriptions || []).filter(
      (d) => typeof d === 'string' && d.trim().length > 0
    );
    const intent = (userIntent || '').trim();

    if (!geminiApiKey) {
      this.log('❌ No Gemini API key configured; using variant fallback');
      return this.getVariantFallback(descriptions, intent, count);
    }

    const photoContext = descriptions.length > 0
      ? descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')
      : '(no photo descriptions available)';

    const intentBlock = intent.length > 0
      ? `The user described the post like this (THIS is the main point — what the post is about and what it should achieve):\n"${intent}"`
      : `The user did not add their own description, so infer a natural post from the photo context alone.`;

    const promptText = `You are helping someone write the caption for ONE social media post that contains ${descriptions.length || 'some'} photo(s).

LITERAL PHOTO CONTEXT (what is visually in each photo — for grounding only, do NOT just re-describe the photos):
${photoContext}

${intentBlock}

Write ${count} DISTINCT caption options for this single post. Requirements:
- Lead with the user's intent/message; use the photo context only as supporting detail.
- Make the ${count} options genuinely different in tone/angle (e.g. one punchy, one warm & authentic, one playful) — not reworded copies of each other.
- Natural, human, first-person. Light emoji use is fine; do not overdo it.
- Each option max ~280 characters.
- Give each option its own short, catchy title (max 50 characters).
- Provide 4-6 relevant hashtags per option (strings, without the # symbol).
Return ONLY valid JSON.`;

    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            variants: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  description: { type: 'STRING' },
                  hashtags: { type: 'ARRAY', items: { type: 'STRING' } }
                },
                required: ['description']
              }
            }
          },
          required: ['variants']
        }
      }
    };

    try {
      this.log(`🎨 Generating ${count} post-description variants...`, {
        photos: descriptions.length,
        hasIntent: intent.length > 0
      });

      const response = await this.postGeminiWithRetry(payload, { timeoutMs: 20000 });

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : '';
        this.log('❌ Variant API error:', response?.status, errorText?.slice?.(0, 200));
        return this.getVariantFallback(descriptions, intent, count);
      }

      const data = await response.json();
      const candidate = this.extractCandidate(data);
      if (!candidate || !candidate.text) {
        return this.getVariantFallback(descriptions, intent, count);
      }

      let parsed;
      try {
        parsed = JSON.parse(candidate.text);
      } catch (e) {
        this.log('❌ Failed to parse variant JSON:', e?.message ?? e);
        return this.getVariantFallback(descriptions, intent, count);
      }

      const rawVariants = Array.isArray(parsed?.variants) ? parsed.variants : [];
      const variants = rawVariants
        .map((v) => ({
          title: typeof v?.title === 'string' ? v.title.trim().slice(0, 50) : '',
          description: typeof v?.description === 'string' ? v.description.trim() : '',
          hashtags: Array.isArray(v?.hashtags)
            ? v.hashtags
                .filter((h) => typeof h === 'string' && h.trim())
                .map((h) => h.replace(/^#/, '').trim())
            : []
        }))
        .filter((v) => v.description.length > 0)
        .slice(0, count);

      if (variants.length === 0) {
        return this.getVariantFallback(descriptions, intent, count);
      }

      // Top up from fallback if the model returned fewer than requested,
      // so the selector is always populated with `count` options.
      if (variants.length < count) {
        const filler = this.getVariantFallback(descriptions, intent, count).variants;
        for (const f of filler) {
          if (variants.length >= count) break;
          if (!variants.some((v) => v.description === f.description)) variants.push(f);
        }
      }

      const title = typeof parsed?.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : variants[0].description.slice(0, 50);

      this.log(`✅ Generated ${variants.length} variants`);
      return { variants, title };
    } catch (error) {
      if (error.name === 'AbortError') {
        this.log('⏰ Variant generation timed out; using fallback');
      } else {
        this.log('❌ Variant generation error:', error?.message ?? error);
      }
      return this.getVariantFallback(descriptions, intent, count);
    }
  }

  /**
   * MAGIC PATH — one multimodal Gemini call that turns the user's spoken/typed
   * intent + ALL their photos into ready-to-use caption variants in a SINGLE
   * round-trip. Replaces the old per-photo description loop + separate variant
   * call (N+1 sequential calls, each fighting the per-minute rate limit) with
   * one request, so "you speak → here's your post" feels instant.
   *
   * @param {Array} mediaItems - Media items ({ uri, type }).
   * @param {string} userIntent - What the user said/typed the post is about.
   * @param {Object} [options]
   * @param {number} [options.count=3] - Variants to return (clamped 2-3).
   * @param {number} [options.maxImages=4] - Max images to send inline.
   * @returns {Promise<{ variants: Array, title: string, perPhotoDescriptions: string[] }>}
   */
  async generatePostFromMedia(mediaItems = [], userIntent = '', options = {}) {
    const count = Math.max(2, Math.min(3, options.count || 3));
    // Fewer / smaller images = much faster OpenAI vision round-trip via geminiProxy.
    const maxImages = Math.max(1, Math.min(3, options.maxImages || 2));
    const intent = (userIntent || '').trim();
    const items = Array.isArray(mediaItems) ? mediaItems.filter((m) => m?.uri) : [];

    // Deterministic fallback prepared up front so any early return is safe.
    const fallbackDescriptions = items.map((m, i) => this.getFallbackDescription(m, i));
    const buildFallback = () => ({
      ...this.getVariantFallback(fallbackDescriptions, intent, count),
      perPhotoDescriptions: fallbackDescriptions,
    });

    if (!geminiApiKey) {
      this.log('❌ No Gemini API key; using one-shot fallback');
      return buildFallback();
    }

    // Read up to maxImages images as inline base64 parts (videos → thumbnail frame).
    const imageParts = [];
    const maxB64Chars = 450000; // ~330KB — enough for vision, cheap to upload
    for (let i = 0; i < items.length && imageParts.length < maxImages; i += 1) {
      try {
        const imageUri = await this.getImageUriForMedia(items[i]);
        if (!imageUri) continue;
        const base64Data = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!base64Data) continue;
        if (base64Data.length > maxB64Chars) {
          this.log(`⚠️ Skipping oversized image ${i + 1} (${base64Data.length} b64 chars)`);
          continue;
        }
        imageParts.push({ inline_data: { mime_type: 'image/jpeg', data: base64Data } });
      } catch (e) {
        this.log(`⚠️ Could not read media ${i + 1} for one-shot generation:`, e?.message ?? e);
      }
    }

    const intentBlock = intent.length > 0
      ? `The user described the post like this (THIS is the main point — lead with it):\n"${intent}"`
      : `The user did not add their own description, so infer a natural post from the photos alone.`;

    const promptText = `You are helping someone post ONE social media update with ${imageParts.length || 0} photo(s).

${intentBlock}

Return JSON with "variants": ${count} DISTINCT caption options for this single post:
- Lead with the user's intent; photos are supporting detail only.
- Make options different in tone (punchy / warm / playful).
- Natural first-person. Light emoji OK.
- Each: description max ~220 chars, title max 50 chars, 4-6 hashtags (no #).
Return ONLY valid JSON.`;

    const payload = {
      contents: [{ parts: [{ text: promptText }, ...imageParts] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 900,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            variants: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  description: { type: 'STRING' },
                  hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
                },
                required: ['description'],
              },
            },
          },
          required: ['variants'],
        },
      },
    };

    try {
      this.log(`✨ One-shot post generation: ${imageParts.length} image(s), hasIntent=${intent.length > 0}`);
      const response = await this.postGeminiWithRetry(payload, {
        maxRetries: 1,
        baseDelayMs: 1000,
        timeoutMs: 18000,
      });
      if (!response || !response.ok) {
        const status = response?.status;
        let bodyText = '';
        try { bodyText = await response?.text?.(); } catch { /* ignore */ }
        this.log('❌ One-shot API error:', status, bodyText?.slice?.(0, 180));
        const depleted =
          status === 429 ||
          /prepayment credits are depleted|RESOURCE_EXHAUSTED|quota|rate.?limit|insufficient_quota/i.test(bodyText || '');
        const needsPlus =
          status === 402 ||
          /subscription_required/i.test(bodyText || '');
        const fallback = buildFallback();
        return {
          ...fallback,
          aiError: needsPlus
            ? 'AI captions need Blyp Plus (or an active trial) — you can still write and post'
            : depleted
            ? 'AI temporarily unavailable (quota) — you can still post with the draft caption'
            : `AI polish unavailable (HTTP ${status || 'error'}) — you can still post`,
        };
      }

      const data = await response.json();
      const candidate = this.extractCandidate(data);
      if (!candidate || !candidate.text) return buildFallback();

      let parsed;
      try {
        parsed = JSON.parse(candidate.text);
      } catch (e) {
        this.log('❌ Failed to parse one-shot JSON:', e?.message ?? e);
        return buildFallback();
      }

      const rawVariants = Array.isArray(parsed?.variants) ? parsed.variants : [];
      const variants = rawVariants
        .map((v) => ({
          title: typeof v?.title === 'string' ? v.title.trim().slice(0, 50) : '',
          description: typeof v?.description === 'string' ? v.description.trim() : '',
          hashtags: Array.isArray(v?.hashtags)
            ? v.hashtags.filter((h) => typeof h === 'string' && h.trim()).map((h) => h.replace(/^#/, '').trim())
            : [],
        }))
        .filter((v) => v.description.length > 0)
        .slice(0, count);

      if (variants.length === 0) return buildFallback();

      // Top up to `count` from the fallback so the selector is always full.
      if (variants.length < count) {
        const filler = this.getVariantFallback(fallbackDescriptions, intent, count).variants;
        for (const f of filler) {
          if (variants.length >= count) break;
          if (!variants.some((v) => v.description === f.description)) variants.push(f);
        }
      }

      const perPhotoDescriptions = Array.isArray(parsed?.perPhotoDescriptions)
        ? parsed.perPhotoDescriptions
            .filter((d) => typeof d === 'string' && d.trim().length > 0)
            .map((d) => d.trim())
        : [];

      const title = typeof parsed?.title === 'string' && parsed.title.trim()
        ? parsed.title.trim()
        : (variants[0].title || variants[0].description.slice(0, 50));

      this.log(`✅ One-shot generated ${variants.length} variants, ${perPhotoDescriptions.length} photo descriptions`);
      return {
        variants,
        title,
        perPhotoDescriptions: perPhotoDescriptions.length > 0 ? perPhotoDescriptions : fallbackDescriptions,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        this.log('⏰ One-shot generation timed out; using fallback');
      } else {
        this.log('❌ One-shot generation error:', error?.message ?? error);
      }
      return buildFallback();
    }
  }

  /**
   * Deterministic fallback that still returns multiple distinct variants,
   * so the selection UI is never empty even when AI is unavailable.
   * @returns {{ variants: Array<{description: string, hashtags: string[]}>, title: string }}
   */
  getVariantFallback(perPhotoDescriptions = [], userIntent = '', count = 3) {
    const n = Math.max(2, Math.min(3, count || 3));
    const intent = (userIntent || '').trim();
    const descs = (perPhotoDescriptions || []).filter(
      (d) => typeof d === 'string' && d.trim().length > 0
    );
    const baseHashtags = ['blyp', 'life', 'moment', 'memories', 'sharing'];

    const titlePool = intent.length > 0
      ? ['My Story', 'Sharing This', 'Real Talk']
      : descs.length > 0
        ? ['Captured Moment', 'Worth Sharing', 'Today']
        : ['New Post', 'A Moment', 'Just Sharing'];

    let cores;
    if (intent.length > 0) {
      cores = [
        `${intent} ✨`,
        `${intent}\n\nHad to share this one. 📸`,
        `${intent} — and honestly, the photos say the rest. 🙌`
      ];
    } else if (descs.length > 0) {
      const lead = descs[0];
      cores = [
        `${lead} ✨`,
        `${descs.length > 1 ? 'A few moments worth sharing' : 'A moment worth sharing'}. 📸`,
        `Captured this today.${descs.length > 1 ? ' Swipe through 👉' : ''}`.trim()
      ];
    } else {
      cores = [
        'Sharing a little moment ✨',
        'Something worth posting 📸',
        'New post 🙌'
      ];
    }

    const variants = cores.slice(0, n).map((description, i) => ({
      title: titlePool[i] || titlePool[0],
      description,
      hashtags: baseHashtags.slice(0, 5)
    }));

    return { variants, title: intent ? intent.slice(0, 50) : 'New Post' };
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
        headers: await geminiAuthHeaders(),
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

    // Skip testConnection — it doubles latency and fails closed on transient 429s.
    // Real generateMediaDescription calls already surface auth/quota errors.

    const rawResults = [];

    // Cap sequential vision calls — one-shot generatePostFromMedia is preferred.
    const limit = Math.min(mediaItems.length, 3);
    for (let i = 0; i < limit; i += 1) {
      rawResults[i] = await this.generateMediaDescription(mediaItems[i], i);
    }
    for (let i = limit; i < mediaItems.length; i += 1) {
      rawResults[i] = null;
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