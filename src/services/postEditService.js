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

export default { updatePostContent };
