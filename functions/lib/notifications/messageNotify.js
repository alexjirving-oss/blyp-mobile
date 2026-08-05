"use strict";
/**
 * Direct-message push — WhatsApp-style.
 *
 * When a new message is written to `conversations/{convId}/messages/{msgId}`,
 * fan a push out to every participant except the sender, so recipients get a
 * notification on their phone even with the app closed.
 *
 * Rides the existing notification spine (enqueueNotification -> dispatcher ->
 * FCM via users/{uid}/devices), exactly like the live-alert / battle triggers.
 *
 * Safety:
 *  - Each recipient enqueue is idempotent via dedupeKey `dm:<conv>:<msg>:<uid>`,
 *    so a retried trigger can't double-notify.
 *  - System messages are skipped (no human sender to announce).
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onDirectMessageCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("./outbox");
const MAX_BODY_LEN = 180;
function previewForMessage(msg) {
    const type = String((msg === null || msg === void 0 ? void 0 : msg.type) || 'text');
    const text = String((msg === null || msg === void 0 ? void 0 : msg.text) || '').trim();
    if (text)
        return text.length > MAX_BODY_LEN ? `${text.slice(0, MAX_BODY_LEN)}…` : text;
    switch (type) {
        case 'image':
            return '📷 Photo';
        case 'video':
            return '🎥 Video';
        case 'audio':
            return '🎤 Voice message';
        case 'file':
            return '📎 Attachment';
        default:
            return 'New message';
    }
}
exports.onDirectMessageCreate = functions.firestore
    .document('conversations/{convId}/messages/{msgId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const msg = snap.data() || {};
    const convId = String(context.params.convId || '');
    const msgId = String(context.params.msgId || '');
    const senderId = String((msg === null || msg === void 0 ? void 0 : msg.senderId) || '').trim();
    const msgType = String((msg === null || msg === void 0 ? void 0 : msg.type) || 'text');
    // Nothing to announce for system messages or malformed docs.
    if (!convId || !senderId || msgType === 'system')
        return null;
    let conv = null;
    try {
        const convSnap = await db.collection('conversations').doc(convId).get();
        conv = convSnap.exists ? convSnap.data() : null;
    }
    catch (e) {
        console.warn('[messageNotify] conversation read failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    if (!conv)
        return null;
    const participants = Array.isArray(conv.participantIds) ? conv.participantIds : [];
    const recipients = participants
        .map((id) => String(id || '').trim())
        .filter((id) => id && id !== senderId);
    if (recipients.length === 0)
        return null;
    const senderName = String((msg === null || msg === void 0 ? void 0 : msg.senderName) || '').trim() || 'New message';
    // For 1:1 DMs the title is just the sender; for groups, include the group name.
    const isGroup = String(conv.type || 'dm') === 'group' && recipients.length > 1;
    const groupName = String(conv.name || conv.title || '').trim();
    const title = isGroup && groupName ? `${senderName} · ${groupName}` : senderName;
    const body = previewForMessage(msg);
    await Promise.all(recipients.map((recipientUid) => (0, outbox_1.enqueueNotification)({
        userId: recipientUid,
        type: 'message',
        title,
        body,
        dedupeKey: `dm:${convId}:${msgId}:${recipientUid}`,
        collapseKey: `dm:${convId}`,
        data: {
            type: 'message',
            conversationId: convId,
            senderId,
            senderName,
        },
    }).catch((e) => {
        console.warn('[messageNotify] enqueue failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return false;
    })));
    return null;
});
//# sourceMappingURL=messageNotify.js.map