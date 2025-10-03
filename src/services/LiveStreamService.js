import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit, 
  serverTimestamp, 
  increment,
  onSnapshot,
  runTransaction
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, auth } from '../config/firebase';
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
      if (thumbnailFile) {
        const storageRef = ref(storage, `users/${user.uid}/thumbnails/stream-${Date.now()}`);
        await uploadBytes(storageRef, thumbnailFile);
        thumbnailUrl = await getDownloadURL(storageRef);
      }
      
      // Create stream document
      const streamRef = collection(db, 'liveStreams');
      const streamDoc = await addDoc(streamRef, {
        userId: user.uid,
        title: title || 'Untitled Stream',
        description: description || '',
        thumbnailUrl,
        startedAt: serverTimestamp(),
        status: 'live',
        viewCount: 0,
        likeCount: 0,
        peakViewerCount: 0,
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
      const userRef = doc(db, 'userProfiles', user.uid);
      await updateDoc(userRef, {
        isLive: true,
        currentStreamId: streamDoc.id,
      });
      
      // Track activity
      trackActivity(user.uid, 'stream_started', { streamId: streamDoc.id });
      
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
      
      const streamRef = doc(db, 'liveStreams', streamId);
      const streamDoc = await getDoc(streamRef);
      
      if (!streamDoc.exists()) {
        throw new Error('Stream not found');
      }
      
      if (streamDoc.data().userId !== user.uid) {
        throw new Error('Only the stream creator can end the stream');
      }
      
      // Update stream status
      await updateDoc(streamRef, {
        status: 'ended',
        endedAt: serverTimestamp(),
      });
      
      // Update user profile
      const userRef = doc(db, 'userProfiles', user.uid);
      await updateDoc(userRef, {
        isLive: false,
        currentStreamId: null,
      });
      
      // Calculate stream duration for analytics
      const streamData = streamDoc.data();
      const startTime = streamData.startedAt?.toMillis?.() || 
                        streamData.startedAt?.seconds * 1000 || 
                        Date.now();
      const duration = (Date.now() - startTime) / 1000; // in seconds
      
      // Save stream stats
      const statsRef = doc(db, `users/${user.uid}/liveStreamStats/${streamId}`);
      await updateDoc(statsRef, {
        endedAt: serverTimestamp(),
        duration,
      });
      
      // Track activity
      trackActivity(user.uid, 'stream_ended', { 
        streamId,
        duration,
        viewCount: streamData.viewCount || 0,
        peakViewerCount: streamData.peakViewerCount || 0,
      });
      
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
      const streamsQuery = query(
        collection(db, 'liveStreams'),
        where('status', '==', 'live'),
        orderBy('startedAt', 'desc'),
        limit(maxResults)
      );
      
      const snapshot = await getDocs(streamsQuery);
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
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
    const streamRef = doc(db, 'liveStreams', streamId);
    
    return onSnapshot(streamRef, (doc) => {
      if (doc.exists()) {
        callback({
          id: doc.id,
          ...doc.data()
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
    const commentsQuery = query(
      collection(db, 'streamComments'),
      where('streamId', '==', streamId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    
    return onSnapshot(commentsQuery, (snapshot) => {
      const comments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
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
      
      const commentRef = collection(db, 'streamComments');
      const commentDoc = await addDoc(commentRef, {
        streamId,
        userId: user.uid,
        displayName: user.displayName,
        photoURL: user.photoURL,
        content,
        createdAt: serverTimestamp(),
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
    const streamRef = doc(db, 'liveStreams', streamId);
    
    try {
      return await runTransaction(db, async (transaction) => {
        const streamDoc = await transaction.get(streamRef);
        
        if (!streamDoc.exists()) {
          throw new Error("Stream does not exist!");
        }
        
        const currentCount = streamDoc.data().viewCount || 0;
        const newCount = isJoining ? currentCount + 1 : Math.max(0, currentCount - 1);
        
        transaction.update(streamRef, { viewCount: newCount });
        
        // If this is a new peak, update that too
        if (isJoining && newCount > (streamDoc.data().peakViewerCount || 0)) {
          transaction.update(streamRef, { peakViewerCount: newCount });
        }
        
        return newCount;
      });
    } catch (error) {
      console.error(`❌ Error updating view count for stream ${streamId}:`, error);
      throw error;
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
      
      const streamRef = doc(db, 'liveStreams', streamId);
      const likeRef = doc(db, `liveStreams/${streamId}/likes/${user.uid}`);
      
      // Check if user already liked
      const likeDoc = await getDoc(likeRef);
      const hasLiked = likeDoc.exists();
      
      // If action matches current state, do nothing
      if ((isLiking && hasLiked) || (!isLiking && !hasLiked)) {
        return;
      }
      
      // Update like status
      if (isLiking) {
        await updateDoc(streamRef, {
          likeCount: increment(1)
        });
        
        await updateDoc(likeRef, {
          userId: user.uid,
          timestamp: serverTimestamp()
        });
        
        trackActivity(user.uid, 'stream_like', { streamId });
      } else {
        await updateDoc(streamRef, {
          likeCount: increment(-1)
        });
        
        await deleteDoc(likeRef);
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