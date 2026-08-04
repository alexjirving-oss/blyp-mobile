"use strict";
/**
 * Answer + intent provider (Gemini). Produces the short, secondary "Blyp answer",
 * an intent classification (place/content/info) and a few refine queries.
 *
 * The API key lives ONLY in Functions env (BLYP_GEMINI_API_KEY / GEMINI_API_KEY) -
 * never shipped to the client. If absent, returns null and the orchestrator falls
 * back to a heuristic intent with no answer.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.answerProvider = exports.fallbackAnswer = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const MODEL = process.env.BLYP_GEMINI_MODEL || 'gemini-1.5-flash';
const PROMPT = (q) => `You are Blyp's search assistant. For the user query, respond ONLY with strict JSON:
{"answer": string, "intent": "place"|"content"|"info", "related": string[], "placeName": string|null}
Rules:
- "answer": at most TWO short sentences. Plain, factual, no fluff. It is SECONDARY text under the results.
- "intent": "place" if they likely want a specific shop/business/venue (address, phone, website). "content" if they want videos/posts/people (e.g. "funny videos", "cooking"). "info" for factual questions/topics.
- "related": 3-4 SHORT follow-up queries (max 4 words each) to refine the search.
- "placeName": if intent is "place", the clean business/place name to look up; else null.
Query: ${JSON.stringify(q)}`;
function heuristicIntent(q) {
    const s = q.toLowerCase();
    if (/\b(video|videos|clip|funny|watch|tiktok|reel|recipe|tutorial|how to)\b/.test(s))
        return 'content';
    if (/\b(shop|store|near me|open|opening|phone|address|directions|restaurant|cafe|b&q|tesco|nando)\b/.test(s))
        return 'place';
    return 'info';
}
function fallbackAnswer(q) {
    return { answer: '', intent: heuristicIntent(q), related: [], placeName: null, costMicros: 0 };
}
exports.fallbackAnswer = fallbackAnswer;
async function answerProvider(query) {
    var _a, _b, _c, _d, _e;
    const key = process.env.BLYP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!key)
        return fallbackAnswer(query);
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                contents: [{ parts: [{ text: PROMPT(query) }] }],
                generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 512, temperature: 0.4 },
            }),
        }).finally(() => clearTimeout(timer));
        if (!res.ok)
            return fallbackAnswer(query);
        const data = await res.json();
        const text = ((_e = (_d = (_c = (_b = (_a = data === null || data === void 0 ? void 0 : data.candidates) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.content) === null || _c === void 0 ? void 0 : _c.parts) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.text) || '';
        const parsed = safeParse(text);
        if (!parsed)
            return fallbackAnswer(query);
        const intent = parsed.intent === 'place' || parsed.intent === 'content' || parsed.intent === 'info' ? parsed.intent : heuristicIntent(query);
        return {
            answer: String(parsed.answer || '').trim(),
            intent,
            related: Array.isArray(parsed.related) ? parsed.related.filter((x) => typeof x === 'string').slice(0, 4) : [],
            placeName: typeof parsed.placeName === 'string' ? parsed.placeName : null,
            costMicros: 250,
        };
    }
    catch (_f) {
        return fallbackAnswer(query);
    }
}
exports.answerProvider = answerProvider;
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
//# sourceMappingURL=answerProvider.js.map