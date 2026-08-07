/**
 * Resolve a human-facing label for notification titles/bodies.
 * Skips Cognito-sub / UUID-shaped values that were historically stored as
 * username/displayName.
 */

import { admin } from '../firebaseAdmin';

function looksLikeRawId(value: unknown): boolean {
  const t = String(value || '').trim();
  if (!t) return true;
  if (/\s/.test(t)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return true;
  }
  if (t.length >= 20 && /[0-9]/.test(t) && /[a-f]/i.test(t) && /[-_]/.test(t)) {
    return true;
  }
  return false;
}

function clean(value: unknown): string {
  const t = String(value || '').trim();
  if (!t) return '';
  return t.startsWith('@') ? t.slice(1).trim() : t;
}

function pickFromDoc(d: any, uid: string): string {
  const ordered = [d?.username, d?.handle, d?.preferredUsername, d?.displayName, d?.name];
  for (const raw of ordered) {
    const t = clean(raw);
    if (!t) continue;
    if (uid && t === uid) continue;
    if (looksLikeRawId(t)) continue;
    if (/^user_/i.test(t)) continue;
    return t;
  }
  return '';
}

/** Prefer username/handle, then displayName. Never returns the raw uid. */
export async function resolveUserLabel(uid: string, fallback = 'Someone'): Promise<string> {
  const id = String(uid || '').trim();
  const safeFallback = isUsablePublicLabel(fallback) ? clean(fallback) : 'Someone';
  if (!id) return safeFallback;
  const db = admin.firestore();

  try {
    const u = await db.collection('users').doc(id).get();
    const fromUsers = pickFromDoc((u.data() as any) || {}, id);
    if (fromUsers) return fromUsers;
  } catch {
    // fall through
  }

  try {
    const p = await db.collection('userProfiles').doc(id).get();
    const fromProfiles = pickFromDoc((p.data() as any) || {}, id);
    if (fromProfiles) return fromProfiles;
  } catch {
    // fall through
  }

  return safeFallback;
}

export function isUsablePublicLabel(value: unknown, uid?: string): boolean {
  const t = clean(value);
  if (!t) return false;
  if (uid && t === String(uid)) return false;
  if (looksLikeRawId(t)) return false;
  if (/^user_/i.test(t)) return false;
  return true;
}
