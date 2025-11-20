/**
 * Firestore Security Rules Automated Tests (Task 21)
 *
 * Uses @firebase/rules-unit-testing to assert allow/deny behavior for liveStreams feature.
 * Run against emulator:
 *   1. Install dev deps: npm i -D @firebase/rules-unit-testing firebase
 *   2. Start emulator (if not auto): firebase emulators:start --only firestore
 *   3. node scripts/test-firestore-rules.js
 */

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, collection, addDoc, serverTimestamp } = require('firebase/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-blyp-livestream';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

function nowTs() { return new Date(); }

(async () => {
  console.log('🔥 Initializing Firestore test environment...');
  // Derive emulator host/port (supports FIRESTORE_EMULATOR_HOST="host:port") or defaults.
  const emulatorHostString = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [emHost, emPortRaw] = emulatorHostString.split(':');
  const emPort = parseInt(emPortRaw, 10) || 8080;

  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: emHost,
      port: emPort
    }
  });
  console.log(`✅ Connected to Firestore emulator at ${emHost}:${emPort}`);

  const ownerId = 'user_owner';
  const viewerId = 'user_viewer';

  const ownerCtx = env.authenticatedContext(ownerId);
  const viewerCtx = env.authenticatedContext(viewerId);
  const anonCtx = env.unauthenticatedContext();

  const ownerDb = ownerCtx.firestore();
  const viewerDb = viewerCtx.firestore();
  const anonDb = anonCtx.firestore();

  async function shouldAllow(promise, label) {
    try { await assertSucceeds(promise); console.log(`✅ ALLOW: ${label}`); }
    catch (e) { console.error(`❌ Expected ALLOW but got DENY: ${label}`, e); }
  }
  async function shouldDeny(promise, label) {
    try { await assertFails(promise); console.log(`✅ DENY: ${label}`); }
    catch { console.error(`❌ Expected DENY but got ALLOW: ${label}`); }
  }

  // Collection references
  const streamId = 'testStream1';
  const streamRefOwner = doc(ownerDb, 'liveStreams', streamId);

  console.log('\n--- Phase 1: Create Stream Rules ---');
  // 1. Owner can create valid stream
  await shouldAllow(setDoc(streamRefOwner, {
    ownerId,
    status: 'active',
    type: 'public',
    createdAt: serverTimestamp(),
    startedAt: serverTimestamp()
  }), 'Owner creates stream');

  // 2. Viewer cannot create a stream for another ownerId
  await shouldDeny(setDoc(doc(viewerDb, 'liveStreams', 'streamForOwner'), {
    ownerId,
    status: 'active',
    type: 'public',
    createdAt: serverTimestamp()
  }), 'Viewer creating stream for different ownerId');

  // 3. Anonymous cannot create stream
  await shouldDeny(setDoc(doc(anonDb, 'liveStreams', 'anonStream'), {
    ownerId: 'anon', status: 'active'
  }), 'Anonymous create stream');

  console.log('\n--- Phase 2: Field Validation ---');
  // 4. Owner cannot add unexpected field
  await shouldDeny(setDoc(doc(ownerDb, 'liveStreams', 'badFields'), {
    ownerId,
    status: 'active',
    type: 'public',
    createdAt: serverTimestamp(),
    junk: true
  }), 'Owner create with extra junk field');

  // 5. Owner cannot mutate immutable ownerId
  await shouldDeny(updateDoc(streamRefOwner, { ownerId: 'hijack' }), 'Mutate ownerId');

  // 6. Owner allowed to update status to ended
  await shouldAllow(updateDoc(streamRefOwner, { status: 'ended', endedAt: serverTimestamp() }), 'Owner ends stream');

  console.log('\n--- Phase 3: Subcollections ---');
  const segmentsColl = collection(ownerDb, 'liveStreams', streamId, 'segments');
  const likesColl = collection(ownerDb, 'liveStreams', streamId, 'likes');

  // 7. Owner creates segment metadata
  await shouldAllow(addDoc(segmentsColl, {
    ts: serverTimestamp(),
    order: 0,
    path: `streams/${streamId}/segments/seg0.mp4`,
    size: 123456
  }), 'Owner adds segment doc');

  // 8. Viewer cannot add segment
  await shouldDeny(addDoc(collection(viewerDb, 'liveStreams', streamId, 'segments'), {
    ts: serverTimestamp(),
    order: 1,
    path: `streams/${streamId}/segments/seg1.mp4`,
    size: 234567
  }), 'Viewer adds segment doc');

  // 9. Viewer can like (assuming rule allows) – adjust expectation if policy differs
  await shouldAllow(addDoc(likesColl, { userId: viewerId, createdAt: serverTimestamp() }), 'Viewer likes stream');

  // 10. Anonymous cannot like
  await shouldDeny(addDoc(collection(anonDb, 'liveStreams', streamId, 'likes'), { userId: 'anon', createdAt: serverTimestamp() }), 'Anonymous like');

  console.log('\n--- Phase 4: Reads ---');
  // 11. Viewer can read liveStreams doc (public)
  await shouldAllow(getDoc(doc(viewerDb, 'liveStreams', streamId)), 'Viewer reads stream doc');

  // 12. Anonymous read permitted? Adjust depending on policy (set expected) - assume allowed
  await shouldAllow(getDoc(doc(anonDb, 'liveStreams', streamId)), 'Anonymous reads stream doc (public)');

  console.log('\n--- COMPLETE');
  await env.cleanup();
  console.log('🧹 Environment cleaned up.');
})();
