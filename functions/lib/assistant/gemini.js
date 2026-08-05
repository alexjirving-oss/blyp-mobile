"use strict";
/**
 * Gemini drafting for "Blyp it". Turns a natural-language command (or structured
 * fields) into ready-to-send message options + an image prompt, and self-moderates
 * (refuses harassment / abuse / hate / threats rather than drafting them).
 *
 * Reuses the Functions-only Gemini key (BLYP_GEMINI_API_KEY) — never shipped to
 * the client.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.draftMessage = draftMessage;
const node_fetch_1 = __importDefault(require("node-fetch"));
const MODEL = process.env.BLYP_GEMINI_MODEL || 'gemini-1.5-flash';
const PROMPT = (input) => `You are Blyp's message-writing assistant. A user wants you to write a short, ready-to-send personal message to someone they know, and you will also suggest an image to attach.

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
function safeParse(text) {
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch (_a) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
            try {
                return JSON.parse(m[0]);
            }
            catch (_b) {
                return null;
            }
        }
        return null;
    }
}
async function draftMessage(input) {
    var _a, _b, _c, _d, _e;
    const key = process.env.BLYP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!key)
        return null; // caller degrades cleanly
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        const res = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: PROMPT(input) }] }],
                generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 768, temperature: 0.8 },
            }),
        }).finally(() => clearTimeout(timer));
        if (!res.ok)
            return null;
        const data = await res.json();
        const text = ((_e = (_d = (_c = (_b = (_a = data === null || data === void 0 ? void 0 : data.candidates) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.text) || '';
        const parsed = safeParse(text);
        if (!parsed)
            return null;
        const messages = Array.isArray(parsed.messages)
            ? parsed.messages.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim()).slice(0, 3)
            : [];
        return {
            recipientName: typeof parsed.recipientName === 'string' ? parsed.recipientName.trim() : '',
            messages,
            imagePrompt: typeof parsed.imagePrompt === 'string' ? parsed.imagePrompt.trim() : '',
            safe: parsed.safe !== false, // default safe unless explicitly false
            refusalReason: typeof parsed.refusalReason === 'string' ? parsed.refusalReason.trim() : '',
        };
    }
    catch (_f) {
        return null;
    }
}
//# sourceMappingURL=gemini.js.map