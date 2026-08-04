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

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { inspectText } from './textFilter';

const REMOVED_PLACEHOLDER = '[message removed]';
const ALERT_CATEGORIES = new Set(['minor_safety', 'threat']);

function excerpt(text: string, max = 140): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

async function writeAudit(
  db: admin.firestore.Firestore,
  action: {
    actionType: string;
    targetType: string;
    targetId: string;
    authorId?: string;
    categories?: string[];
    reasonCode?: string;
  }
): Promise<void> {
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[textModeration] audit write failed', (e as any)?.message || String(e));
  }
}

async function maybeAlert(
  db: admin.firestore.Firestore,
  payload: {
    targetType: string;
    targetId: string;
    authorId?: string;
    categories: string[];
    excerpt: string;
  }
): Promise<void> {
  const serious = payload.categories.some((c) => ALERT_CATEGORIES.has(c));
  if (!serious) return;
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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    // Also surface in Cloud Logging so log-based alerts can page on it.
    console.error(
      `[ALERT][text_moderation] ${payload.categories.join(',')} ${payload.targetType}/${payload.targetId} author=${payload.authorId || 'unknown'}`
    );
  } catch (e) {
    console.warn('[textModeration] alert write failed', (e as any)?.message || String(e));
  }
}

export const moderateComment = functions.firestore
  .document('posts/{postId}/comments/{commentId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const data = (snap.data() as any) || {};
    const text = String(data?.text || '');
    if (!text.trim()) return null;

    let result;
    try {
      result = inspectText(text);
    } catch (e) {
      console.warn('[moderateComment] inspect failed', (e as any)?.message || String(e));
      return null;
    }
    if (result.severity === 'clean') return null;

    const postId = String(context.params.postId || '');
    const commentId = String(context.params.commentId || '');
    const authorId = String(data?.userId || data?.uid || '').trim();

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
      } else if (result.masked) {
        await snap.ref.update({
          text: result.clean,
          moderated: 'masked',
          moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn('[moderateComment] enforcement failed', (e as any)?.message || String(e));
    }
    return null;
  });

export const moderateDirectMessage = functions.firestore
  .document('conversations/{convId}/messages/{msgId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const data = (snap.data() as any) || {};
    const type = String(data?.type || 'text');
    if (type !== 'text') return null;
    const text = String(data?.text || '');
    if (!text.trim()) return null;

    let result;
    try {
      result = inspectText(text);
    } catch (e) {
      console.warn('[moderateDirectMessage] inspect failed', (e as any)?.message || String(e));
      return null;
    }
    if (result.severity === 'clean') return null;

    const convId = String(context.params.convId || '');
    const msgId = String(context.params.msgId || '');
    const authorId = String(data?.senderId || '').trim();

    try {
      if (result.blocked) {
        await snap.ref.update({
          text: REMOVED_PLACEHOLDER,
          moderated: 'removed',
          moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
      } else if (result.masked) {
        await snap.ref.update({
          text: result.clean,
          moderated: 'masked',
          moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn('[moderateDirectMessage] enforcement failed', (e as any)?.message || String(e));
    }
    return null;
  });
