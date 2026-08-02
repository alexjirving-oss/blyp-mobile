/**
 * Storage security rules — fail-closed emulator tests.
 *
 * Prefer:
 *   firebase emulators:exec --only storage "npm run test:rules:storage"
 */

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { ref, uploadBytes, getBytes } = require('firebase/storage');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-blyp-rules';
const RULES_PATH = path.join(__dirname, '..', 'storage.rules');

(async () => {
  let failures = 0;
  const hostString = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
  const [emHost, emPortRaw] = hostString.split(':');
  const emPort = parseInt(emPortRaw, 10) || 9199;

  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: emHost,
      port: emPort,
    },
  });

  const ownerId = 'user_owner';
  const otherId = 'user_other';
  const ownerStorage = env.authenticatedContext(ownerId).storage();
  const otherStorage = env.authenticatedContext(otherId).storage();
  const anonStorage = env.unauthenticatedContext().storage();

  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

  async function expectAllow(promise, label) {
    try {
      await assertSucceeds(promise);
      console.log(`ALLOW: ${label}`);
    } catch (e) {
      failures += 1;
      console.error(`FAIL expected ALLOW: ${label}`, e?.message || e);
    }
  }

  async function expectDeny(promise, label) {
    try {
      await assertFails(promise);
      console.log(`DENY: ${label}`);
    } catch (e) {
      failures += 1;
      console.error(`FAIL expected DENY: ${label}`, e?.message || e);
    }
  }

  console.log(`Connected to Storage emulator ${emHost}:${emPort}`);

  await expectAllow(
    uploadBytes(ref(ownerStorage, `users/${ownerId}/avatar.png`), tinyPng, {
      contentType: 'image/png',
    }),
    'owner uploads own user media'
  );

  await expectDeny(
    uploadBytes(ref(ownerStorage, `users/${otherId}/avatar.png`), tinyPng, {
      contentType: 'image/png',
    }),
    'cannot upload into another user path'
  );

  await expectDeny(
    uploadBytes(ref(ownerStorage, `streams/s1/segments/seg0.mp4`), tinyPng, {
      contentType: 'video/mp4',
    }),
    'streams path writes denied (FFmpeg cost containment)'
  );

  await expectDeny(
    uploadBytes(ref(ownerStorage, `users/${ownerId}/notes.txt`), Buffer.from('hi'), {
      contentType: 'text/plain',
    }),
    'disallowed mime denied'
  );

  await expectDeny(
    uploadBytes(ref(anonStorage, `users/${ownerId}/anon.png`), tinyPng, {
      contentType: 'image/png',
    }),
    'anonymous upload denied'
  );

  // Seed then read as signed-in peer.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), `users/${ownerId}/peer.png`), tinyPng, {
      contentType: 'image/png',
    });
  });
  await expectAllow(
    getBytes(ref(otherStorage, `users/${ownerId}/peer.png`)),
    'signed-in peer can read user media'
  );
  await expectDeny(
    getBytes(ref(anonStorage, `users/${ownerId}/peer.png`)),
    'anon cannot read user media'
  );

  await env.cleanup();

  if (failures > 0) {
    console.error(`\nStorage rules tests FAILED (${failures} assertion(s))`);
    process.exit(1);
  }
  console.log('\nStorage rules tests PASSED');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
