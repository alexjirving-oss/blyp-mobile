// Check Firebase Posts Status
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

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

async function checkCurrentPosts() {
  try {
    console.log('🔍 Checking current Firebase posts...\n');
    
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
    
    console.log(`📊 Total posts found: ${allPosts.length}\n`);
    
    if (allPosts.length === 0) {
      console.log('✨ No posts found in Firebase!');
      return;
    }
    
    console.log('📝 Current posts:');
    allPosts.forEach((post, index) => {
      console.log(`${index + 1}. "${post.title || post.caption || 'Untitled'}" (ID: ${post.id})`);
      console.log(`   Type: ${post.type || 'unknown'}`);
      console.log(`   User: ${post.user?.username || post.username || 'unknown'}`);
      console.log(`   Date: ${post.date?.toDate?.() || 'unknown'}`);
      console.log('');
    });
    
    // Check specifically for "Funny Dogs"
    const funnyDogsPosts = allPosts.filter(post => {
      const title = post.title || '';
      const caption = post.caption || '';
      const description = post.description || '';
      
      return title.toLowerCase().includes('funny dogs') ||
             caption.toLowerCase().includes('funny dogs') ||
             description.toLowerCase().includes('funny dogs');
    });
    
    const otherPosts = allPosts.filter(post => {
      const title = post.title || '';
      const caption = post.caption || '';
      const description = post.description || '';
      
      return !(title.toLowerCase().includes('funny dogs') ||
               caption.toLowerCase().includes('funny dogs') ||
               description.toLowerCase().includes('funny dogs'));
    });
    
    console.log(`🛡️  "Funny Dogs" posts: ${funnyDogsPosts.length}`);
    funnyDogsPosts.forEach(post => {
      console.log(`   - "${post.title}" (${post.id})`);
    });
    
    console.log(`\n🗑️  Other posts that should be deleted: ${otherPosts.length}`);
    otherPosts.forEach(post => {
      console.log(`   - "${post.title}" (${post.id})`);
    });
    
  } catch (error) {
    console.error('💥 Error checking posts:', error);
  }
}

checkCurrentPosts()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Check failed:', error);
    process.exit(1);
  });