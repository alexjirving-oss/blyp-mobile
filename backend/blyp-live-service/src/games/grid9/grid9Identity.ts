import { createHash } from 'crypto';
import { getFirestore } from '../../admin/firestoreAdmin';
import { safeLiveDisplayName } from '../../live/liveDisplayName';
import type { Grid9Identity } from './grid9Engine';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function fallbackPublicId(userId: string): string {
  return `player-${createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 12)}`;
}

export async function resolveGrid9Identity(
  userId: string,
): Promise<Grid9Identity> {
  const fallback: Grid9Identity = {
    userId,
    publicProfileId: fallbackPublicId(userId),
    displayName: 'Blyp player',
    avatarUrl: null,
  };
  const firestore = getFirestore();
  if (!firestore) return fallback;
  try {
    const [userSnap, profileSnap] = await Promise.all([
      firestore.collection('users').doc(userId).get(),
      firestore.collection('userProfiles').doc(userId).get(),
    ]);
    const user = (userSnap.data() || {}) as Record<string, unknown>;
    const profile = (profileSnap.data() || {}) as Record<string, unknown>;
    const username =
      stringValue(user.username) ||
      stringValue(user.handle) ||
      stringValue(profile.username) ||
      stringValue(profile.handle);
    const displayName = safeLiveDisplayName(
      user.displayName ||
        user.name ||
        profile.displayName ||
        profile.name ||
        username,
      userId,
      'Blyp player',
    );
    const avatarUrl =
      stringValue(user.photoURL) ||
      stringValue(user.avatarUrl) ||
      stringValue(user.profilePicture) ||
      stringValue(profile.photoURL) ||
      stringValue(profile.avatarUrl) ||
      null;
    return {
      userId,
      publicProfileId: username || fallback.publicProfileId,
      displayName,
      avatarUrl,
    };
  } catch {
    return fallback;
  }
}
