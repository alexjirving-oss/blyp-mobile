/**
 * Convert a Gemini generateContent body → OpenAI chat.completions, then wrap
 * the OpenAI reply as a Gemini-shaped response so existing mobile parsers keep
 * working. Used as a backup when Gemini returns 429 / quota / upstream errors.
 */

import fetch from 'node-fetch';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
};

type GeminiContent = {
  role?: string;
  parts?: GeminiPart[];
};

type GeminiBody = {
  contents?: GeminiContent[];
  systemInstruction?: { parts?: GeminiPart[] } | GeminiContent;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    responseMimeType?: string;
    responseSchema?: unknown;
  };
};

function openaiKey(): string {
  return String(process.env.OPENAI_API_KEY || process.env.BLYP_OPENAI_API_KEY || '').trim();
}

function bodyHasAudio(body: GeminiBody | any): boolean {
  const contents = body?.contents;
  if (!Array.isArray(contents)) return false;
  for (const content of contents) {
    const parts = content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const inline: any = part?.inlineData || part?.inline_data;
      const mime = String(inline?.mimeType || inline?.mime_type || '').toLowerCase();
      if (mime.startsWith('audio/')) return true;
    }
  }
  return false;
}

export function hasOpenAiFallback(): boolean {
  return openaiKey().length > 0;
}

/** OpenAI chat.completions cannot consume Gemini audio inline parts — skip it. */
export function canUseOpenAiForBody(body: GeminiBody | any): boolean {
  return hasOpenAiFallback() && !bodyHasAudio(body);
}

export function bodyContainsAudio(body: GeminiBody | any): boolean {
  return bodyHasAudio(body);
}

type ExtractedAudio = { mime: string; data: string; filename: string };

function mimeToFilename(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('wav')) return 'audio.wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio.mp3';
  if (m.includes('webm')) return 'audio.webm';
  if (m.includes('ogg')) return 'audio.ogg';
  if (m.includes('aac')) return 'audio.aac';
  if (m.includes('caf')) return 'audio.caf';
  // Default: iOS/Android push-to-talk recordings are usually m4a/mp4.
  return 'audio.m4a';
}

/** Pull the first inline audio part from a Gemini-shaped body. */
export function extractAudioFromGeminiBody(body: GeminiBody | any): ExtractedAudio | null {
  const contents = body?.contents;
  if (!Array.isArray(contents)) return null;
  for (const content of contents) {
    const parts = content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const inline: any = part?.inlineData || part?.inline_data;
      const mime = String(inline?.mimeType || inline?.mime_type || '').toLowerCase();
      const data = String(inline?.data || '').trim();
      if (mime.startsWith('audio/') && data) {
        return { mime, data, filename: mimeToFilename(mime) };
      }
    }
  }
  return null;
}

/**
 * Whisper STT fallback for push-to-describe / voice captions.
 * Gemini free-tier audio often 429s; Whisper keeps describe working.
 * Returns a Gemini-shaped JSON body so mobile parsers are unchanged.
 */
export async function callOpenAiWhisperAsGemini(
  geminiBody: GeminiBody | any,
  { timeoutMs = 45000 }: { timeoutMs?: number } = {},
): Promise<{ status: number; body: string }> {
  const key = openaiKey();
  if (!key) {
    return {
      status: 503,
      body: JSON.stringify({ error: { message: 'openai_unavailable' } }),
    };
  }

  const audio = extractAudioFromGeminiBody(geminiBody);
  if (!audio) {
    return {
      status: 400,
      body: JSON.stringify({ error: { message: 'openai_whisper_no_audio' } }),
    };
  }

  let FormDataCtor: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    FormDataCtor = require('form-data');
  } catch {
    return {
      status: 503,
      body: JSON.stringify({ error: { message: 'openai_whisper_unavailable' } }),
    };
  }

  const form = new FormDataCtor();
  const buf = Buffer.from(audio.data, 'base64');
  if (!buf.length) {
    return {
      status: 400,
      body: JSON.stringify({ error: { message: 'openai_whisper_empty_audio' } }),
    };
  }
  form.append('file', buf, {
    filename: audio.filename,
    contentType: audio.mime || 'audio/mp4',
  });
  form.append('model', String(process.env.BLYP_OPENAI_STT_MODEL || 'whisper-1').trim() || 'whisper-1');
  form.append('response_format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        ...form.getHeaders(),
      },
      signal: controller.signal as any,
      body: form as any,
    }).finally(() => clearTimeout(timer));

    const raw = await upstream.text();
    if (!upstream.ok) {
      console.warn('[openaiWhisper] upstream failed', upstream.status, raw.slice(0, 200));
      return { status: upstream.status, body: raw };
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        status: 502,
        body: JSON.stringify({ error: { message: 'openai_whisper_bad_json' } }),
      };
    }

    const text = String(parsed?.text || '').trim();
    if (!text) {
      return {
        status: 502,
        body: JSON.stringify({ error: { message: 'openai_whisper_empty' } }),
      };
    }

    return {
      status: 200,
      body: JSON.stringify(openAiToGeminiResponse(text)),
    };
  } catch (e: any) {
    console.warn('[openaiWhisper] request error', e?.message || String(e));
    return {
      status: 502,
      body: JSON.stringify({ error: { message: 'openai_whisper_upstream_error' } }),
    };
  }
}

