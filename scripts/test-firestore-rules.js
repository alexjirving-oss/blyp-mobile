/**
 * Strict Firestore Security Rules tests.
 *
 * The current rules establish an authenticated-only baseline. Collection-level
 * ownership and field authorization remain an explicit production-release item.
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} = require('firebase/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-blyp-livestream';
const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');

async function main() {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, portValue] = emulatorHost.split(':');
  const port = Number.parseInt(portValue, 10) || 8080;
  const environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host,
      port,
    },
  });

  try {
    const ownerId = 'user_owner';
    const ownerDb = environment.authenticatedContext(ownerId).firestore();
    const viewerDb = environment.authenticatedContext('user_viewer').firestore();
    const anonymousDb = environment.unauthenticatedContext().firestore();
    const postId = 'rules-post-1';

    await assertSucceeds(
      setDoc(doc(ownerDb, 'posts', postId), {
        userId: ownerId,
        title: 'Rules test post',
        createdAt: serverTimestamp(),
      })
    );
    console.log('PASS: authenticated user can create a document');

    await assertSucceeds(getDoc(doc(viewerDb, 'posts', postId)));
    console.log('PASS: authenticated user can read an existing document');

    await assertFails(getDoc(doc(anonymousDb, 'posts', postId)));
    console.log('PASS: anonymous document reads are denied');

    await assertFails(
      setDoc(doc(anonymousDb, 'posts', 'anonymous-post'), {
        userId: 'anonymous',
        title: 'Rejected',
      })
    );
    console.log('PASS: anonymous document writes are denied');

    const commentCollection = collection(ownerDb, 'posts', postId, 'comments');
    const commentRef = await assertSucceeds(
      addDoc(commentCollection, {
        postId,
        userId: ownerId,
        username: 'Owner',
        text: 'Source-backed comment',
        parentId: null,
        createdAt: serverTimestamp(),
      })
    );
    console.log('PASS: authenticated source-backed comment write is allowed');

    await assertSucceeds(getDoc(doc(viewerDb, 'posts', postId, 'comments', commentRef.id)));
    console.log('PASS: authenticated source-backed comment read is allowed');

    await assertFails(
      addDoc(collection(anonymousDb, 'posts', postId, 'comments'), {
        postId,
        userId: 'anonymous',
        text: 'Rejected',
      })
    );
    await assertFails(
      getDoc(doc(anonymousDb, 'posts', postId, 'comments', commentRef.id))
    );
    console.log('PASS: anonymous comment reads and writes are denied');

    console.warn(
      'NOTICE: Firestore remains on a legacy authenticated catch-all policy. ' +
        'Collection-specific ownership and field rules are required before production release.'
    );
  } finally {
    await environment.cleanup();
  }
}

main().catch((error) => {
  console.error('Firestore rules tests failed:', error);
  process.exit(1);
});
