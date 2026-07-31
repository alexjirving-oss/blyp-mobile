/**
 * Strict Firebase Storage Security Rules tests.
 */
const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-blyp-livestream';
const RULES_PATH = path.join(__dirname, '..', 'storage.rules');

async function main() {
  const emulatorHost =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
  const [host, portValue] = emulatorHost.split(':');
  const port = Number.parseInt(portValue, 10) || 9199;
  const bucketUrl = `gs://${PROJECT_ID}.appspot.com`;

  const environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host,
      port,
    },
  });

  try {
    const ownerStorage = environment
      .authenticatedContext('user_owner')
      .storage(bucketUrl);
    const viewerStorage = environment
      .authenticatedContext('user_viewer')
      .storage(bucketUrl);
    const anonymousStorage = environment.unauthenticatedContext().storage(bucketUrl);
    const validPath = 'streams/rules-stream-1/segments/seg0.mp4';

    await assertSucceeds(
      ownerStorage.ref(validPath).put(Buffer.alloc(1024), {
        contentType: 'video/mp4',
      })
    );
    console.log('PASS: authenticated video upload within the size limit is allowed');

    await assertSucceeds(viewerStorage.ref(validPath).getMetadata());
    console.log('PASS: authenticated object reads are allowed');

    await assertFails(anonymousStorage.ref(validPath).getMetadata());
    console.log('PASS: anonymous object reads are denied');

    await assertFails(
      anonymousStorage.ref('streams/rules-stream-1/segments/anonymous.mp4').put(
        Buffer.alloc(16),
        { contentType: 'video/mp4' }
      )
    );
    console.log('PASS: anonymous object writes are denied');

    await assertFails(
      ownerStorage.ref('streams/rules-stream-1/segments/not-media.txt').put(
        Buffer.from('not media'),
        { contentType: 'text/plain' }
      )
    );
    console.log('PASS: unsupported MIME types are denied');

    await assertFails(
      ownerStorage.ref('streams/rules-stream-1/segments/at-limit.mp4').put(
        Buffer.alloc(25 * 1024 * 1024),
        { contentType: 'video/mp4' }
      )
    );
    console.log('PASS: objects at or above the 25 MiB limit are denied');
  } finally {
    await environment.cleanup();
  }
}

main().catch((error) => {
  console.error('Storage rules tests failed:', error);
  process.exit(1);
});
