"use strict";
/**
 * Tiny fetch helpers for search providers: timeouts + safe JSON/text, so a slow
 * or broken supplier can never hang or crash a search request.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchJson = fetchJson;
exports.fetchText = fetchText;
const node_fetch_1 = __importDefault(require("node-fetch"));
const DEFAULT_TIMEOUT_MS = 6000;
const UA = 'BlypSearch/1.0 (+https://blyp.app)';
async function fetchJson(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
        const res = await (0, node_fetch_1.default)(url, {
            headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, (opts.headers || {})),
            signal: controller.signal,
        });
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch (_a) {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
async function fetchText(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
        const res = await (0, node_fetch_1.default)(url, {
            headers: Object.assign({ 'User-Agent': UA }, (opts.headers || {})),
            signal: controller.signal,
        });
        if (!res.ok)
            return null;
        return await res.text();
    }
    catch (_a) {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=net.js.map