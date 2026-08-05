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
 * Recompute denormalized follow counters from the graph subcollections.
 * Keeps discovery / profile fields honest and backfills stale zeros for
 * users involved in a follow write.
 */
async function syncFollowCounts(userIds: string[]): Promise<void> {
  const db = getFirestore();
  if (!db) return;
  const unique = Array.from(new Set(userIds.map(normalizeUserId).filter(Boolean)));
  await Promise.all(
    unique.map(async (userId) => {
      try {
        const [followersAgg, followingAgg] = await Promise.all([
          db.collection('users').doc(userId).collection('followers').count().get(),
          db.collection('users').doc(userId).collection('following').count().get(),
        ]);
        const followersCount = followersAgg.data().count;
        const followingCount = followingAgg.data().count;
        await db.collection('users').doc(userId).set(
          {
            followersCount,
            followingCount,
            // Legacy aliases some discovery code still reads.
            followers: followersCount,
            following: followingCount,
          },
          { merge: true },
        );
      } catch (e) {
        console.warn('[socialFollow] syncFollowCounts failed', userId, (e as any)?.message || e);
      }
    }),
  );
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
  const existing = await followingRef.get();
  if (existing.exists) {
    // Idempotent: still refresh denormalized counts in case they drifted.
    void syncFollowCounts([actor, targetUserId]);
    return { ok: true, following: true, targetUserId };
  }

  const now = FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.set(
    followingRef,
    {
      userId: targetUserId,
      followedAt: now,
      createdAt: now,
      timestamp: now,
    },
    { merge: true },
  );
  batch.set(
    followerRef,
    {
      userId: actor,
      followedAt: now,
      createdAt: now,
      timestamp: now,
    },
    { merge: true },
  );
  await batch.commit();
  await syncFollowCounts([actor, targetUserId]);

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
  await syncFollowCounts([actor, targetUserId]);

  return { ok: true, following: false, targetUserId };
}
