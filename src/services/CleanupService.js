import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';

class CleanupService {
  static async cleanupGamePosts(userId) {
    try {
      console.log('🧹 Starting cleanup of game posts for user:', userId);
      
      // Query all posts where type equals 'game' AND userId matches current user
      const gamePostsQuery = query(
        collection(db, 'posts'),
        where('type', '==', 'game'),
        where('userId', '==', userId)
      );
      
      const querySnapshot = await getDocs(gamePostsQuery);
      console.log(`📊 Found ${querySnapshot.docs.length} game posts to delete`);
      
      let deletedCount = 0;
      let errorCount = 0;
      
      // Delete each game post
      for (const docSnapshot of querySnapshot.docs) {
        try {
          const postId = docSnapshot.id;
          const postData = docSnapshot.data();
          
          console.log(`🗑️ Deleting game post: ${postId} - ${postData.content || postData.gameType || 'No content'}`);
          
          await deleteDoc(doc(db, 'posts', postId));
          deletedCount++;
          
          console.log(`✅ Successfully deleted: ${postId}`);
          
        } catch (error) {
          console.error(`❌ Error deleting post ${docSnapshot.id}:`, error.message);
          errorCount++;
        }
      }
      
      // Also cleanup posts that contain game-related content
      const gameContentPostsQuery = query(
        collection(db, 'posts'),
        where('userId', '==', userId)
      );
      
      const allPostsSnapshot = await getDocs(gameContentPostsQuery);
      console.log(`📊 Checking ${allPostsSnapshot.docs.length} user posts for game content`);
      
      for (const docSnapshot of allPostsSnapshot.docs) {
        try {
          const postId = docSnapshot.id;
          const postData = docSnapshot.data();
          
          // Skip if already deleted
          if (querySnapshot.docs.some(doc => doc.id === postId)) {
            continue;
          }
          
          // Check if this post has gameType or game-related content
          const isGamePost = postData.gameType || 
                            (postData.content && postData.content.includes('🎮')) ||
                            (postData.content && postData.content.includes('game'));
          
          if (!isGamePost) {
            continue;
          }
          
          console.log(`🗑️ Deleting gameType post: ${postId} - ${postData.gameType || 'Unknown game'}`);
          
          await deleteDoc(doc(db, 'posts', postId));
          deletedCount++;
          
          console.log(`✅ Successfully deleted: ${postId}`);
          
        } catch (error) {
          console.error(`❌ Error deleting post ${docSnapshot.id}:`, error.message);
          errorCount++;
        }
      }
      
      console.log('\n📈 Cleanup Summary:');
      console.log(`✅ Successfully deleted: ${deletedCount} posts`);
      console.log(`❌ Failed to delete: ${errorCount} posts`);
      console.log(`📊 Total found: ${querySnapshot.docs.length + gameTypeSnapshot.docs.length} posts`);
      
      return {
        success: true,
        deletedCount,
        errorCount,
        totalFound: querySnapshot.docs.length + gameTypeSnapshot.docs.length
      };
      
    } catch (error) {
      console.error('💥 Error during cleanup:', error);
      return {
        success: false,
        error: error.message,
        deletedCount: 0,
        errorCount: 0,
        totalFound: 0
      };
    }
  }

  // Cleanup all posts by current user (use carefully!)
  static async cleanupAllUserPosts(userId, postTypes = ['game']) {
    try {
      console.log(`🧹 Starting cleanup of ${postTypes.join(', ')} posts for user:`, userId);
      
      let totalDeleted = 0;
      let totalErrors = 0;
      
      for (const postType of postTypes) {
        const result = await this.cleanupPostsByType(userId, postType);
        totalDeleted += result.deletedCount;
        totalErrors += result.errorCount;
      }
      
      console.log('\n🎉 Full Cleanup Complete!');
      console.log(`✅ Total deleted: ${totalDeleted} posts`);
      console.log(`❌ Total errors: ${totalErrors} posts`);
      
      return {
        success: true,
        deletedCount: totalDeleted,
        errorCount: totalErrors
      };
      
    } catch (error) {
      console.error('💥 Error during full cleanup:', error);
      return {
        success: false,
        error: error.message,
        deletedCount: 0,
        errorCount: 0
      };
    }
  }

  static async cleanupPostsByType(userId, postType) {
    const postsQuery = query(
      collection(db, 'posts'),
      where('type', '==', postType),
      where('userId', '==', userId)
    );
    
    const querySnapshot = await getDocs(postsQuery);
    console.log(`📊 Found ${querySnapshot.docs.length} ${postType} posts to delete`);
    
    let deletedCount = 0;
    let errorCount = 0;
    
    for (const docSnapshot of querySnapshot.docs) {
      try {
        const postId = docSnapshot.id;
        await deleteDoc(doc(db, 'posts', postId));
        deletedCount++;
        console.log(`✅ Deleted ${postType} post: ${postId}`);
      } catch (error) {
        console.error(`❌ Error deleting ${postType} post ${docSnapshot.id}:`, error.message);
        errorCount++;
      }
    }
    
    return { deletedCount, errorCount };
  }
}

export default CleanupService;