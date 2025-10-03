const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, getDocs, deleteDoc, doc } = require('firebase/firestore');

// Firebase config - using the same config as your app
const firebaseConfig = {
  apiKey: "AIzaSyA4R_MFqBxRPfyaUM6z0jw6YXdJBWnWluY",
  authDomain: "blyp-master.firebaseapp.com",
  projectId: "blyp-master",
  storageBucket: "blyp-master.firebasestorage.app",
  messagingSenderId: "1026853029824",
  appId: "1:1026853029824:web:0e785a11caa04cac3b4f9c",
  measurementId: "G-PK4S8YKSTQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function cleanupGamePosts() {
  try {
    console.log('🧹 Starting cleanup of game posts...');
    
    // Query all posts where type equals 'game'
    const gamePostsQuery = query(
      collection(db, 'posts'),
      where('type', '==', 'game')
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
        
        console.log(`🗑️ Deleting game post: ${postId} - ${postData.content || 'No content'}`);
        
        await deleteDoc(doc(db, 'posts', postId));
        deletedCount++;
        
        console.log(`✅ Successfully deleted: ${postId}`);
        
        // Add a small delay to avoid overwhelming Firebase
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Error deleting post ${docSnapshot.id}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n📈 Cleanup Summary:');
    console.log(`✅ Successfully deleted: ${deletedCount} posts`);
    console.log(`❌ Failed to delete: ${errorCount} posts`);
    console.log(`📊 Total processed: ${querySnapshot.docs.length} posts`);
    
    if (deletedCount > 0) {
      console.log('\n🎉 Game posts cleanup completed successfully!');
    } else {
      console.log('\n⚠️ No game posts were deleted. Check Firebase permissions.');
    }
    
  } catch (error) {
    console.error('💥 Error during cleanup:', error);
  }
}

// Also cleanup posts that might have gameType field (alternative structure)
async function cleanupGameTypePosts() {
  try {
    console.log('\n🧹 Checking for posts with gameType field...');
    
    // Query all posts that have a gameType field
    const gameTypePostsQuery = query(
      collection(db, 'posts'),
      where('gameType', '!=', null)
    );
    
    const querySnapshot = await getDocs(gameTypePostsQuery);
    console.log(`📊 Found ${querySnapshot.docs.length} posts with gameType to delete`);
    
    let deletedCount = 0;
    let errorCount = 0;
    
    // Delete each post with gameType
    for (const docSnapshot of querySnapshot.docs) {
      try {
        const postId = docSnapshot.id;
        const postData = docSnapshot.data();
        
        console.log(`🗑️ Deleting gameType post: ${postId} - ${postData.gameType || 'Unknown game'}`);
        
        await deleteDoc(doc(db, 'posts', postId));
        deletedCount++;
        
        console.log(`✅ Successfully deleted: ${postId}`);
        
        // Add a small delay
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Error deleting post ${docSnapshot.id}:`, error.message);
        errorCount++;
      }
    }
    
    console.log('\n📈 GameType Cleanup Summary:');
    console.log(`✅ Successfully deleted: ${deletedCount} posts`);
    console.log(`❌ Failed to delete: ${errorCount} posts`);
    console.log(`📊 Total processed: ${querySnapshot.docs.length} posts`);
    
  } catch (error) {
    console.error('💥 Error during gameType cleanup:', error);
  }
}

// Run both cleanup functions
async function runFullCleanup() {
  console.log('🚀 Starting comprehensive game posts cleanup...\n');
  
  await cleanupGamePosts();
  await cleanupGameTypePosts();
  
  console.log('\n🏁 All cleanup operations completed!');
  process.exit(0);
}

// Execute the cleanup
runFullCleanup().catch(console.error);