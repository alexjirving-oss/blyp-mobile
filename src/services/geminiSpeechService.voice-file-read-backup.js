// Backup before file-read hotfix
import * as FileSystem from 'expo-file-system';
import { buildGeminiUrl, hasGeminiKey } from '../config/geminiConfig';
import { logStructured } from '../utils/logStructured';

function extractTextFromGeminiSpeechResponse(raw) {
  try {
    const cand = raw?.candidates?.[0];
    const parts = cand?.content?.parts;
    if (Array.isArray(parts)) {
      const textPart = parts.find(p => typeof p?.text === 'string' && p.text.trim().length > 0);
      if (textPart) return textPart.text.trim();
    }
    if (typeof raw?.text === 'string' && raw.text.trim()) return raw.text.trim();
    return null;
  } catch {
    return null;
  }
}

export async function transcribeWithGemini({ audioUri, mimeType = 'audio/mp4' }) {
  if (!audioUri) return { ok: false, transcript: '', error: 'NO_AUDIO_URI' };
  if (!hasGeminiKey()) return { ok: false, transcript: '', error: 'NO_KEY' };
  try {
    const base64 = await FileSystem.readAsStringAsync(audioUri, { encoding: FileSystem.EncodingType.Base64 });
    if (!base64) return { ok: false, transcript: '', error: 'FILE_READ_FAILED' };
    const url = buildGeminiUrl();
    const body = { contents: [{ parts: [{ text: 'Transcribe this audio to plain text. Output only what the speaker said, no extra commentary.' }, { inline_data: { mime_type: mimeType, data: base64 } }] }], generationConfig: { temperature: 0, maxOutputTokens: 256 } };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, transcript: '', error: 'HTTP_ERROR' };
    const json = await res.json();
    const transcript = extractTextFromGeminiSpeechResponse(json);
    if (!transcript) return { ok: false, transcript: '', error: 'EMPTY_TRANSCRIPT' };
    return { ok: true, transcript };
  } catch (e) {
    return { ok: false, transcript: '', error: 'FILE_READ_FAILED' };
  }
}

export default { transcribeWithGemini };