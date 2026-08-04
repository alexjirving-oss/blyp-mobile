/**
 * Gemini-Powered Speech Service for Blyp Mobile
 * 
 * Uses Gemini AI's multi-modal capabilities to transcribe audio
 * More reliable than separate Speech APIs
 */

// Prefer legacy API for broader device compatibility; fallback to standard if needed
import * as FileSystem from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { geminiApiUrl, geminiApiKey, geminiAuthHeaders, geminiProxyUrlForModel } from '../config/firebase';

class GeminiSpeechService {
  constructor() {
    this.apiUrl = geminiApiUrl || "";
  }

  /**
   * Fetch a Gemini model with exponential backoff on rate-limit (429) and
   * transient (503) responses, plus a per-attempt timeout. This is what makes
   * bursty voice + description + generation flows survive the free-tier
   * per-minute rate limit instead of failing on the first 429.
   */
  async fetchModelWithRetry(model, payload, { maxRetries = 2, baseDelayMs = 2500, timeoutMs = 30000 } = {}) {
    const url = geminiProxyUrlForModel(model);
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

        // Retry only on rate-limit / transient server errors.
        if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
          const retryAfter = parseInt(response.headers?.get?.('retry-after') || '', 10);
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 15000)
            : baseDelayMs * Math.pow(2, attempt);
          console.warn(`⏳ Gemini ${response.status} on ${model}; retrying in ${waitMs}ms (${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, waitMs));
          attempt += 1;
          continue;
        }

        return response; // non-retryable status, or retries exhausted
      } catch (error) {
        clearTimeout(timer);
        if (attempt < maxRetries) {
          const waitMs = baseDelayMs * Math.pow(2, attempt);
          console.warn(`⏳ Gemini request error on ${model} (${error?.message}); retrying in ${waitMs}ms`);
          await new Promise((r) => setTimeout(r, waitMs));
          attempt += 1;
          continue;
        }
        throw error;
      }
    }

    return lastResponse;
  }

  extractTranscript(result) {
    try {
      if (!result || !Array.isArray(result.candidates)) return null;
      for (const c of result.candidates) {
        const parts = c?.content?.parts || [];
        for (const p of parts) {
          if (typeof p.text === 'string') {
            const txt = p.text.trim();
            if (txt) return txt;
          }
        }
      }
      return null;
    } catch (e) {
      console.warn('extractTranscript error', e.message);
      return null;
    }
  }

  /**
   * Transcribe audio using Gemini AI's multimodal capabilities
   */
  async transcribeAudio(audioUri) {
    if (!audioUri) {
      throw new Error('No audio URI provided');
    }

    if (!geminiApiKey) {
      console.warn('⚠️ Missing Gemini API key; cannot transcribe.');
      return '[NO_KEY]';
    }

    console.log('🤖 Transcribing with Gemini AI... uri=', audioUri);

    try {
      // Read audio and derive approximate raw size from base64 length (avoids deprecated getInfoAsync size param)
      const audioBase64 = await this.convertAudioToBase64(audioUri);
      const approxSizeBytes = Math.floor(audioBase64.length * 0.75); // base64 size heuristic
      console.log(`📁 Audio read: approxSize=${approxSizeBytes}B uri=${audioUri}`);
      let mimeType = 'audio/mp4';
      if (audioUri.endsWith('.m4a')) mimeType = 'audio/m4a';
      else if (audioUri.endsWith('.aac')) mimeType = 'audio/aac';
      else if (audioUri.endsWith('.caf')) mimeType = 'audio/x-caf';
      else if (audioUri.endsWith('.wav')) mimeType = 'audio/wav';
      console.log(`🎧 Using mimeType=${mimeType} size(base64)=${audioBase64.length}`);
      if (approxSizeBytes < 2000) {
        console.warn('⚠️ Audio appears very short (<2KB). Ask user to re-record longer for better transcription.');
      }
      
      const buildPayload = (model) => ({
        contents: [{
          parts: [
            { text: 'Transcribe ONLY the spoken words from this audio. Return plain text, no commentary.' },
            {
              inline_data: {
                mime_type: mimeType,
                data: audioBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200
        },
        model
      });

      const primaryModel = (this.apiUrl.includes(':generateContent') && this.apiUrl.split('/models/')[1]?.split(':')[0])
        || (this.apiUrl.includes('model=') && this.apiUrl.split('model=')[1]?.split('&')[0])
        || 'gemini-flash-latest';
      // Prefer flash-latest → 1.5-flash; 2.5-flash is often the first to 429 on free tier.
      const secondaryModel = primaryModel === 'gemini-1.5-flash' ? 'gemini-flash-latest' : 'gemini-1.5-flash';
      console.log(`🧪 Primary model: ${primaryModel} Secondary model: ${secondaryModel}`);

      console.log('🌐 Sending audio to Gemini for transcription...');

      // One retry is enough — proxy already falls back to Whisper on Gemini 429.
      let response = await this.fetchModelWithRetry(primaryModel, buildPayload(primaryModel), {
        maxRetries: 1,
        baseDelayMs: 1500,
      });
      let result = null;
      let transcriptCandidate = null;

      if (response && response.ok) {
        result = await response.json();
        console.log('📨 Raw Gemini response (primary):', JSON.stringify(result).slice(0, 500));
        transcriptCandidate = this.extractTranscript(result);
      }

      // If the primary model produced nothing usable OR was rate-limited/failed,
      // fall back to the secondary model (separate quota, often clears a 429).
      if (!transcriptCandidate) {
        const primaryStatus = response && response.ok ? 'no-transcript' : (response?.status ?? 'error');
        console.warn(`⚠️ Primary model unusable (${primaryStatus}); trying secondary model`);
        try {
          const response2 = await this.fetchModelWithRetry(secondaryModel, buildPayload(secondaryModel), {
            maxRetries: 1,
            baseDelayMs: 1500,
          });
          if (response2 && response2.ok) {
            result = await response2.json();
            console.log('📨 Raw Gemini response (secondary):', JSON.stringify(result).slice(0, 500));
            transcriptCandidate = this.extractTranscript(result);
          } else {
            console.warn('⚠️ Secondary model request failed status=', response2?.status);
            // Prefer surfacing the secondary status if the primary was OK-but-empty.
            if (response && response.ok && response2) response = response2;
          }
        } catch (secondaryError) {
          console.warn('⚠️ Secondary model failed:', secondaryError.message);
        }
      }

      if (transcriptCandidate) {
        console.log('✅ Final transcript:', transcriptCandidate);
        return transcriptCandidate;
      }

      // No transcript from either model. Surface a meaningful HTTP error
      // (e.g. 429) so the UI can show the right message; otherwise no-candidate.
      if (response && !response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }
      console.warn('⚠️ No usable transcription from either model');
      throw new Error('[NO_CANDIDATE]');

    } catch (error) {
      const reason = error?.message || 'Unknown';
      console.warn('⚠️ Gemini speech transcription failed reason=', reason);
      if (reason.includes('[NO_KEY]')) return '[NO_KEY]';
      if (reason.includes('[NO_CANDIDATE]')) return '[NO_CANDIDATE]';
      if (reason.includes('Failed to process audio file')) return '[READ_FAIL]';
      return `[ERROR:${reason}]`;
    }
  }

  /**
   * Convert audio file to base64
   */
  async convertAudioToBase64(audioUri) {
    let workingUri = audioUri;
    try {
      console.log('🔍 Base64 read attempt 1 uri=', workingUri);
      if (!workingUri.startsWith('file://')) {
        workingUri = 'file://' + workingUri;
        console.log('🔧 Normalized uri to', workingUri);
      }
      // Try new simple encoding string first (SDK 54+)
      const audioBase64 = await FileSystem.readAsStringAsync(workingUri, {
        encoding: 'base64'
      });
      if (audioBase64 && audioBase64.length > 0) {
        return audioBase64;
      }
      throw new Error('Empty base64 result');
    } catch (error1) {
      console.warn('⚠️ Base64 read attempt 1 failed reason=', error1.message);
      // Attempt legacy API if available
      try {
        console.log('🔁 Legacy read attempt uri=', workingUri);
        const legacyBase64 = await LegacyFileSystem.readAsStringAsync(workingUri, {
          encoding: LegacyFileSystem.EncodingType?.Base64 || 'base64'
        });
        if (legacyBase64 && legacyBase64.length > 0) {
          console.log('✅ Legacy read succeeded');
          return legacyBase64;
        }
        throw new Error('Empty legacy base64');
      } catch (errorLegacy) {
        console.warn('⚠️ Legacy read failed reason=', errorLegacy.message);
        // Final fetch-based fallback
        try {
          console.log('🌐 Fetch fallback attempt');
          const res = await fetch(workingUri);
          const blob = await res.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const b64 = this.arrayBufferToBase64(arrayBuffer);
          if (!b64 || b64.length === 0) throw new Error('Empty fetch base64');
          console.log('✅ Fetch fallback succeeded');
          return b64;
        } catch (errorFetch) {
          console.warn('❌ Fetch fallback failed reason=', errorFetch.message);
          throw new Error('Failed to process audio file');
        }
      }
    }
  }

  arrayBufferToBase64(buffer) {
    try {
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      if (typeof btoa === 'function') return btoa(binary);
      // Buffer may exist via polyfill
      // eslint-disable-next-line no-undef
      if (typeof Buffer !== 'undefined') return Buffer.from(binary, 'binary').toString('base64');
      return '';
    } catch (e) {
      console.warn('arrayBufferToBase64 error', e.message);
      return '';
    }
  }
}

export default new GeminiSpeechService();