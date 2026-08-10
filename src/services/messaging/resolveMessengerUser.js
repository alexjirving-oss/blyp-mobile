import { doc, getDoc } from 'firebase/firestore';
import { firestore, firebaseEnabled } from '../../config/firebase';
import { fixStorageUrl } from '../../utils/urlUtils';

const cache = new Map();

/** Prefer any real photo field; never invent placeholders. */
export function resolveUserPhoto(u) {
  if (!u || typeof u !== 'object') return null;
  const raw =
    u.photoURL ||
    u.avatar ||
    u.avatarUrl ||
    u.userPhotoURL ||
    u.profilePicture ||
    u.photo ||
    u.profilePhoto ||
    null;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Block decorative placeholder hosts — show initials instead.
  if (/placehold\.co|via\.placeholder|placeholder\.com/i.test(trimmed)) return null;
  return fixStorageUrl(trimmed) || trimmed;
}

function pickPhotoFromDoc(d) {
  return resolveUserPhoto(d || {});
}

/**
 * Fetch a user profile for inbox/chat/Home DM rows.
 * Always resolve photo from users + userProfiles (same path as Activity/Top Circle)
 * so denormalized displayName without photoURL never wins.
 */
export async function fetchMessengerUserProfile(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  if (!firebaseEnabled || !firestore) return null;
  try {
    const snap = await getDoc(doc(firestore, 'users', id));
    const d = snap.exists() ? snap.data() || {} : {};
    let photoURL = pickPhotoFromDoc(d);
    let displayName = d.displayName || d.name || null;
    let username = d.username || d.handle || null;

    if (!photoURL || !username || !displayName) {
      try {
        const pSnap = await getDoc(doc(firestore, 'userProfiles', id));
        if (pSnap.exists()) {
          const p = pSnap.data() || {};
          if (!photoURL) photoURL = pickPhotoFromDoc(p);
          if (!username) username = p.username || p.handle || username;
          if (!displayName) displayName = p.displayName || p.name || displayName;
        }
      } catch {
        /* ignore */
      }
    }

    const profile = {
      id,
      ...d,
      username: username || displayName || null,
      displayName: displayName || username || null,
      photoURL: photoURL || null,
      avatar: photoURL || null,
    };
    cache.set(id, profile);
    return profile;
  } catch {
    return null;
  }
}

export function primeMessengerUserProfile(profile) {
  if (profile?.id) cache.set(profile.id, profile);
}

/** Batch-resolve peer profiles (Home Messages rail, inbox). */
export async function fetchMessengerUserProfiles(userIds = []) {
  const ids = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const out = new Map();
  await Promise.all(
    ids.map(async (id) => {
      const p = await fetchMessengerUserProfile(id);
      if (p) out.set(id, p);
    }),
  );
  return out;
}
