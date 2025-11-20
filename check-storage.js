const admin = require('firebase-admin');
const serviceAccount = require('./blyp-master-firebase-adminsdk-service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'blyp-master.appspot.com'
});

const bucket = admin.storage().bucket();

async function checkStorage() {
  console.log('🔍 Checking Firebase Storage contents...\n');
  
  try {
    const [files] = await bucket.getFiles({ prefix: 'users/' });
    
    console.log(`📁 Found ${files.length} files in storage:`);
    
    if (files.length === 0) {
      console.log('❌ NO FILES FOUND - Storage is empty!');
      return;
    }
    
    files.forEach((file, index) => {
      console.log(`${index + 1}. ${file.name}`);
      if (index < 10) { // Show first 10 files
        console.log(`   Size: ${file.metadata.size} bytes`);
        console.log(`   Created: ${file.metadata.timeCreated}`);
      }
    });
    
    if (files.length > 10) {
      console.log(`   ... and ${files.length - 10} more files`);
    }
    
  } catch (error) {
    console.error('❌ Error checking storage:', error.message);
  }
}

checkStorage().then(() => {
  console.log('\n✅ Storage check complete');
  process.exit(0);
}).catch(console.error);