// cleanup-live-statuses.js - Reset all users to offline
const { db } = require('./src/config/firebase');

async function cleanup() {
  console.log('🧹 Cleaning up live statuses in users collection...\n');
  
  try {
    const usersSnapshot = await db.collection('users').get();
    console.log(`Found ${usersSnapshot.docs.length} users\n`);
    
    const batch = db.batch();
    let count = 0;
    
    usersSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.status === 'live' || data.currentStreamId) {
        console.log(`Resetting user: ${doc.id} (was ${data.status})`);
        batch.update(doc.ref, {
          status: 'offline',
          currentStreamId: null
        });
        count++;
      }
    });
    
    if (count > 0) {
      await batch.commit();
      console.log(`\n✅ Reset ${count} users to offline`);
    } else {
      console.log('\n✅ No users needed cleanup');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
  
  process.exit(0);
}

cleanup();
