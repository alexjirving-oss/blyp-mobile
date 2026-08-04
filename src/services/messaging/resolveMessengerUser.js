import { doc, getDoc } from 'firebase/firestore';
import { firestore, firebaseEnabled } from '../../config/firebase';

const cache = new Map();

export function resolveUserPhoto(u) {
  return (u && (u.photoURL || u.avatar || u.userPhotoURL || u.photo || u.profilePhoto)) || null;
}

/** Fetch a user profile for inbox/chat rows when the bulk users list missed them. */
export async function fetchMessengerUserProfile(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  if (cache.has(id)) return cache.get(id);
  if (!firebaseEnabled || !firestore) return null;
  try {
    const snap = await getDoc(doc(firestore, 'users', id));
    if (!snap.exists()) return null;
    const profile = { id, ...snap.data() };
    cache.set(id, profile);
    return profile;
  } catch {
    return null;
  }
}

export function primeMessengerUserProfile(profile) {
  if (profile?.id) cache.set(profile.id, profile);
}
