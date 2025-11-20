/**
 * Storage Security Rules Automated Tests (Task 20 partial)
 * NOTE: Firebase rules-unit-testing v3+ does not provide a rich Storage emulator assertion helper
 * akin to Firestore, so we use @firebase/rules-unit-testing with fetch to emulator REST endpoints.
 *
 * Run:
 *  1. Ensure storage emulator enabled in firebase.json and started:
 *     firebase emulators:start --only storage
 *  2. node scripts/test-storage-rules.js
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-blyp-livestream';
const STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || 'localhost:9199';

function storageUploadUrl(bucket, objectPath, token) {
  return `http://${STORAGE_EMULATOR_HOST}/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(objectPath)}${token ? `&uploadType=media&token=${token}` : '&uploadType=media'}`;
}

async function upload(bucket, objectPath, contentType, bytes, authToken) {
  const url = storageUploadUrl(bucket, objectPath, authToken);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: bytes
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

async function main() {
  const bucket = `${PROJECT_ID}.appspot.com`; // emulator auto-normalizes
  console.log('🗄  Testing storage rules against emulator bucket:', bucket);

  const validMp4 = Buffer.alloc(1024, 0); // 1KB placeholder

  async function expectAllow(promise, label) {
    const { status, body } = await promise;
    if (status < 300) console.log(`✅ ALLOW (${status}): ${label}`);
    else console.error(`❌ Expected ALLOW got ${status}: ${label}\n${body}`);
  }
  async function expectDeny(promise, label) {
    const { status, body } = await promise;
    if (status >= 400) console.log(`✅ DENY (${status}): ${label}`);
    else console.error(`❌ Expected DENY got ${status}: ${label}`);
  }

  // Adjust paths to match rules expectation
  const streamId = 'testStream1';
  const base = `streams/${streamId}/segments`;

  // 1. Valid segment upload (pretend authenticated) - emulator lacks full auth propagation; may need rule relaxed for emulator testing or token override.
  await expectAllow(upload(bucket, `${base}/seg0.mp4`, 'video/mp4', validMp4), 'Valid mp4 segment upload');

  // 2. Disallowed extension / MIME
  await expectDeny(upload(bucket, `${base}/bad.txt`, 'text/plain', Buffer.from('hi')), 'Disallowed mime/text upload');

  // 3. Oversized file simulation (if rule enforces size) - create > allowed size (e.g., >50MB). Here just placeholder; if rule uses size, adjust threshold.
  const bigBuffer = Buffer.alloc(60 * 1024 * 1024, 0); // 60MB
  await expectDeny(upload(bucket, `${base}/huge.mp4`, 'video/mp4', bigBuffer), 'Oversized mp4 segment');

  // 4. Path traversal attempt (if rule prohibits extra nesting)
  await expectDeny(upload(bucket, `streams/${streamId}/segments/nested/seg1.mp4`, 'video/mp4', validMp4), 'Nested path disallowed');

  console.log('\n--- COMPLETE (Storage)');
}

main().catch(e => { console.error(e); process.exit(1); });
