"use strict";
/**
 * Convert a Gemini generateContent body → OpenAI chat.completions, then wrap
 * the OpenAI reply as a Gemini-shaped response so existing mobile parsers keep
 * working. Used as a backup when Gemini returns 429 / quota / upstream errors.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasOpenAiFallback = hasOpenAiFallback;
exports.canUseOpenAiForBody = canUseOpenAiForBody;
exports.bodyContainsAudio = bodyContainsAudio;
exports.extractAudioFromGeminiBody = extractAudioFromGeminiBody;
exports.callOpenAiWhisperAsGemini = callOpenAiWhisperAsGemini;
exports.geminiBodyToOpenAiMessages = geminiBodyToOpenAiMessages;
exports.openAiToGeminiResponse = openAiToGeminiResponse;
exports.shouldUseOpenAiFallback = shouldUseOpenAiFallback;
exports.stripInlineMediaFromGeminiBody = stripInlineMediaFromGeminiBody;
exports.callOpenAiAsGemini = callOpenAiAsGemini;
const node_fetch_1 = __importDefault(require("node-fetch"));
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
function openaiKey() {
    return String(process.env.OPENAI_API_KEY || process.env.BLYP_OPENAI_API_KEY || '').trim();
}
function bodyHasAudio(body) {
    const contents = body === null || body === void 0 ? void 0 : body.contents;
    if (!Array.isArray(contents))
        return false;
    for (const content of contents) {
        const parts = content === null || content === void 0 ? void 0 : content.parts;
        if (!Array.isArray(parts))
            continue;
        for (const part of parts) {
            const inline = (part === null || part === void 0 ? void 0 : part.inlineData) || (part === null || part === void 0 ? void 0 : part.inline_data);
            const mime = String((inline === null || inline === void 0 ? void 0 : inline.mimeType) || (inline === null || inline === void 0 ? void 0 : inline.mime_type) || '').toLowerCase();
            if (mime.startsWith('audio/'))
                return true;
        }
    }
    return false;
}
function hasOpenAiFallback() {
    return openaiKey().length > 0;
}
/** OpenAI chat.completions cannot consume Gemini audio inline parts — skip it. */
function canUseOpenAiForBody(body) {
    return hasOpenAiFallback() && !bodyHasAudio(body);
}
function bodyContainsAudio(body) {
    return bodyHasAudio(body);
}
function mimeToFilename(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('wav'))
        return 'audio.wav';
    if (m.includes('mpeg') || m.includes('mp3'))
        return 'audio.mp3';
    if (m.includes('webm'))
        return 'audio.webm';
    if (m.includes('ogg'))
        return 'audio.ogg';
    if (m.includes('3gpp') || m.includes('3gp'))
        return 'audio.3gp';
    if (m.includes('aac'))
        return 'audio.aac';
    if (m.includes('caf'))
        return 'audio.wav'; // Whisper rejects caf — remux name; bytes still fail often
    // Default: iOS/Android push-to-talk recordings are usually m4a/mp4.
    return 'audio.m4a';
}
/** Pull the first inline audio part from a Gemini-shaped body. */
function extractAudioFromGeminiBody(body) {
    const contents = body === null || body === void 0 ? void 0 : body.contents;
    if (!Array.isArray(contents))
        return null;
    for (const content of contents) {
        const parts = content === null || content === void 0 ? void 0 : content.parts;
        if (!Array.isArray(parts))
            continue;
        for (const part of parts) {
            const inline = (part === null || part === void 0 ? void 0 : part.inlineData) || (part === null || part === void 0 ? void 0 : part.inline_data);
            const mime = String((inline === null || inline === void 0 ? void 0 : inline.mimeType) || (inline === null || inline === void 0 ? void 0 : inline.mime_type) || '').toLowerCase();
            const data = String((inline === null || inline === void 0 ? void 0 : inline.data) || '').trim();
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
async function callOpenAiWhisperAsGemini(geminiBody, { timeoutMs = 45000 } = {}) {
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
    let FormDataCtor = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        FormDataCtor = require('form-data');
    }
    catch (_a) {
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
        const upstream = await (0, node_fetch_1.default)('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: Object.assign({ Authorization: `Bearer ${key}` }, form.getHeaders()),
            signal: controller.signal,
            body: form,
        }).finally(() => clearTimeout(timer));
        const raw = await upstream.text();
        if (!upstream.ok) {
            console.warn('[openaiWhisper] upstream failed', upstream.status, raw.slice(0, 200));
            return { status: upstream.status, body: raw };
        }
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        }
        catch (_b) {
            return {
                status: 502,
                body: JSON.stringify({ error: { message: 'openai_whisper_bad_json' } }),
            };
        }
        const text = String((parsed === null || parsed === void 0 ? void 0 : parsed.text) || '').trim();
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
    }
    catch (e) {
        console.warn('[openaiWhisper] request error', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return {
            status: 502,
            body: JSON.stringify({ error: { message: 'openai_whisper_upstream_error' } }),
        };
    }
}
function partsToOpenAiContent(parts) {
    if (!Array.isArray(parts) || parts.length === 0)
        return '';
    const blocks = [];
    for (const part of parts) {
        if (typeof (part === null || part === void 0 ? void 0 : part.text) === 'string' && part.text.length > 0) {
            blocks.push({ type: 'text', text: part.text });
            continue;
        }
        const inline = (part === null || part === void 0 ? void 0 : part.inlineData) || (part === null || part === void 0 ? void 0 : part.inline_data);
        const mime = String((inline === null || inline === void 0 ? void 0 : inline.mimeType) || (inline === null || inline === void 0 ? void 0 : inline.mime_type) || 'image/jpeg');
        const data = String((inline === null || inline === void 0 ? void 0 : inline.data) || '').trim();
        if (data) {
            blocks.push({
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${data}` },
            });
        }
    }
    if (blocks.length === 0)
        return '';
    if (blocks.length === 1 && blocks[0].type === 'text')
        return blocks[0].text;
    return blocks;
}
function mapRole(role) {
    const r = String(role || 'user').toLowerCase();
    if (r === 'model' || r === 'assistant')
        return 'assistant';
    if (r === 'system')
        return 'system';
    return 'user';
}
function geminiBodyToOpenAiMessages(body) {
    var _a, _b;
    const messages = [];
    const sys = body.systemInstruction;
    const sysParts = Array.isArray(sys === null || sys === void 0 ? void 0 : sys.parts) ? sys.parts : [];
    const sysText = sysParts
        .map((p) => (typeof (p === null || p === void 0 ? void 0 : p.text) === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();
    const wantsJson = String(((_a = body.generationConfig) === null || _a === void 0 ? void 0 : _a.responseMimeType) || '').includes('json');
    const schema = (_b = body.generationConfig) === null || _b === void 0 ? void 0 : _b.responseSchema;
    let system = sysText;
    if (wantsJson) {
        const schemaHint = schema ? `\nRespond with JSON matching this schema:\n${JSON.stringify(schema)}` : '';
        system = [system, 'Return valid JSON only (no markdown fences).', schemaHint]
            .filter(Boolean)
            .join('\n');
    }
    if (system)
        messages.push({ role: 'system', content: system });
    for (const content of body.contents || []) {
        const role = mapRole(content.role);
        const mapped = partsToOpenAiContent(content.parts);
        if (mapped === '' || (Array.isArray(mapped) && mapped.length === 0))
            continue;
        // OpenAI system messages should be text-only; fold into user if needed.
        if (role === 'system' && typeof mapped !== 'string') {
            messages.push({ role: 'user', content: mapped });
        }
        else {
            messages.push({ role, content: mapped });
        }
    }
    if (messages.length === 0) {
        messages.push({ role: 'user', content: 'Hello' });
    }
    return messages;
}
function openAiToGeminiResponse(text) {
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
function shouldFallbackStatus(status, bodyText) {
    if (status === 429 || status === 503 || status === 502 || status === 500)
        return true;
    if (status === 404 || status === 400) {
        // Model not found / bad request on Gemini side — still try OpenAI.
        return /not found|unsupported|invalid|quota|resource_exhausted/i.test(bodyText || '');
    }
    return /prepayment credits are depleted|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(bodyText || '');
}
function shouldUseOpenAiFallback(status, bodyText) {
    if (!hasOpenAiFallback())
        return false;
    return shouldFallbackStatus(status, bodyText);
}
function messageHasImages(messages) {
    for (const m of messages || []) {
        if (!Array.isArray(m === null || m === void 0 ? void 0 : m.content))
            continue;
        if (m.content.some((b) => (b === null || b === void 0 ? void 0 : b.type) === 'image_url'))
            return true;
    }
    return false;
}
function stripImagesFromMessages(messages) {
    return (messages || []).map((m) => {
        if (!Array.isArray(m === null || m === void 0 ? void 0 : m.content))
            return m;
        const next = m.content.filter((b) => (b === null || b === void 0 ? void 0 : b.type) !== 'image_url');
        if (next.length === 0) {
            return Object.assign(Object.assign({}, m), { content: 'Describe a social post from the text instructions only.' });
        }
        if (next.length === 1 && next[0].type === 'text') {
            return Object.assign(Object.assign({}, m), { content: next[0].text });
        }
        return Object.assign(Object.assign({}, m), { content: next });
    });
}
/** Drop inline images from a Gemini-shaped body (backup / text-only retry). */
function stripInlineMediaFromGeminiBody(body) {
    const cloned = Object.assign({}, (body || {}));
    cloned.contents = Array.isArray(body === null || body === void 0 ? void 0 : body.contents)
        ? body.contents.map((c) => (Object.assign(Object.assign({}, c), { parts: Array.isArray(c === null || c === void 0 ? void 0 : c.parts)
                ? c.parts.filter((p) => !((p === null || p === void 0 ? void 0 : p.inlineData) || (p === null || p === void 0 ? void 0 : p.inline_data)))
                : [] })))
        : [];
    return cloned;
}
async function openAiChatOnce(key, payload, timeoutMs) {
    var _a, _b, _c, _d;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const upstream = await (0, node_fetch_1.default)(OPENAI_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${key}`,
            },
            signal: controller.signal,
            body: JSON.stringify(payload),
        }).finally(() => clearTimeout(timer));
        const raw = await upstream.text();
        if (!upstream.ok) {
            console.warn('[openaiFallback] upstream failed', upstream.status, raw.slice(0, 200));
            return { status: upstream.status, body: raw };
        }
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        }
        catch (_e) {
            return {
                status: 502,
                body: JSON.stringify({ error: { message: 'openai_bad_json' } }),
            };
        }
        const choice = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.choices) === null || _a === void 0 ? void 0 : _a[0];
        const text = String(((_b = choice === null || choice === void 0 ? void 0 : choice.message) === null || _b === void 0 ? void 0 : _b.content) || ((_c = choice === null || choice === void 0 ? void 0 : choice.message) === null || _c === void 0 ? void 0 : _c.refusal) || '').trim();
        if (!text) {
            console.warn('[openaiFallback] empty content', {
                finish_reason: choice === null || choice === void 0 ? void 0 : choice.finish_reason,
                hasRefusal: !!((_d = choice === null || choice === void 0 ? void 0 : choice.message) === null || _d === void 0 ? void 0 : _d.refusal),
            });
            return {
                status: 502,
                body: JSON.stringify({ error: { message: 'openai_empty' } }),
                meta: { finish_reason: choice === null || choice === void 0 ? void 0 : choice.finish_reason },
            };
        }
        return {
            status: 200,
            body: JSON.stringify(openAiToGeminiResponse(text)),
            text,
        };
    }
    catch (e) {
        console.warn('[openaiFallback] request error', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return {
            status: 502,
            body: JSON.stringify({ error: { message: 'openai_upstream_error' } }),
        };
    }
}
async function callOpenAiAsGemini(geminiBody, { timeoutMs = 28000 } = {}) {
    var _a, _b;
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
    const maxTokens = typeof gen.maxOutputTokens === 'number' ? Math.min(Math.max(gen.maxOutputTokens, 600), 4096) : 1024;
    const buildPayload = (msgs, jsonMode) => {
        const payload = {
            model,
            messages: msgs,
            temperature: typeof gen.temperature === 'number' ? gen.temperature : 0.7,
            max_tokens: maxTokens,
        };
        if (typeof gen.topP === 'number')
            payload.top_p = gen.topP;
        if (jsonMode)
            payload.response_format = { type: 'json_object' };
        return payload;
    };
    // 1) Full multimodal attempt
    let result = await openAiChatOnce(key, buildPayload(messages, wantsJson), timeoutMs);
    if (result.status >= 200 && result.status < 300)
        return result;
    // 2) Vision often returns empty / filtered — retry text-only (caption from intent still works)
    if (((_a = result.body) === null || _a === void 0 ? void 0 : _a.includes('openai_empty')) &&
        messageHasImages(messages)) {
        console.warn('[openaiFallback] retrying text-only after openai_empty');
        result = await openAiChatOnce(key, buildPayload(stripImagesFromMessages(messages), wantsJson), Math.min(timeoutMs, 20000));
        if (result.status >= 200 && result.status < 300)
            return result;
    }
    // 3) Last try: drop strict json_object (some empty replies recover as plain text)
    if (wantsJson && ((_b = result.body) === null || _b === void 0 ? void 0 : _b.includes('openai_empty'))) {
        console.warn('[openaiFallback] retrying without response_format after openai_empty');
        result = await openAiChatOnce(key, buildPayload(stripImagesFromMessages(messages), false), Math.min(timeoutMs, 15000));
    }
    return result;
}
//# sourceMappingURL=openaiFallback.js.map