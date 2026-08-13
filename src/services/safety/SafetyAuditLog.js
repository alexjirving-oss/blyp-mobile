// Append-only Trust & Safety audit trail (client + trusted backends).
// Collection: safetyAuditLogs/{autoId}
 // No silent deletes — firestore.rules deny update/delete.

import { db, auth, firebaseEnabled } from '../../config/firebase';

/**
 * @param {object} entry
 * @param {string} entry.action - e.g. terms_accept | age_declare | report_create | block_user | chat_flag | live_kill | ban
 * @param {string} [entry.targetType]
 * @param {string} [entry.targetId]
 * @param {object} [entry.metadata]
 */
export async function appendSafetyAudit(entry) {
  if (!entry?.action) return null;
  if (!firebaseEnabled || !db?.collection) return null;

  const actorId = auth?.currentUser?.uid || entry.actorId || null;
  const doc = {
    action: String(entry.action).slice(0, 64),
    actorId: actorId || null,
    targetType: entry.targetType ? String(entry.targetType).slice(0, 40) : null,
    targetId: entry.targetId ? String(entry.targetId).slice(0, 128) : null,
    metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    createdAt: Date.now(),
  };

  try {
    const ref = await db.collection('safetyAuditLogs').add(doc);
    return ref.id;
  } catch (e) {
    console.warn('[SafetyAuditLog] append failed', e?.message || String(e));
    return null;
  }
}

export default { appendSafetyAudit };
