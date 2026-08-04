"use strict";
/**
 * Server-side image moderation (P0.1).
 *
 * On post creation we run Google Cloud Vision SafeSearch over the post's image
 * (or video thumbnail). If adult / violence / racy content is LIKELY or
 * VERY_LIKELY, we route the post through the same takedown pipeline used by the
 * report auto-action: set posts/{id}.moderation.hidden and raise an admin alert.
 *
 * Safety / rollout:
 *  - Gated behind ENABLE_MEDIA_MODERATION so it can be deployed dark and switched
 *    on once the Vision API + billing are confirmed.
 *  - The Vision client is lazily required, so a missing dependency or unconfigured
 *    API degrades to a no-op instead of crashing the function cold-start.
 *  - Never throws; any failure leaves the post visible (fail-open) and is logged.
 *  - Video is approximated by scanning its thumbnail (full-frame video moderation
 *    is a separate, heavier pipeline).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.moderatePostMedia = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const ENABLED = String(process.env.ENABLE_MEDIA_MODERATION || '').toLowerCase() === 'true';
// Vision likelihood ordering. We act on LIKELY/VERY_LIKELY for adult & violence,
// and only VERY_LIKELY for racy (racy is broad and prone to false positives).
const HARD = new Set(['LIKELY', 'VERY_LIKELY']);
let visionClient = null;
let visionInitTried = false;
function getVisionClient() {
    if (visionInitTried)
        return visionClient;
    visionInitTried = true;
    try {
        // Lazy require keeps the dep optional at module-load time.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const vision = require('@google-cloud/vision');
        visionClient = new vision.ImageAnnotatorClient();
    }
    catch (e) {
        console.warn('[mediaModeration] Vision client unavailable', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        visionClient = null;
    }
    return visionClient;
}
function pickImageUri(data) {
    var _a, _b;
    const candidates = [
        data === null || data === void 0 ? void 0 : data.thumbnail,
        data === null || data === void 0 ? void 0 : data.imageUrl,
        Array.isArray(data === null || data === void 0 ? void 0 : data.media) && data.media.length ? ((_a = data.media[0]) === null || _a === void 0 ? void 0 : _a.thumbnail) || ((_b = data.media[0]) === null || _b === void 0 ? void 0 : _b.url) : null,
    ];
    for (const c of candidates) {
        const s = String(c || '').trim();
        if (s && /^https?:\/\//i.test(s))
            return s;
    }
    return null;
}
async function hidePost(db, postId, reason) {
    try {
        await db.collection('posts').doc(postId).set({
            moderation: {
                hidden: true,
                reason,
                source: 'auto_vision',
                at: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            },
        }, { merge: true });
    }
    catch (e) {
        console.warn('[mediaModeration] hidePost failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
}
exports.moderatePostMedia = functions
    .runWith({ timeoutSeconds: 60, memory: '256MB' })
    .firestore.document('posts/{postId}')
    .onCreate(async (snap, context) => {
    if (!ENABLED)
        return null;
    const data = snap.data() || {};
    const imageUri = pickImageUri(data);
    if (!imageUri)
        return null;
    const client = getVisionClient();
    if (!client)
        return null;
    const postId = String(context.params.postId || '');
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    let safe = null;
    try {
        const [result] = await client.safeSearchDetection({ image: { source: { imageUri } } });
        safe = (result === null || result === void 0 ? void 0 : result.safeSearchAnnotation) || null;
    }
    catch (e) {
        console.warn('[mediaModeration] safeSearch failed (fail-open)', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return null;
    }
    if (!safe)
        return null;
    const adult = String(safe.adult || 'UNKNOWN');
    const violence = String(safe.violence || 'UNKNOWN');
    const racy = String(safe.racy || 'UNKNOWN');
    const medical = String(safe.medical || 'UNKNOWN');
    const flagged = HARD.has(adult) ||
        HARD.has(violence) ||
        racy === 'VERY_LIKELY' ||
        medical === 'VERY_LIKELY';
    if (!flagged)
        return null;
    const reason = `vision:adult=${adult},violence=${violence},racy=${racy},medical=${medical}`;
    await hidePost(db, postId, reason);
    try {
        await db.collection('moderationActions').add({
            actorId: 'system',
            source: 'auto_vision',
            actionType: 'post_hidden',
            targetType: 'post',
            targetId: postId,
            authorId: String((data === null || data === void 0 ? void 0 : data.userId) || '').trim() || null,
            decisionReason: reason,
            createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection('adminAlerts').add({
            kind: 'media_moderation',
            severity: HARD.has(adult) || HARD.has(violence) ? 'high' : 'normal',
            targetType: 'post',
            targetId: postId,
            authorId: String((data === null || data === void 0 ? void 0 : data.userId) || '').trim() || null,
            decisionReason: reason,
            hidden: true,
            status: 'open',
            createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        });
        console.error(`[ALERT][media_moderation] post/${postId} ${reason}`);
    }
    catch (e) {
        console.warn('[mediaModeration] audit/alert failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    return null;
});
//# sourceMappingURL=mediaModeration.js.map