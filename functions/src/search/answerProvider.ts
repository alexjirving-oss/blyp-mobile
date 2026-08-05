/**
 * Answer + intent provider for Blyp search.
 *
 * Primary: OpenAI gpt-4o (OPENAI_API_KEY / BLYP_OPENAI_API_KEY)
 * Fallback: Gemini (BLYP_GEMINI_API_KEY / GEMINI_API_KEY)
 * Last resort: heuristic intent, empty answer
 */

import fetch from 'node-fetch';
import { SearchIntent } from '../platform/types';

export interface AnswerResult {
  answer: string;
  intent: SearchIntent;
  related: string[];
  placeName: string | null;
  costMicros: number;
}

const OPENAI_MODEL = process.env.BLYP_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o';
const GEMINI_MODEL = process.env.BLYP_GEMINI_MODEL || 'gemini-1.5-flash';

const SYSTEM = `You are Blyp's search assistant. Respond ONLY with strict JSON:
{"answer": string, "intent": "place"|"content"|"info", "related": string[], "placeName": string|null}
Rules:
- "answer": at most TWO short sentences. Plain, factual, no fluff. Secondary text under results.
- "intent": "place" for shops/venues; "content" for videos/posts/people; "info" for facts/topics.
- "related": 3-4 SHORT follow-up queries (max 4 words each).
- "placeName": clean business name if intent is place; else null.
Treat the provided local timestamp as "now" / "today". Never invent an outdated year.`;

function heuristicIntent(q: string): SearchIntent {
  const s = q.toLowerCase();
  if (/\b(video|videos|clip|funny|watch|tiktok|reel|recipe|tutorial|how to)\b/.test(s)) return 'content';
  if (/\b(shop|store|near me|open|opening|phone|address|directions|restaurant|cafe|b&q|tesco|nando)\b/.test(s)) {
    return 'place';
  }
  return 'info';
}

export function fallbackAnswer(q: string): AnswerResult {
  return { answer: '', intent: heuristicIntent(q), related: [], placeName: null, costMicros: 0 };
}

function openaiKey(): string {
  return String(process.env.OPENAI_API_KEY || process.env.BLYP_OPENAI_API_KEY || '').trim();
}

function geminiKey(): string {
  return String(process.env.BLYP_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '').trim();
}

function userPrompt(query: string): string {
  return `Current local date and time: ${new Date().toString()}.\nQuery: ${JSON.stringify(query)}`;
}

function normalizeResult(parsed: any, query: string): AnswerResult | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const intent: SearchIntent =
    parsed.intent === 'place' || parsed.intent === 'content' || parsed.intent === 'info'
      ? parsed.intent
      : heuristicIntent(query);
  const answer = String(parsed.answer || '').trim();
  return {
    answer,
    intent,
    related: Array.isArray(parsed.related)
      ? parsed.related.filter((x: any) => typeof x === 'string').slice(0, 4)
      : [],
    placeName: typeof parsed.placeName === 'string' ? parsed.placeName : null,
    costMicros: 250,
  };
}

function safeParse(text: string): any | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function answerViaOpenAi(query: string): Promise<AnswerResult | null> {
  const key = openaiKey();
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal as any,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt(query) },
        ],
      }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[answerProvider] OpenAI failed', res.status, body.slice(0, 160));
      return null;
    }
    const data: any = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    return normalizeResult(safeParse(text), query);
  } catch (e: any) {
    console.warn('[answerProvider] OpenAI error', e?.message || String(e));
    return null;
  }
}

async function answerViaGemini(query: string): Promise<AnswerResult | null> {
  const key = geminiKey();
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal as any,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM}\n\n${userPrompt(query)}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 400,
          temperature: 0.4,
        },
      }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return normalizeResult(safeParse(text), query);
  } catch {
    return null;
  }
}

export async function answerProvider(query: string): Promise<AnswerResult> {
  const primary = await answerViaOpenAi(query);
  if (primary) return primary;
  const backup = await answerViaGemini(query);
  if (backup) return backup;
  return fallbackAnswer(query);
}
