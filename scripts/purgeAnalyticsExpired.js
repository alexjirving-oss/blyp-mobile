#!/usr/bin/env node
/**
 * purgeAnalyticsExpired.js
 * Batch deletes expired analytics events based on retention metadata.
 * Safe to run locally (requires FIREBASE env config) or port to Cloud Function.
 */

const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

async function run() {
  initializeApp({ credential: applicationDefault() });
  const firestore = getFirestore();
  const BATCH_LIMIT = 450; // keep <500 Firestore batch limit
  const now = Date.now();
  let totalDeleted = 0;

  while (true) {
    const snap = await firestore.collection('analytics')
      .where('retentionExpiresAt', '<=', now)
      .orderBy('retentionExpiresAt')
      .limit(BATCH_LIMIT)
      .get();
    if (snap.empty) break;
    const batch = firestore.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    totalDeleted += snap.size;
    if (snap.size < BATCH_LIMIT) break; // no more pages likely
  }

  console.log(JSON.stringify({ deleted: totalDeleted, timestamp: new Date().toISOString() }));
}

run().catch(e => {
  console.error('Purge failed', e);
  process.exit(1);
});
