// diagnose-live-users.js - Check what's actually in Firestore users collection
const { db } = require('./src/config/firebase');

async function diagnose() {
  console.log('🔍 Checking users collection for live status...\n');
  
  try {
    const usersSnapshot = await db.collection('users').get();
    console.log(`Total users in collection: ${usersSnapshot.docs.length}\n`);
    
    const liveUsers = [];
    usersSnapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log(`User: ${doc.id}`);
      console.log(`  Status: ${data.status || 'undefined'}`);
      console.log(`  DisplayName: ${data.displayName || 'undefined'}`);
      console.log(`  CurrentStreamId: ${data.currentStreamId || 'undefined'}`);
      console.log(`  LastActive: ${data.lastActive ? new Date(data.lastActive.seconds * 1000).toISOString() : 'undefined'}`);
      console.log('');
      
      if (data.status === 'live') {
        liveUsers.push({
          id: doc.id,
          ...data
        });
      }
    });
    
    console.log(`\n📊 Users with status='live': ${liveUsers.length}`);
    if (liveUsers.length > 0) {
      console.log('Live users:', JSON.stringify(liveUsers, null, 2));
    }
    
    // Also check liveStreams collection
    console.log('\n🔍 Checking liveStreams collection...\n');
    const streamsSnapshot = await db.collection('liveStreams').where('status', '==', 'live').get();
    console.log(`Active streams: ${streamsSnapshot.docs.length}\n`);
    
    streamsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      console.log(`Stream: ${doc.id}`);
      console.log(`  UserId: ${data.userId}`);
      console.log(`  UserName: ${data.userName}`);
      console.log(`  Title: ${data.title}`);
      console.log(`  Status: ${data.status}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

diagnose();
