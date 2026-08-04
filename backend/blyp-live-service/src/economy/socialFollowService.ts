import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../admin/firestoreAdmin';
import { EconomyError } from './economyErrors';

function normalizeUserId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function assertTargetExists(targetUserId: string): Promise<void> {
  const db = getFirestore();
  if (!db) throw new EconomyError('PROVIDER_ERROR', 503, 'Firestore unavailable');
  const snap = await db.collection('users').doc(targetUserId).get();
  if (!snap.exists) {
    throw new EconomyError('NOT_FOUND', 404, 'User not found', { targetUserId });
  }
}

/**
 * Server-authoritative follow write.
 * Mirrors client Firestore graph: users/{actor}/following/{target}
 * and users/{target}/followers/{actor}.
 */
export async function followUser(actorUserId: string, targetUserIdRaw: string): Promise<{
  ok: true;
  following: true;
  targetUserId: string;
}> {
  const actor = normalizeUserId(actorUserId);
  const targetUserId = normalizeUserId(targetUserIdRaw);
  if (!actor) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
  if (!targetUserId) throw new EconomyError('INVALID_INPUT', 400, 'targetUserId is required');
  if (actor === targetUserId) {
    throw new EconomyError('INVALID_INPUT', 400, 'Cannot follow yourself');
  }

  await assertTargetExists(targetUserId);

  const db = getFirestore();
  if (!db) throw new EconomyError('PROVIDER_ERROR', 503, 'Firestore unavailable');

  const followingRef = db.collection('users').doc(actor).collection('following').doc(targetUserId);
  const followerRef = db.collection('users').doc(targetUserId).collection('followers').doc(actor);
  const now = FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.set(
    followingRef,
    {
      userId: targetUserId,
      followedAt: now,
      createdAt: now,
    },
    { merge: true },
  );
  batch.set(
    followerRef,
    {
      userId: actor,
      followedAt: now,
      createdAt: now,
    },
    { merge: true },
  );
  await batch.commit();

  return { ok: true, following: true, targetUserId };
}

export async function unfollowUser(actorUserId: string, targetUserIdRaw: string): Promise<{
  ok: true;
  following: false;
  targetUserId: string;
}> {
  const actor = normalizeUserId(actorUserId);
  const targetUserId = normalizeUserId(targetUserIdRaw);
  if (!actor) throw new EconomyError('UNAUTH', 401, 'Unauthorized');
  if (!targetUserId) throw new EconomyError('INVALID_INPUT', 400, 'targetUserId is required');
  if (actor === targetUserId) {
    throw new EconomyError('INVALID_INPUT', 400, 'Cannot unfollow yourself');
  }

  const db = getFirestore();
  if (!db) throw new EconomyError('PROVIDER_ERROR', 503, 'Firestore unavailable');

  const followingRef = db.collection('users').doc(actor).collection('following').doc(targetUserId);
  const followerRef = db.collection('users').doc(targetUserId).collection('followers').doc(actor);

  const batch = db.batch();
  batch.delete(followingRef);
  batch.delete(followerRef);
  await batch.commit();

  return { ok: true, following: false, targetUserId };
}
