/* Backfill a `date` on every post that's missing one.
 *
 * WHY: lists across the app sort by `date` (orderBy('date','desc')), and
 * Firestore silently OMITS documents that lack the field. Posts created without
 * a `date` (older/seeded/some imports) therefore never appear in those lists.
 * This sets date = createdAt || timestamp || uploadedAt || doc.createTime || now
 * so chronological ordering works everywhere.
 *
 * SAFE: only writes posts where `date` is missing; never overwrites an existing
 * date. Dry-run by default — pass `--apply` to actually write.
 *
 * Run:
 *   node scripts/backfill-post-dates.js            # dry run (counts only)
 *   node scripts/backfill-post-dates.js --apply    # write
 * Auth: GOOGLE_APPLICATION_CREDENTIALS=<sa.json> or `gcloud auth application-default login`.
 */
'use strict';
const admin = require('firebase-admin');

const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
const APPLY = process.argv.includes('--apply');
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function pickDate(data, createTime) {
  const cand = data.createdAt || data.timestamp || data.uploadedAt || data.publishedAt;
  if (cand) return cand; // Firestore Timestamp or epoch ms — both fine for orderBy
  if (createTime) return createTime; // doc metadata create time (Timestamp)
  return admin.firestore.FieldValue.serverTimestamp();
}

(async () => {
  console.log(`project ${PROJECT_ID} — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  const snap = await db.collection('posts').get();
  let missing = 0;
  let written = 0;
  let batch = db.batch();
  let inBatch = 0;

  for (const d of snap.docs) {
    const data = d.data() || {};
    if (data.date !== undefined && data.date !== null) continue;
    missing += 1;
    if (!APPLY) continue;
    batch.set(d.ref, { date: pickDate(data, d.createTime) }, { merge: true });
    inBatch += 1;
    written += 1;
    if (inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
      console.log(`  committed ${written}…`);
    }
  }
  if (APPLY && inBatch > 0) await batch.commit();

  console.log(`total posts: ${snap.size}`);
  console.log(`missing date: ${missing}`);
  console.log(APPLY ? `backfilled: ${written}` : 'dry run — re-run with --apply to write');
  process.exit(0);
})().catch((e) => { console.error('BACKFILL FAILED:', e.message); process.exit(1); });
