"use strict";
/**
 * AI image generation for "Blyp it" (Imagen via the Gemini API).
 *
 * Generated imagery is owned + moderatable + licence-clean (vs scraping the web),
 * which is exactly why we chose it. If image generation isn't available (key tier
 * without Imagen, transient error), this returns null and the caller degrades to a
 * text-only draft — the feature never hard-fails on the image.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAndStoreImage = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const IMAGE_MODEL = process.env.BLYP_IMAGE_MODEL || 'imagen-3.0-generate-002';
async function generateAndStoreImage(uid, draftId, prompt) {
    var _a, _b, _c, _d, _e;
    const key = process.env.BLYP_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!key || !prompt)
        return null;
    let base64 = null;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:predict?key=${key}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        const res = await (0, node_fetch_1.default)(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                instances: [{ prompt }],
                parameters: { sampleCount: 1, aspectRatio: '1:1' },
            }),
        }).finally(() => clearTimeout(timer));
        if (!res.ok) {
            console.warn('[blyp-it] image gen not available', res.status);
            return null;
        }
        const data = await res.json();
        base64 =
            ((_b = (_a = data === null || data === void 0 ? void 0 : data.predictions) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.bytesBase64Encoded) ||
                ((_e = (_d = (_c = data === null || data === void 0 ? void 0 : data.predictions) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.image) === null || _e === void 0 ? void 0 : _e.bytesBase64Encoded) ||
                null;
    }
    catch (e) {
        console.warn('[blyp-it] image gen error', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return null;
    }
    if (!base64)
        return null;
    try {
        const buffer = Buffer.from(base64, 'base64');
        const objectPath = `assistant/${uid}/${draftId}.png`;
        const file = firebaseAdmin_1.admin.storage().bucket().file(objectPath);
        await file.save(buffer, {
            metadata: { contentType: 'image/png', cacheControl: 'public, max-age=86400' },
        });
        const [signedUrl] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days; draft is short-lived anyway
        });
        return signedUrl;
    }
    catch (e) {
        console.warn('[blyp-it] image upload error', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return null;
    }
}
exports.generateAndStoreImage = generateAndStoreImage;
//# sourceMappingURL=imageGen.js.map