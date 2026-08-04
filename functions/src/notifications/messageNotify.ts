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

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { enqueueNotification } from './outbox';

const MAX_BODY_LEN = 180;

function previewForMessage(msg: any): string {
  const type = String(msg?.type || 'text');
  const text = String(msg?.text || '').trim();
  if (text) return text.length > MAX_BODY_LEN ? `${text.slice(0, MAX_BODY_LEN)}…` : text;
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

export const onDirectMessageCreate = functions.firestore
  .document('conversations/{convId}/messages/{msgId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const db = admin.firestore();

    const msg = (snap.data() as any) || {};
    const convId = String(context.params.convId || '');
    const msgId = String(context.params.msgId || '');
    const senderId = String(msg?.senderId || '').trim();
    const msgType = String(msg?.type || 'text');

    // Nothing to announce for system messages or malformed docs.
    if (!convId || !senderId || msgType === 'system') return null;

    let conv: any = null;
    try {
      const convSnap = await db.collection('conversations').doc(convId).get();
      conv = convSnap.exists ? convSnap.data() : null;
    } catch (e) {
      console.warn('[messageNotify] conversation read failed', (e as any)?.message || String(e));
    }
    if (!conv) return null;

    const participants: string[] = Array.isArray(conv.participantIds) ? conv.participantIds : [];
    const recipients = participants
      .map((id) => String(id || '').trim())
      .filter((id) => id && id !== senderId);
    if (recipients.length === 0) return null;

    const senderName = String(msg?.senderName || '').trim() || 'New message';
    // For 1:1 DMs the title is just the sender; for groups, include the group name.
    const isGroup = String(conv.type || 'dm') === 'group' && recipients.length > 1;
    const groupName = String(conv.name || conv.title || '').trim();
    const title = isGroup && groupName ? `${senderName} · ${groupName}` : senderName;
    const body = previewForMessage(msg);

    await Promise.all(
      recipients.map((recipientUid) =>
        enqueueNotification({
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
          console.warn('[messageNotify] enqueue failed', (e as any)?.message || String(e));
          return false;
        })
      )
    );

    return null;
  });