function partsToOpenAiContent(parts: GeminiPart[] | undefined): any {
  if (!Array.isArray(parts) || parts.length === 0) return '';
  const blocks: any[] = [];
  for (const part of parts) {
    if (typeof part?.text === 'string' && part.text.length > 0) {
      blocks.push({ type: 'text', text: part.text });
      continue;
    }
    const inline: any = part?.inlineData || part?.inline_data;
    const mime = String(inline?.mimeType || inline?.mime_type || 'image/jpeg');
    const data = String(inline?.data || '').trim();
    if (data) {
      blocks.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${data}` },
      });
    }
  }
  if (blocks.length === 0) return '';
  if (blocks.length === 1 && blocks[0].type === 'text') return blocks[0].text;
  return blocks;
}

function mapRole(role: string | undefined): 'system' | 'user' | 'assistant' {
  const r = String(role || 'user').toLowerCase();
  if (r === 'model' || r === 'assistant') return 'assistant';
  if (r === 'system') return 'system';
  return 'user';
}

export function geminiBodyToOpenAiMessages(body: GeminiBody): any[] {
  const messages: any[] = [];
  const sys = body.systemInstruction;
  const sysParts = Array.isArray((sys as any)?.parts) ? (sys as any).parts : [];
  const sysText = sysParts
    .map((p: GeminiPart) => (typeof p?.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();

  const wantsJson = String(body.generationConfig?.responseMimeType || '').includes('json');
  const schema = body.generationConfig?.responseSchema;
  let system = sysText;
  if (wantsJson) {
    const schemaHint = schema ? `\nRespond with JSON matching this schema:\n${JSON.stringify(schema)}` : '';
    system = [system, 'Return valid JSON only (no markdown fences).', schemaHint]
      .filter(Boolean)
      .join('\n');
  }
  if (system) messages.push({ role: 'system', content: system });

  for (const content of body.contents || []) {
    const role = mapRole(content.role);
    const mapped = partsToOpenAiContent(content.parts);
    if (mapped === '' || (Array.isArray(mapped) && mapped.length === 0)) continue;
    // OpenAI system messages should be text-only; fold into user if needed.
    if (role === 'system' && typeof mapped !== 'string') {
      messages.push({ role: 'user', content: mapped });
    } else {
      messages.push({ role, content: mapped });
    }
  }

  if (messages.length === 0) {
    messages.push({ role: 'user', content: 'Hello' });
  }
  return messages;
}

export function openAiToGeminiResponse(text: string): object {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: text || '' }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: {},
    // Marker for logs / debugging (clients ignore unknown fields).
    blypProvider: 'openai',
  };
}

function shouldFallbackStatus(status: number, bodyText: string): boolean {
  if (status === 429 || status === 503 || status === 502 || status === 500) return true;
  if (status === 404 || status === 400) {
    // Model not found / bad request on Gemini side — still try OpenAI.
    return /not found|unsupported|invalid|quota|resource_exhausted/i.test(bodyText || '');
  }
  return /prepayment credits are depleted|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(bodyText || '');
}

export function shouldUseOpenAiFallback(status: number, bodyText: string): boolean {
  if (!hasOpenAiFallback()) return false;
  return shouldFallbackStatus(status, bodyText);
}

export async function callOpenAiAsGemini(
  geminiBody: GeminiBody,
  { timeoutMs = 28000 }: { timeoutMs?: number } = {},
): Promise<{ status: number; body: string }> {
  const key = openaiKey();
  if (!key) {
    return {
      status: 503,
      body: JSON.stringify({ error: { message: 'openai_unavailable' } }),
    };
  }

  const model = String(process.env.BLYP_OPENAI_MODEL || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL).trim()
    || DEFAULT_OPENAI_MODEL;
  const messages = geminiBodyToOpenAiMessages(geminiBody);
  const gen = geminiBody.generationConfig || {};
  const wantsJson = String(gen.responseMimeType || '').includes('json');

  const payload: any = {
    model,
    messages,
    temperature: typeof gen.temperature === 'number' ? gen.temperature : 0.7,
    max_tokens: typeof gen.maxOutputTokens === 'number' ? Math.min(gen.maxOutputTokens, 4096) : 1024,
  };
  if (typeof gen.topP === 'number') payload.top_p = gen.topP;
  if (wantsJson) payload.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal as any,
      body: JSON.stringify(payload),
    }).finally(() => clearTimeout(timer));

    const raw = await upstream.text();
    if (!upstream.ok) {
      console.warn('[openaiFallback] upstream failed', upstream.status, raw.slice(0, 200));
      return { status: upstream.status, body: raw };
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        status: 502,
        body: JSON.stringify({ error: { message: 'openai_bad_json' } }),
      };
    }

    const text = String(parsed?.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      return {
        status: 502,
        body: JSON.stringify({ error: { message: 'openai_empty' } }),
      };
    }

    return {
      status: 200,
      body: JSON.stringify(openAiToGeminiResponse(text)),
    };
  } catch (e: any) {
    console.warn('[openaiFallback] request error', e?.message || String(e));
    return {
      status: 502,
      body: JSON.stringify({ error: { message: 'openai_upstream_error' } }),
    };
  }
}
