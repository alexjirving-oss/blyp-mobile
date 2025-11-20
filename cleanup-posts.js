// Firebase Post Cleanup Script
// Deletes all posts except "Funny Dogs" from Firestore and Storage

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, deleteDoc, doc } = require('firebase/firestore');
const { getStorage, ref, deleteObject } = require('firebase/storage');

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAScxM-7tnuD0532VhY6bvaXvoWVEyDSF8",
  authDomain: "blyp-master.firebaseapp.com",
  projectId: "blyp-master",
  storageBucket: "blyp-master.appspot.com", 
  messagingSenderId: "929105034040",
  appId: "1:929105034040:web:3f725bb93e50e9d8bb9fcd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

async function deleteStorageFile(url) {
  if (!url) return;
  try {
    const fileRef = ref(storage, url);
    await deleteObject(fileRef);
    console.log('✅ Deleted storage file:', url.substring(0, 60) + '...');
  } catch (error) {
    console.log('⚠️  Storage file may not exist:', error.message);
  }
}

async function deletePostCompletely(post) {
  console.log(`🗑️  Deleting post: "${post.title}" (${post.id})`);
  
  // Delete storage files
  const deletePromises = [];
  
  // Delete video file
  if (post.videoUrl) {
    deletePromises.push(deleteStorageFile(post.videoUrl));
  }
  
  // Delete media files
  if (post.media && Array.isArray(post.media)) {
    post.media.forEach(mediaItem => {
      if (mediaItem.url) {
        deletePromises.push(deleteStorageFile(mediaItem.url));
      }
      if (mediaItem.thumbnail && mediaItem.thumbnail !== mediaItem.url) {
        deletePromises.push(deleteStorageFile(mediaItem.thumbnail));
      }
    });
  }
  
  // Delete separate thumbnail
  if (post.thumbnail && !post.media?.some(m => m.thumbnail === post.thumbnail)) {
    deletePromises.push(deleteStorageFile(post.thumbnail));
  }
  
  // Wait for all storage deletions
  await Promise.allSettled(deletePromises);
  
  // Delete Firestore document
  await deleteDoc(doc(db, 'posts', post.id));
  console.log('✅ Deleted Firestore document:', post.id);
}

async function cleanupPosts() {
  try {
    console.log('🚀 Starting Firebase cleanup...\n');
    
    // Get all posts
    const postsCollection = collection(db, 'posts');
    const snapshot = await getDocs(postsCollection);
    
    const allPosts = [];
    snapshot.forEach(doc => {
      allPosts.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    console.log(`📊 Found ${allPosts.length} total posts\n`);
    
    // Filter posts to delete (all except "Funny Dogs")
    const postsToDelete = allPosts.filter(post => {
      const title = post.title || '';
      const caption = post.caption || '';
      const description = post.description || '';
      
      // Keep posts that contain "Funny Dogs" in title, caption, or description
      const containsFunnyDogs = 
        title.toLowerCase().includes('funny dogs') ||
        caption.toLowerCase().includes('funny dogs') ||
        description.toLowerCase().includes('funny dogs');
      
      return !containsFunnyDogs;
    });
    
    const postsToKeep = allPosts.filter(post => {
      const title = post.title || '';
      const caption = post.caption || '';
      const description = post.description || '';
      
      const containsFunnyDogs = 
        title.toLowerCase().includes('funny dogs') ||
        caption.toLowerCase().includes('funny dogs') ||
        description.toLowerCase().includes('funny dogs');
      
      return containsFunnyDogs;
    });
    
    console.log(`🛡️  Posts to KEEP (${postsToKeep.length}):`);
    postsToKeep.forEach(post => {
      console.log(`   - "${post.title}" (${post.id})`);
    });
    
    console.log(`\n🗑️  Posts to DELETE (${postsToDelete.length}):`);
    postsToDelete.forEach(post => {
      console.log(`   - "${post.title}" (${post.id})`);
    });
    
    if (postsToDelete.length === 0) {
      console.log('\n✨ No posts to delete. All done!');
      return;
    }
    
    console.log(`\n⚠️  WARNING: About to delete ${postsToDelete.length} posts!`);
    console.log('This action cannot be undone. Press Ctrl+C to cancel...\n');
    
    // Wait 5 seconds for user to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🔥 Starting deletion process...\n');
    
    // Delete posts one by one
    for (let i = 0; i < postsToDelete.length; i++) {
      const post = postsToDelete[i];
      console.log(`[${i + 1}/${postsToDelete.length}] Deleting "${post.title}"...`);
      
      try {
        await deletePostCompletely(post);
        console.log('✅ Complete deletion successful\n');
      } catch (error) {
        console.error('❌ Error deleting post:', error.message);
        console.log('Continuing with next post...\n');
      }
    }
    
    console.log('🎉 Cleanup completed!');
    console.log(`📊 Final status:`);
    console.log(`   - Posts deleted: ${postsToDelete.length}`);
    console.log(`   - Posts kept: ${postsToKeep.length}`);
    
  } catch (error) {
    console.error('💥 Fatal error during cleanup:', error);
  }
}

// Run the cleanup
cleanupPosts()
  .then(() => {
    console.log('\n✨ Script finished. Exiting...');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });