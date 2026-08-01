/**
 * Strict Firestore Security Rules tests.
 *
 * Server-managed economy collections are denied to all client SDK contexts.
 * Unrelated collections retain the temporary authenticated-only baseline until
 * their domain-specific ownership and field policies are delivered.
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
    console.log('PASS: authenticated user can create a legacy-baseline document');

    await assertSucceeds(getDoc(doc(viewerDb, 'posts', postId)));
    console.log('PASS: authenticated user can read an existing legacy-baseline document');

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

    const protectedEconomyPaths = [
      'wallets/user_owner',
      'gems/user_owner',
      'transactions/tx-1',
      'ledger_entries/ledger-1',
      'gift_catalog/gift-1',
      'gift_events/event-1',
      'iap_products/product-1',
    ];

    for (const protectedPath of protectedEconomyPaths) {
      const protectedRef = doc(ownerDb, protectedPath);
      await assertFails(getDoc(protectedRef));
      await assertFails(
        setDoc(protectedRef, {
          userId: ownerId,
          balance: 999999,
          createdAt: serverTimestamp(),
        })
      );
    }
    console.log('PASS: authenticated clients cannot read or write server-managed economy collections');

    console.warn(
      'NOTICE: unrelated Firestore domains remain on a legacy authenticated catch-all policy. ' +
        'Collection-specific ownership and field rules are still required before production release.'
    );
  } finally {
    await environment.cleanup();
  }
}

main().catch((error) => {
  console.error('Firestore rules tests failed:', error);
  process.exit(1);
});
