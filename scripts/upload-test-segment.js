#!/usr/bin/env node

/**
 * Upload a test video segment to Firebase Storage and create a matching liveStreams doc.
 *
 * Usage (PowerShell):
 *   node scripts/upload-test-segment.js "C:\\path\\to\\clip.mp4"
 *
 * Requirements:
 * - A valid Firebase config (uses blyp-master project config embedded below)
 * - Project root must have firebase Web SDK installed (already used by the app)
 * - Storage rules require authenticated user; this script signs in anonymously and
 *   uploads to streams/<uid>/<streamId>/segment_0.mp4 so rules pass.
 */

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, doc, setDoc, serverTimestamp } = require('firebase/firestore');
const { getStorage, ref, uploadBytes, getDownloadURL } = require('firebase/storage');

async function main() {
  const filePathArg = process.argv[2];
  if (!filePathArg) {
    console.error('\nUsage: node scripts/upload-test-segment.js "C:\\path\\to\\clip.mp4"');
    console.error('Tip: record a 1-3 second mp4 on your phone or PC and pass the path here.');
    process.exit(1);
  }
  const resolved = path.resolve(filePathArg);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }
  const contentType = 'video/mp4';
  const fileBuffer = fs.readFileSync(resolved);

  // Firebase project config (blyp-master)
  const firebaseConfig = {
    apiKey: 'AIzaSyAScxM-7tnuD0532VhY6bvaXvoWVEyDSF8',
    authDomain: 'blyp-master.firebaseapp.com',
    projectId: 'blyp-master',
    storageBucket: 'blyp-master.appspot.com',
    messagingSenderId: '929105034040',
    appId: '1:929105034040:web:3f725bb93e50e9d8bb9fcd',
  };

  console.log('Initializing Firebase...');
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);

  const email = process.env.BLYP_TEST_EMAIL;
  const password = process.env.BLYP_TEST_PASSWORD;
  let uid;
  if (email && password) {
    console.log('Signing in with email/password (env vars)...');
    const cred = await signInWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;
  } else {
    console.log('Signing in anonymously (enable Anonymous Auth to use this path)...');
    try {
      await signInAnonymously(auth);
      uid = auth.currentUser.uid;
    } catch (e) {
      console.error('Auth failed. Either set BLYP_TEST_EMAIL/BLYP_TEST_PASSWORD env vars or enable Anonymous Auth in Firebase Console.');
      throw e;
    }
  }
  console.log('Signed in as UID:', uid);

  const streamId = `test-${Date.now()}`;
  const segmentIndex = 0;
  const storagePath = `streams/${uid}/${streamId}/segment_${segmentIndex}.mp4`;
  console.log('Creating Firestore liveStreams doc:', streamId);
  await setDoc(doc(db, 'liveStreams', streamId), {
    userId: uid,
    status: 'live',
    title: 'Test Stream Upload',
    createdAt: serverTimestamp(),
    lastUpdated: serverTimestamp(),
    segments: {},
    viewCount: 0,
  }, { merge: true });

  console.log('Uploading test segment to:', storagePath);
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, fileBuffer, { contentType });
  const url = await getDownloadURL(storageRef);
  console.log('✅ Upload complete. Download URL:', url);

  console.log('\nNext:');
  console.log('- The processVideoSegment function should trigger automatically.');
  console.log('- Check Storage for transcoded outputs under:');
  console.log(`    streams/${uid}/${streamId}/qualities/...`);
  console.log('- Check playlists under:');
  console.log(`    streams/${uid}/${streamId}/playlists/`);
  console.log('- Check Firestore doc liveStreams/', streamId, 'for segment updates.');
}

main().catch((err) => {
  console.error('❌ Error:', err.message || err);
  process.exit(1);
});
