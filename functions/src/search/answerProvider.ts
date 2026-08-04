/**
 * Answer + intent provider (Gemini). Produces the short, secondary "Blyp answer",
 * an intent classification (place/content/info) and a few refine queries.
 *
 * The API key lives ONLY in Functions env (BLYP_GEMINI_API_KEY / GEMINI_API_KEY) -
 * never shipped to the client. If absent, returns null and the orchestrator falls
 * back to a heuristic intent with no answer.
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

const MODEL = process.env.BLYP_GEMINI_MODEL || 'gemini-1.5-flash';

const PROMPT = (q: string, nowLocal: string) => `You are Blyp's search assistant. For the user query, respond ONLY with strict JSON:
{"answer": string, "intent": "place"|"content"|"info", "related": string[], "placeName": string|null}
Current local date and time: ${nowLocal}.
Treat that timestamp as "now" / "today" for any time-sensitive question. Never invent an outdated year from training data when answering about the present.
Rules:
- "answer": at most TWO short sentences. Plain, factual, no fluff. It is SECONDARY text under the results.
- "intent": "place" if they likely want a specific shop/business/venue (address, phone, website). "content" if they want videos/posts/people (e.g. "funny videos", "cooking"). "info" for factual questions/topics.
- "related": 3-4 SHORT follow-up queries (max 4 words each) to refine the search.
- "placeName": if intent is "place", the clean business/place name to look up; else null.
Query: ${JSON.stringify(q)}`;

function heuristicIntent(q: string): SearchIntent {
  const s = q.toLowerCase();
  if (/\b(video|videos|clip|funny|watch|tiktok|reel|recipe|tutorial|how to)\b/.test(s)) return 'content';
  if (/\b(shop|store|near me|open|opening|phone|address|directions|restaurant|cafe|b&q|tesco|nando)\b/.test(s)) return 'place';
  return 'info';
}

export function fallbackAnswer(q: string): AnswerResult {
  return { answer: '', intent: heuristicIntent(q), related: [], placeName: null, costMicros: 0 };
}

export async function answerProvider(query: string): Promise<AnswerResult> {
  const key = process.env.BLYP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return fallbackAnswer(query);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal as any,
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT(query, new Date().toString()) }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512, temperature: 0.4 },
      }),
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return fallbackAnswer(query);
    const data: any = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = safeParse(text);
    if (!parsed) return fallbackAnswer(query);
    const intent: SearchIntent =
      parsed.intent === 'place' || parsed.intent === 'content' || parsed.intent === 'info' ? parsed.intent : heuristicIntent(query);
    return {
      answer: String(parsed.answer || '').trim(),
      intent,
      related: Array.isArray(parsed.related) ? parsed.related.filter((x: any) => typeof x === 'string').slice(0, 4) : [],
      placeName: typeof parsed.placeName === 'string' ? parsed.placeName : null,
      costMicros: 250,
    };
  } catch {
    return fallbackAnswer(query);
  }
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
