import { db as firestore } from '../config/firebase';

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

    const activityData = {
      type: activityType,
      actorId,
      targetUserId,
      timestamp: firestore.FieldValue.serverTimestamp(),
      read: false,
      metadata: {
        ...metadata
      }
    };

    await db.collection('activities').add(activityData);
    console.log('✅ Activity tracked:', activityType, 'for', targetUserId);
  } catch (error) {
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
    const batch = db.batch();
    
    activityIds.forEach(activityId => {
      const activityRef = db.collection('activities').doc(activityId);
      batch.update(activityRef, { read: true });
    });

    await batch.commit();
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
      .onSnapshot((snapshot) => {
        callback(snapshot.docs.length);
      });
  } catch (error) {
    console.error('❌ Error getting unread activity count:', error);
    return null;
  }
};

