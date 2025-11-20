// Test Firebase Storage bucket configuration and URL access
async function diagnoseBucketIssue() {
  console.log('🔍 Diagnosing Firebase Storage bucket configuration...\n');
  
  // Test URLs from your app logs
  const testUrls = [
    'https://firebasestorage.googleapis.com/v0/b/blyp-master.firebasestorage.app/o/users%2FJvX9baS41LOSFKj7kx9T99obgVy1%2Fmedia%2Fvideo-1759275915188.mp4?alt=media&token=7e58e868-8586-4f74-a542-176d430fb055',
    'https://firebasestorage.googleapis.com/v0/b/blyp-master.appspot.com/o/users%2FJvX9baS41LOSFKj7kx9T99obgVy1%2Fmedia%2Fvideo-1759275915188.mp4?alt=media&token=7e58e868-8586-4f74-a542-176d430fb055'
  ];
  
  for (let i = 0; i < testUrls.length; i++) {
    const url = testUrls[i];
    const bucketName = url.match(/\/b\/([^\/]+)\/o\//)[1];
    
    console.log(`\n📋 Test ${i + 1}: ${bucketName}`);
    console.log(`🔗 URL: ${url.substring(0, 100)}...`);
    
    try {
      const fetch = await import('node-fetch').then(m => m.default);
      const response = await fetch(url, { method: 'HEAD' });
      
      console.log(`✅ Status: ${response.status} ${response.statusText}`);
      
      if (response.status !== 200) {
        const fullResponse = await fetch(url);
        const errorText = await fullResponse.text();
        console.log(`❌ Error Response: ${errorText.substring(0, 500)}`);
      }
      
    } catch (error) {
      console.log(`❌ Network Error: ${error.message}`);
    }
  }
  
  console.log('\n🔧 Potential Solutions:');
  console.log('1. If .firebasestorage.app URLs work: Update Firebase config to use that domain');
  console.log('2. If .appspot.com URLs work: Update all stored URLs in Firestore to use .appspot.com');
  console.log('3. If both fail: Check Firebase Storage bucket permissions and setup');
}

diagnoseBucketIssue().catch(console.error);