// postEditService.js
//
// Editing a post on Blyp is not punished — it's an honest fresh start. When a creator
// edits their caption/title, we snapshot the previous version (an immutable audit
// trail in `postVersions`) and send the post back to AUDITION so it re-earns its
// reach fairly on the new content. See BLYP_CHARTER.md ("earn your reach") and
// functions/src/distribution/reach.ts (server authority).

import { db, firebaseEnabled } from '../config/firebase';
import { initialReachState } from './blypReachClient';

function reAuditionReach(prevReach) {
  const fresh = initialReachState();
  fresh.version = Number(prevReach?.version || 1) + 1;
  return fresh;
}

/**
 * Update a post's text content and re-audition it.
 * @param {string} postId
 * @param {object} prevPost  the current post (for the version snapshot + prior reach)
 * @param {{title?:string, caption?:string, description?:string}} fields
 * @returns {Promise<{ok:boolean, reach?:object, reason?:string}>}
 */
export async function updatePostContent(postId, prevPost, fields) {
  if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
    return { ok: false, reason: 'OFFLINE' };
  }
  if (!postId) return { ok: false, reason: 'NO_POST' };

  const ownerId = prevPost?.userId || prevPost?.uid || null;
  const prevReach = prevPost?.reach || null;
  const newReach = reAuditionReach(prevReach);

  // Best-effort, immutable version snapshot. If it fails (e.g. rules), the edit and
  // re-audition still proceed — the audit trail is a bonus, not a blocker.
  try {
    await db.collection('postVersions').add({
      postId,
      ownerId,
      version: Number(prevReach?.version || 1),
      title: prevPost?.title || '',
      caption: prevPost?.caption || '',
      description: prevPost?.description || '',
      reachAtCapture: prevReach || null,
      capturedAt: Date.now(),
    });
  } catch (e) {
    console.warn('[postEditService] version snapshot failed (non-fatal)', e?.message || String(e));
  }

  const update = { reach: newReach, editedAt: Date.now() };
  if (typeof fields?.title === 'string') update.title = fields.title.trim();
  if (typeof fields?.caption === 'string') {
    const c = fields.caption.trim();
    update.caption = c;
    update.description = c; // keep the two in step, as the create path does
  } else if (typeof fields?.description === 'string') {
    update.description = fields.description.trim();
  }

  try {
    await db.collection('posts').doc(postId).set(update, { merge: true });
    return { ok: true, reach: newReach };
  } catch (e) {
    console.warn('[postEditService] post update failed', e?.message || String(e));
    return { ok: false, reason: 'WRITE_FAILED' };
  }
}

/**
 * Save playback framing (fit / pan / zoom) without re-auditioning reach.
 * Does not re-encode the video — display metadata only.
 * @param {string} postId
 * @param {{fitMode?:'auto'|'cover'|'contain', scale?:number, offsetX?:number, offsetY?:number}} display
 */
export async function updatePostMediaDisplay(postId, display) {
  if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
    return { ok: false, reason: 'OFFLINE' };
  }
  if (!postId) return { ok: false, reason: 'NO_POST' };

  const fitMode = ['auto', 'cover', 'contain'].includes(display?.fitMode)
    ? display.fitMode
    : 'auto';
  // Allow zoom-out (0.5) through zoom-in (2.5) — matches VideoFramingSheet / PremiumFeedVideo.
  const scale = Math.min(2.5, Math.max(0.5, Number(display?.scale) || 1));
  const offsetX = Math.min(1, Math.max(-1, Number(display?.offsetX) || 0));
  const offsetY = Math.min(1, Math.max(-1, Number(display?.offsetY) || 0));

  const mediaDisplay = {
    fitMode,
    scale,
    offsetX,
    offsetY,
    updatedAt: Date.now(),
  };

  try {
    await db.collection('posts').doc(postId).set({ mediaDisplay, framingEditedAt: Date.now() }, { merge: true });
    return { ok: true, mediaDisplay };
  } catch (e) {
    console.warn('[postEditService] mediaDisplay update failed', e?.message || String(e));
    return { ok: false, reason: 'WRITE_FAILED' };
  }
}

/**
 * Assign a post to a profile category shelf (or clear it).
 * @param {string} postId
 * @param {string|null} categoryId
 */
export async function updatePostCategory(postId, categoryId) {
  if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
    return { ok: false, reason: 'OFFLINE' };
  }
  if (!postId) return { ok: false, reason: 'NO_POST' };
  const next = categoryId ? String(categoryId).trim() : null;
  try {
    await db.collection('posts').doc(postId).set(
      { categoryId: next || null, categoryEditedAt: Date.now() },
      { merge: true },
    );
    return { ok: true, categoryId: next };
  } catch (e) {
    console.warn('[postEditService] category update failed', e?.message || String(e));
    return { ok: false, reason: 'WRITE_FAILED' };
  }
}

export default { updatePostContent, updatePostMediaDisplay, updatePostCategory };
