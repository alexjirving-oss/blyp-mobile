/**
 * Gemini drafting for "Blyp it". Turns a natural-language command (or structured
 * fields) into ready-to-send message options + an image prompt, and self-moderates
 * (refuses harassment / abuse / hate / threats rather than drafting them).
 *
 * Reuses the Functions-only Gemini key (BLYP_GEMINI_API_KEY) — never shipped to
 * the client.
 */

import fetch from 'node-fetch';
import { DraftResult } from './types';

const MODEL = process.env.BLYP_GEMINI_MODEL || 'gemini-1.5-flash';

export interface DraftInput {
  /** Raw spoken/typed command, e.g. "Blyp Ru tough luck about the football". */
  command?: string;
  /** Or structured fields if the app already parsed them. */
  recipient?: string;
  gist?: string;
  tone?: string;
}

const PROMPT = (input: DraftInput) => `You are Blyp's message-writing assistant. A user wants you to write a short, ready-to-send personal message to someone they know, and you will also suggest an image to attach.

User request:
${JSON.stringify({
  command: input.command || '',
  recipient: input.recipient || '',
  gist: input.gist || '',
  tone: input.tone || '',
})}

Respond ONLY with strict JSON of this exact shape:
{"recipientName": string, "messages": string[], "imagePrompt": string, "safe": boolean, "refusalReason": string}

Rules:
- "recipientName": the person the message is FOR, cleaned (e.g. "Ru"). Empty string if unclear.
- "messages": 3 distinct ready-to-send options. Each warm, natural, human, and SHORT (max ~240 chars). Match the requested tone (default: friendly mate-to-mate). They should sound like the user texting a friend, not like a robot. No salutations like "Dear". Emojis are fine if natural.
- "imagePrompt": a vivid, SPECIFIC, wholesome prompt for an image generator that fits the message mood (e.g. a consoling/funny football themed image). Empty string if no image suits.
- "safe": false if the request asks for anything harassing, bullying, threatening, hateful, sexual, or targeting/abusing the recipient. true otherwise. Light banter between friends is fine and safe.
- "refusalReason": if safe=false, one short sentence explaining the refusal; else empty string.
- Never include real personal data you weren't given. Never produce defamatory claims.`;

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

export async function draftMessage(input: DraftInput): Promise<DraftResult | null> {
  const key = process.env.BLYP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null; // caller degrades cleanly

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal as any,
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT(input) }] }],
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 768, temperature: 0.8 },
      }),
    }).finally(() => clearTimeout(timer));

    if (!res.ok) return null;
    const data: any = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = safeParse(text);
    if (!parsed) return null;

    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter((m: any) => typeof m === 'string' && m.trim()).map((m: string) => m.trim()).slice(0, 3)
      : [];

    return {
      recipientName: typeof parsed.recipientName === 'string' ? parsed.recipientName.trim() : '',
      messages,
      imagePrompt: typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim() : '',
      safe: parsed.safe !== false, // default safe unless explicitly false
      refusalReason: typeof parsed.refusalReason === 'string' ? parsed.refusalReason.trim() : '',
    };
  } catch {
    return null;
  }
}
