/** Backup of geminiSpeechService.js before voice flow restoration */
/**
 * Gemini-Powered Speech Service for Blyp Mobile
 * 
 * Uses Gemini AI's multi-modal capabilities to transcribe audio
 * More reliable than separate Speech APIs
 */

// Prefer legacy API for broader device compatibility; fallback to standard if needed
import * as FileSystem from 'expo-file-system';
import { getGeminiApiKey, buildGeminiUrl, hasGeminiKey } from '../config/geminiConfig';
import { logStructured } from '../utils/logStructured';

// Read audio file as base64 and build Gemini inlineData part
async function loadAudioAsInlineData(uri, mimeType = 'audio/mp4') {
  if (!uri) {
    throw new Error('NO_AUDIO_URI');
  }
  try {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    if (!base64 || base64.length === 0) throw new Error('EMPTY_AUDIO');
    return {
      inlineData: {
        data: base64,
        mimeType,
      },
    };
  } catch (err) {
    console.warn('[SPEECH] Failed to read audio file', { uri, err: err?.message });
    throw new Error('AUDIO_READ_FAILED');
  }
}

function extractTextFromGeminiSpeechResponse(data) {
  const cand = data?.candidates?.[0];
  const parts = cand?.content?.parts;
  if (Array.isArray(parts)) {
    const textPart = parts.find(p => typeof p.text === 'string');
    if (textPart?.text) return textPart.text.trim();
  }
  if (typeof data?.text === 'string') return data.text.trim();
  return null;
}

export async function transcribeWithGemini({ uri, mimeType = 'audio/mp4' }) {
  if (!hasGeminiKey()) {
    console.warn('[AI][GeminiSpeech] No API key; skipping transcription.');
    return { ok: false, transcript: '', error: 'NO_KEY' };
  }
  let audioPart;
  try {
    audioPart = await loadAudioAsInlineData(uri, mimeType);
  } catch (e) {
    logStructured('ai.speech.error', { message: e.message, audioPresent: false });
    return { ok: false, transcript: '', error: e.message };
  }
  try {
    const url = buildGeminiUrl();
    logStructured('ai.speech.start', { mimeType, audioPresent: true });
    const body = {
      contents: [
        {
          role: 'user',
          parts: [audioPart],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 256,
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      console.warn('[AI][GeminiSpeech] Non-200 response', { status: res.status });
      logStructured('ai.speech.error', { status: res.status, hasBody: !!errJson });
      return { ok: false, transcript: '', error: 'HTTP_' + res.status, details: errJson };
    }
    const json = await res.json();
    const transcript = extractTextFromGeminiSpeechResponse(json);
    if (!transcript) {
      console.warn('[AI][GeminiSpeech] No transcript text in response');
      logStructured('ai.speech.error', { message: 'NO_TRANSCRIPT' });
      return { ok: false, transcript: '', error: 'NO_TRANSCRIPT' };
    }
    logStructured('ai.speech.success', { chars: transcript.length });
    return { ok: true, transcript, raw: json };
  } catch (err) {
    console.warn('[AI][GeminiSpeech] Exception during transcription', { message: err?.message });
    logStructured('ai.speech.error', { message: err?.message });
    return { ok: false, transcript: '', error: 'EXCEPTION' };
  }
}

export default { transcribeWithGemini };