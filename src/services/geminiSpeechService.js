/**
 * Gemini-Powered Speech Service for Blyp Mobile
 * 
 * Uses Gemini AI's multi-modal capabilities to transcribe audio
 * More reliable than separate Speech APIs
 */

// Prefer legacy API for broader device compatibility; fallback to standard if needed
import * as FileSystem from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { geminiApiUrl, geminiApiKey } from '../config/firebase';

class GeminiSpeechService {
  constructor() {
    this.apiUrl = geminiApiUrl || "";
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

      const primaryModel = (this.apiUrl.includes(':generateContent') && this.apiUrl.split('/models/')[1]?.split(':')[0]) || 'gemini-2.5-flash-preview-05-20';
      const secondaryModel = 'gemini-1.5-flash';
      console.log(`🧪 Primary model: ${primaryModel} Secondary model: ${secondaryModel}`);

      console.log('🌐 Sending audio to Gemini for transcription...');

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout after 15 seconds')), 15000)
      );

      // Create fetch promise  
      const fetchWithModel = async (model) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
        return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
          body: JSON.stringify(buildPayload(model))
        });
      };
      const fetchPromise = fetchWithModel(primaryModel);

      // Race between fetch and timeout
      let response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      let result = await response.json();
      console.log('📨 Raw Gemini response (primary):', JSON.stringify(result).slice(0, 500));
      let transcriptCandidate = this.extractTranscript(result);
      if (!transcriptCandidate) {
        console.warn('⚠️ Primary model produced no transcript; trying secondary model');
        const response2 = await fetchWithModel(secondaryModel);
        if (response2.ok) {
          result = await response2.json();
          console.log('📨 Raw Gemini response (secondary):', JSON.stringify(result).slice(0, 500));
          transcriptCandidate = this.extractTranscript(result);
        } else {
          console.warn('⚠️ Secondary model request failed status=', response2.status);
        }
      }
      
      if (transcriptCandidate) {
        console.log('✅ Final transcript:', transcriptCandidate);
        return transcriptCandidate;
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