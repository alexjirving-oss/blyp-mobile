"use strict";
/**
 * Server-side text moderation triggers for user-generated text.
 *
 * These are the authoritative enforcement layer for P0.2: even if a client
 * bypasses the local filter (src/utils/contentFilter.js), every comment and DM
 * is re-inspected here and either masked in place or removed.
 *
 *  - moderateComment        : posts/{postId}/comments/{commentId}
 *  - moderateDirectMessage  : conversations/{convId}/messages/{msgId}
 *
 * Behaviour:
 *  - blocked (slurs / minor-safety / threats) -> content scrubbed, doc flagged,
 *    audit written, and an admin alert raised for the most serious categories.
 *  - masked (soft profanity) -> text replaced with masked version, doc flagged.
 *  - clean -> no-op (no extra writes).
 *
 * Loops: we only listen on onCreate and only ever issue update/delete, so a
 * moderation write can never re-trigger the same function.
 *
 * These handlers never throw; moderation failures are logged and swallowed so
 * the write pipeline (and notifications) keep working.
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
exports.moderateDirectMessage = exports.moderateComment = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const textFilter_1 = require("./textFilter");
const REMOVED_PLACEHOLDER = '[message removed]';
const ALERT_CATEGORIES = new Set(['minor_safety', 'threat']);
function excerpt(text, max = 140) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
}
async function writeAudit(db, action) {
    try {
        await db.collection('moderationActions').add({
            actorId: 'system',
            source: 'auto_text_filter',
            actionType: action.actionType,
            targetType: action.targetType,
            targetId: action.targetId,
            authorId: action.authorId || null,
            categories: action.categories || [],
            reasonCode: action.reasonCode || null,
            createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        console.warn('[textModeration] audit write failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
}
async function maybeAlert(db, payload) {
    const serious = payload.categories.some((c) => ALERT_CATEGORIES.has(c));
    if (!serious)
        return;
    try {
        await db.collection('adminAlerts').add({
            kind: 'text_moderation',
            severity: payload.categories.includes('minor_safety') ? 'critical' : 'high',
            targetType: payload.targetType,
            targetId: payload.targetId,
            authorId: payload.authorId || null,
            categories: payload.categories,
            excerpt: payload.excerpt,
            status: 'open',
            createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        });
        // Also surface in Cloud Logging so log-based alerts can page on it.
        console.error(`[ALERT][text_moderation] ${payload.categories.join(',')} ${payload.targetType}/${payload.targetId} author=${payload.authorId || 'unknown'}`);
    }
    catch (e) {
        console.warn('[textModeration] alert write failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
}
exports.moderateComment = functions.firestore
    .document('posts/{postId}/comments/{commentId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const data = snap.data() || {};
    const text = String((data === null || data === void 0 ? void 0 : data.text) || '');
    if (!text.trim())
        return null;
    let result;
    try {
        result = (0, textFilter_1.inspectText)(text);
    }
    catch (e) {
        console.warn('[moderateComment] inspect failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return null;
    }
    if (result.severity === 'clean')
        return null;
    const postId = String(context.params.postId || '');
    const commentId = String(context.params.commentId || '');
    const authorId = String((data === null || data === void 0 ? void 0 : data.userId) || (data === null || data === void 0 ? void 0 : data.uid) || '').trim();
    try {
        if (result.blocked) {
            await snap.ref.delete();
            await writeAudit(db, {
                actionType: 'comment_removed',
                targetType: 'comment',
                targetId: commentId,
                authorId,
                categories: result.categories,
            });
            await maybeAlert(db, {
                targetType: 'comment',
                targetId: commentId,
                authorId,
                categories: result.categories,
                excerpt: excerpt(text),
            });
            console.log(`[moderateComment] removed comment ${postId}/${commentId} (${result.categories.join(',')})`);
        }
        else if (result.masked) {
            await snap.ref.update({
                text: result.clean,
                moderated: 'masked',
                moderatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
    catch (e) {
        console.warn('[moderateComment] enforcement failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    return null;
});
exports.moderateDirectMessage = functions.firestore
    .document('conversations/{convId}/messages/{msgId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const data = snap.data() || {};
    const type = String((data === null || data === void 0 ? void 0 : data.type) || 'text');
    if (type !== 'text')
        return null;
    const text = String((data === null || data === void 0 ? void 0 : data.text) || '');
    if (!text.trim())
        return null;
    let result;
    try {
        result = (0, textFilter_1.inspectText)(text);
    }
    catch (e) {
        console.warn('[moderateDirectMessage] inspect failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return null;
    }
    if (result.severity === 'clean')
        return null;
    const convId = String(context.params.convId || '');
    const msgId = String(context.params.msgId || '');
    const authorId = String((data === null || data === void 0 ? void 0 : data.senderId) || '').trim();
    try {
        if (result.blocked) {
            await snap.ref.update({
                text: REMOVED_PLACEHOLDER,
                moderated: 'removed',
                moderatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            });
            await writeAudit(db, {
                actionType: 'dm_removed',
                targetType: 'message',
                targetId: `${convId}/${msgId}`,
                authorId,
                categories: result.categories,
            });
            await maybeAlert(db, {
                targetType: 'message',
                targetId: `${convId}/${msgId}`,
                authorId,
                categories: result.categories,
                excerpt: excerpt(text),
            });
        }
        else if (result.masked) {
            await snap.ref.update({
                text: result.clean,
                moderated: 'masked',
                moderatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            });
        }
    }
    catch (e) {
        console.warn('[moderateDirectMessage] enforcement failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    return null;
});
//# sourceMappingURL=textModeration.js.map