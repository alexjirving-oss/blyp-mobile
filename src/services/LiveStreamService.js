import { db, auth, storage } from '../config/firebase';
import { trackActivity } from '../utils/activityTracker';

/**
 * Service for managing livestreaming functionality
 */
class LiveStreamService {
  /**
   * Create a new livestream
   * @param {Object} streamData - Stream information
   * @param {string} streamData.title - Stream title
   * @param {string} streamData.description - Stream description
   * @param {File} streamData.thumbnailFile - Thumbnail image file
   * @param {Object} streamData.settings - Stream settings
   * @returns {Promise<string>} - Stream ID
   */
  async createStream({ title, description, thumbnailFile, settings = {} }) {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User must be logged in to create a stream');
      
      // Upload thumbnail if provided
      let thumbnailUrl = null;
      if (thumbnailFile && typeof thumbnailFile === 'string') {
        const storageRef = storage().ref(`users/${user.uid}/thumbnails/stream-${Date.now()}`);
        await storageRef.putFile(thumbnailFile);
        thumbnailUrl = await storageRef.getDownloadURL();
      }
      
      // Create stream document
      const streamRef = db.collection('liveStreams');
      const streamDoc = await streamRef.add({
        userId: user.uid,
        title: title || 'Untitled Stream',
        description: description || '',
        thumbnailUrl,
        startedAt: firestore.FieldValue.serverTimestamp(),
        status: 'live',
        viewCount: 1, // Start with 1 viewer (the creator)
        likeCount: 0,
        peakViewerCount: 1,
        settings: {
          privacy: settings.privacy || 'public',
          allowComments: settings.allowComments !== false,
          allowSharing: settings.allowSharing !== false,
          ...settings,
        },
        // Generate a unique channel name for RTC services
        channelName: `blyp_${user.uid.substring(0, 8)}_${Date.now()}`,
      });
      
      // Update user profile to indicate they are live
      const userRef = db.collection('userProfiles').doc(user.uid);
      await userRef.set({
        isLive: true,
        currentStreamId: streamDoc.id,
      }, { merge: true });
      
      // Note: Not tracking stream_started as self-activity (would be filtered out anyway)
      
      console.log(`🔴 Started livestream: ${streamDoc.id}`);
      return streamDoc.id;
    } catch (error) {
      console.error('❌ Error creating livestream:', error);
      throw error;
    }
  }

  /**
   * End an active livestream
   * @param {string} streamId - ID of stream to end
   */
  async endStream(streamId) {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User must be logged in to end a stream');
      
      const streamRef = db.collection('liveStreams').doc(streamId);
      const streamDoc = await streamRef.get();
      
      if (!streamDoc.exists) {
        throw new Error('Stream not found');
      }
      
      if (streamDoc.data().userId !== user.uid) {
        throw new Error('Only the stream creator can end the stream');
      }
      
      // Update stream status and reset viewer count
      await streamRef.update({
        status: 'ended',
        endedAt: firestore.FieldValue.serverTimestamp(),
        viewCount: 0, // Reset viewer count when stream ends
      });
      
      // Update user profile
      const userRef = db.collection('userProfiles').doc(user.uid);
      await userRef.set({
        isLive: false,
        currentStreamId: null,
      }, { merge: true });
      
      // Calculate stream duration for analytics
      const streamData = streamDoc.data();
      const startTime = streamData.startedAt?.toMillis?.() || 
                        streamData.startedAt?.seconds * 1000 || 
                        Date.now();
      const duration = (Date.now() - startTime) / 1000; // in seconds
      
      // Save stream stats
      const statsRef = db.collection('users').doc(user.uid).collection('liveStreamStats').doc(streamId);
      await statsRef.update({
        endedAt: firestore.FieldValue.serverTimestamp(),
        duration,
      });
      
      // Note: Not tracking stream_ended as self-activity (would be filtered out anyway)
      
      console.log(`⏹️ Ended livestream: ${streamId}`);
      return true;
    } catch (error) {
      console.error('❌ Error ending livestream:', error);
      throw error;
    }
  }
  
  /**
   * Get active livestreams
   * @param {number} limit - Maximum number of streams to retrieve
   * @returns {Promise<Array>} - List of active streams
   */
  async getActiveStreams(maxResults = 20) {
    try {
      const cutoff = new Date(Date.now() - 90 * 1000);
      const snapshot = await db
        .collection('liveStreams')
        .where('status', '==', 'live')
        .where('lastHeartbeatAt', '>=', cutoff)
        .orderBy('lastHeartbeatAt', 'desc')
        .limit(maxResults)
        .get();
      return snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
    } catch (error) {
      console.error('❌ Error getting active streams:', error);
      throw error;
    }
  }
  
  /**
   * Subscribe to a specific livestream for real-time updates
   * @param {string} streamId - Stream ID to subscribe to
   * @param {Function} callback - Function to call with updated stream data
   * @returns {Function} - Unsubscribe function
   */
  subscribeToStream(streamId, callback) {
    const streamRef = db.collection('liveStreams').doc(streamId);
    
    return streamRef.onSnapshot((docSnap) => {
      if (docSnap.exists) {
        callback({
          id: docSnap.id,
          ...docSnap.data()
        });
      } else {
        callback(null);
      }
    }, error => {
      console.error(`❌ Error subscribing to stream ${streamId}:`, error);
    });
  }
  
  /**
   * Subscribe to stream comments in real-time
   * @param {string} streamId - Stream ID
   * @param {Function} callback - Callback function for new comments
   * @returns {Function} - Unsubscribe function
   */
  subscribeToComments(streamId, callback) {
    const commentsQuery = db
      .collection('liveStreams')
      .doc(streamId)
      .collection('comments')
      .orderBy('createdAt', 'desc')
      .limit(50);
    
    return commentsQuery.onSnapshot((snapshot) => {
      const comments = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      
      callback(comments);
    }, error => {
      console.error(`❌ Error subscribing to comments for stream ${streamId}:`, error);
    });
  }
  
  /**
   * Add a comment to a livestream
   * @param {string} streamId - Stream ID
   * @param {string} content - Comment content
   * @returns {Promise<string>} - Comment ID
   */
  async addComment(streamId, content) {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User must be logged in to comment');
      
      const commentRef = db.collection('liveStreams').doc(streamId).collection('comments');
      const commentDoc = await commentRef.add({
        userId: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL,
        content,
        createdAt: firestore.FieldValue.serverTimestamp(),
        isBlocked: false,
      });
      
      return commentDoc.id;
    } catch (error) {
      console.error('❌ Error adding comment:', error);
      throw error;
    }
  }
  
  /**
   * Update stream view count (join/leave)
   * @param {string} streamId - Stream ID
   * @param {boolean} isJoining - Whether user is joining (true) or leaving (false)
   * @returns {Promise<number>} - New view count
   */
  async updateViewCount(streamId, isJoining) {
  const streamRef = db.collection('liveStreams').doc(streamId);
    
    try {
      // Use Firestore increment for atomic operations
      const incrementValue = isJoining ? 1 : -1;
      
      await streamRef.update({
        viewCount: firestore.FieldValue.increment(incrementValue)
      });
      
      // Get the updated document to return the new count and update peak if needed
      const updatedDoc = await streamRef.get();
      if (updatedDoc.exists) {
        const data = updatedDoc.data();
        const newCount = Math.max(0, data.viewCount || 0); // Ensure never negative
        
        // Update peak viewer count if this is a new high
        if (isJoining && newCount > (data.peakViewerCount || 0)) {
          await streamRef.update({
            peakViewerCount: newCount
          });
        }
        
        return newCount;
      }
      
      return 0;
    } catch (error) {
      console.error(`❌ Error updating view count for stream ${streamId}:`, error);
      // Don't throw error - just log it to avoid breaking the stream
      return 0;
    }
  }
  
  /**
   * Like or unlike a livestream
   * @param {string} streamId - Stream ID
   * @param {boolean} isLiking - Whether user is liking or unliking
   * @returns {Promise<number>} - New like count
   */
  async updateLikeCount(streamId, isLiking) {
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('User must be logged in to like a stream');
      
  const streamRef = db.collection('liveStreams').doc(streamId);
  const likeRef = streamRef.collection('likes').doc(user.uid);
      
      // Check if user already liked
  const likeDoc = await likeRef.get();
  const hasLiked = likeDoc.exists;
      
      // If action matches current state, do nothing
      if ((isLiking && hasLiked) || (!isLiking && !hasLiked)) {
        return;
      }
      
      // Update like status
      if (isLiking) {
        await streamRef.update({
          likeCount: firestore.FieldValue.increment(1)
        });
        
        await likeRef.set({
          userId: user.uid,
          timestamp: firestore.FieldValue.serverTimestamp()
        });
        
        // Note: Not tracking self-likes (would be filtered out anyway)
      } else {
        await streamRef.update({
          likeCount: firestore.FieldValue.increment(-1)
        });
        
        await likeRef.delete();
      }
      
      // Get updated count
      const updatedStreamDoc = await getDoc(streamRef);
      return updatedStreamDoc.data().likeCount || 0;
    } catch (error) {
      console.error(`❌ Error updating like count for stream ${streamId}:`, error);
      throw error;
    }
  }
}

export default new LiveStreamService();