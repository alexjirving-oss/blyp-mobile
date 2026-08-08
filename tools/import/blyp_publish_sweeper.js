#!/usr/bin/env node
/**
 * Standalone scheduled-publish sweeper (Admin SDK).
 *
 * Use when Cloud Functions aren't deployed yet, or run alongside the import
 * worker on the same host:
 *
 *   node tools/import/blyp_publish_sweeper.js
 *   ONCE=1 node tools/import/blyp_publish_sweeper.js
 *
 * Env: PROJECT_ID, POLL_MS (default 60000), BATCH (default 80), ONCE=1
 */
'use strict';

const admin = require('firebase-admin');

const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
const POLL_MS = Number(process.env.POLL_MS || 60 * 1000);
const BATCH = Number(process.env.BATCH || 80);
const ONCE = process.env.ONCE === '1';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}
const db = admin.firestore();
const log = (...a) => console.log('[publish-sweeper]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sweepOnce() {
  const now = Date.now();
  let docs = [];
  try {
    const snap = await db
      .collection('posts')
      .where('publishStatus', '==', 'scheduled')
      .where('publishAt', '<=', now)
      .orderBy('publishAt', 'asc')
      .limit(BATCH)
      .get();
    docs = snap.docs;
  } catch (e) {
    log('indexed query failed, fallback:', e.message);
    const loose = await db.collection('posts').where('publishStatus', '==', 'scheduled').limit(250).get();
    docs = loose.docs
      .filter((d) => Number((d.data() || {}).publishAt || 0) <= now)
      .sort((a, b) => Number((a.data() || {}).publishAt || 0) - Number((b.data() || {}).publishAt || 0))
      .slice(0, BATCH);
  }

  if (!docs.length) {
    log('nothing due');
    return 0;
  }

  let n = 0;
  for (const doc of docs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        if (!fresh.exists) return;
        const data = fresh.data() || {};
        if (data.publishStatus !== 'scheduled') return;
        if (Number(data.publishAt || 0) > now) return;
        tx.update(doc.ref, {
          publishStatus: 'live',
          publishedAt: now,
          updatedAt: now,
        });
      });
      n += 1;
    } catch (e) {
      log('fail', doc.id, e.message);
    }
  }
  log(`published ${n}/${docs.length}`);
  return n;
}

async function main() {
  log(`started project=${PROJECT_ID} poll=${POLL_MS}ms once=${ONCE}`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await sweepOnce();
    } catch (e) {
      log('sweep error', e.message);
    }
    if (ONCE) break;
    await sleep(POLL_MS);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[publish-sweeper] FATAL', e);
  process.exit(1);
});
