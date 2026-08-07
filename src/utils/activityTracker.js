import { serverTimestamp, writeBatch, doc as webDoc } from 'firebase/firestore';
import { db, firestore } from '../config/firebase';
import { looksLikeRawId, pickPublicLabel } from './publicLabel';

let hasWarnedActivityPermissions = false;

async function resolveActorFields(actorId, metadata = {}) {
  const fromMeta = pickPublicLabel(
    {
      username: metadata.actorUsername || metadata.username,
      displayName: metadata.actorDisplayName || metadata.displayName,
    },
    { uid: actorId, fallback: '' }
  );
  if (fromMeta) {
    return { actorUsername: fromMeta, actorDisplayName: fromMeta };
  }
  try {
    const snap = await db.collection('users').doc(actorId).get();
    const d = typeof snap?.data === 'function' ? snap.data() : snap?.data || {};
    const label = pickPublicLabel(d || {}, { uid: actorId, fallback: '' });
    if (label && !looksLikeRawId(label)) {
      return { actorUsername: label, actorDisplayName: label };
    }
  } catch {
    /* best-effort denormalization */
  }
  return { actorUsername: null, actorDisplayName: null };
}

function isFirestorePermissionError(error) {
  const code = String(error?.code || '').toLowerCase();
  if (code === 'permission-denied' || code === 'unauthenticated') return true;
  const msg = String(error?.message || error || '');
  return msg.includes('Missing or insufficient permissions');
}

// Activity types
export const ACTIVITY_TYPES = {
  LIKE: 'like',
  UNLIKE: 'unlike',
  SHARE: 'share',
  PROFILE_VIEW: 'profile_view',
  COMMENT: 'comment',
  FOLLOW: 'follow',
  UNFOLLOW: 'unfollow'
};

/**
 * Track an activity in Firestore
 * @param {string} activityType - Type of activity (like, share, etc.)
 * @param {string} actorId - User ID who performed the action
 * @param {string} targetUserId - User ID who will receive the notification
 * @param {Object} metadata - Additional data (postId, postTitle, etc.)
 */
export const trackActivity = async (activityType, actorId, targetUserId, metadata = {}) => {
  try {
    // Don't track activities for self-interactions
    if (actorId === targetUserId) {
      return;
    }

    const actorFields = await resolveActorFields(actorId, metadata);
    const activityData = {
      type: activityType,
      actorId,
      targetUserId,
      // Denormalized at write time so inbox/activity UIs don't depend on a
      // live profile read (and never persist a raw uid as the label).
      actorUsername: actorFields.actorUsername,
      actorDisplayName: actorFields.actorDisplayName,
      timestamp: serverTimestamp(),
      read: false,
      metadata: {
        ...metadata,
        ...(actorFields.actorUsername ? { actorUsername: actorFields.actorUsername } : {}),
        ...(actorFields.actorDisplayName ? { actorDisplayName: actorFields.actorDisplayName } : {}),
      },
    };

    await db.collection('activities').add(activityData);
    console.log('✅ Activity tracked:', activityType, 'for', targetUserId);
  } catch (error) {
    // Activity tracking is non-blocking. If rules deny this write in some
    // environments, do not surface as a dev-bricking console error.
    if (isFirestorePermissionError(error)) {
      if (!hasWarnedActivityPermissions) {
        hasWarnedActivityPermissions = true;
        console.warn('⚠️ Activity tracking skipped (Firestore permissions)', error?.message || String(error));
      }
      return;
    }

    console.error('❌ Error tracking activity:', error);
  }
};

/**
 * Get activities for a specific user
 * @param {string} userId - User ID to get activities for
 * @param {number} limitCount - Number of activities to fetch
 * @param {function} callback - Callback function to handle real-time updates
 */
export const getUserActivities = (userId, limitCount = 50, callback) => {
  try {
    return db
      .collection('activities')
      .where('targetUserId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(limitCount)
      .onSnapshot((snapshot) => {
      // Optional: Log activity count for debugging
      if (snapshot.docs.length === 0) {
        console.log('No activities found for user');
      }
      
      callback(snapshot);
    }, (error) => {
      if (isFirestorePermissionError(error)) {
        if (!hasWarnedActivityPermissions) {
          hasWarnedActivityPermissions = true;
          console.warn('⚠️ Activity feed disabled (Firestore permissions)', error?.message || String(error));
        }
        return;
      }
      console.error('❌ getUserActivities: Snapshot error:', error);
    });
  } catch (error) {
    console.error('❌ Error getting user activities:', error);
    return null;
  }
};

/**
 * Mark activities as read
 * @param {Array} activityIds - Array of activity IDs to mark as read
 */
export const markActivitiesAsRead = async (activityIds) => {
  try {
    // The compat `db` wrapper has no .batch(); use the raw instance.
    if (typeof firestore?.batch === 'function' && typeof firestore?.collection === 'function') {
      // Native (@react-native-firebase) instance.
      const batch = firestore.batch();
      activityIds.forEach((activityId) => {
        batch.update(firestore.collection('activities').doc(activityId), { read: true });
      });
      await batch.commit();
    } else {
      // Web modular instance.
      const batch = writeBatch(firestore);
      activityIds.forEach((activityId) => {
        batch.update(webDoc(firestore, 'activities', activityId), { read: true });
      });
      await batch.commit();
    }
    console.log('✅ Activities marked as read');
  } catch (error) {
    console.error('❌ Error marking activities as read:', error);
  }
};

/**
 * Get unread activity count for a user
 * @param {string} userId - User ID to get unread count for
 * @param {function} callback - Callback function to handle real-time updates
 */
export const getUnreadActivityCount = (userId, callback) => {
  try {
    return db
      .collection('activities')
      .where('targetUserId', '==', userId)
      .where('read', '==', false)
      // Bound the read: a badge never needs more than this, and an unbounded
      // listener grows without limit as unread items accumulate.
      .limit(99)
      .onSnapshot((snapshot) => {
        callback(snapshot.docs.length);
      });
  } catch (error) {
    console.error('❌ Error getting unread activity count:', error);
    return null;
  }
};

