/* Read-only diagnostic: how many posts exist, and how many are missing a usable
 * `date` field (which orderBy('date') would silently hide). Also breaks down by
 * the top authors so we can see if specific accounts are affected.
 *
 * Run: node scripts/diag-posts.js
 * Auth: GOOGLE_APPLICATION_CREDENTIALS=<sa.json> or `gcloud auth application-default login`.
 */
'use strict';
const admin = require('firebase-admin');

const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

(async () => {
  console.log('project', PROJECT_ID);
  const snap = await db.collection('posts').get();
  const total = snap.size;
  let missingDate = 0;
  let hasCreatedAt = 0;
  let hasTimestamp = 0;
  const byUserTotal = {};
  const byUserMissing = {};
  snap.forEach((d) => {
    const x = d.data() || {};
    const uid = x.userId || x.uid || '(none)';
    byUserTotal[uid] = (byUserTotal[uid] || 0) + 1;
    const hasDate = x.date !== undefined && x.date !== null;
    if (!hasDate) {
      missingDate += 1;
      byUserMissing[uid] = (byUserMissing[uid] || 0) + 1;
      if (x.createdAt) hasCreatedAt += 1;
      if (x.timestamp) hasTimestamp += 1;
    }
  });
  console.log('total posts:', total);
  console.log('missing `date`:', missingDate, `(${total ? Math.round((missingDate / total) * 100) : 0}%)`);
  console.log('  ...of those, have createdAt:', hasCreatedAt, ' have timestamp:', hasTimestamp);
  const top = Object.entries(byUserTotal).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('\ntop authors (total / missing-date):');
  top.forEach(([uid, n]) => console.log(`  ${uid}: ${n} / ${byUserMissing[uid] || 0}`));
  process.exit(0);
})().catch((e) => { console.error('DIAG FAILED:', e.message); process.exit(1); });
