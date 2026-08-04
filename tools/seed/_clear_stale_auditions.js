/*
 * Delete non-completed auditions whose scheduledAt is NOT the correct 10pm UK
 * slot (the old timezone bug stored e.g. ~1am). This lets affected users
 * re-audition cleanly. Completed auditions (with results) are kept for the
 * leader dashboard.
 *
 * Prereq: ADC (`gcloud auth application-default login`) or GOOGLE_APPLICATION_CREDENTIALS.
 * Run: node tools/seed/_clear_stale_auditions.js
 */
'use strict';

const admin = require('firebase-admin');

const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const AUDITION_HOUR_UK = 22;

function lastSundayUtcDate(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0, 1, 0, 0, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}
function isUkSummer(atMs) {
  const y = new Date(atMs).getUTCFullYear();
  return atMs >= lastSundayUtcDate(y, 2) && atMs < lastSundayUtcDate(y, 9);
}
function ukWallToUtc(y, m, d, h) {
  const asIfUtc = Date.UTC(y, m, d, h, 0, 0, 0);
  return asIfUtc - (isUkSummer(asIfUtc) ? 3600000 : 0);
}
// Is `ms` exactly a 10pm-UK instant on its own UK calendar day?
function isTenPmUk(ms) {
  if (!ms) return false;
  const uk = new Date(ms + (isUkSummer(ms) ? 3600000 : 0));
  const expected = ukWallToUtc(uk.getUTCFullYear(), uk.getUTCMonth(), uk.getUTCDate(), AUDITION_HOUR_UK);
  return Math.abs(expected - ms) < 60 * 1000;
}

(async () => {
  const snap = await db.collection('auditions').get();
  let deleted = 0;
  let kept = 0;
  for (const doc of snap.docs) {
    const a = doc.data() || {};
    const status = a.status || '';
    const scheduledAt = Number(a.scheduledAt) || 0;
    const completed = status === 'completed';
    const goodSlot = isTenPmUk(scheduledAt);
    if (!completed && !goodSlot) {
      console.log(`[clear] deleting ${doc.id} status=${status} scheduledAt=${new Date(scheduledAt).toISOString()}`);
      // eslint-disable-next-line no-await-in-loop
      await doc.ref.delete();
      deleted += 1;
    } else {
      kept += 1;
    }
  }
  console.log(`[clear] done. deleted=${deleted} kept=${kept} total=${snap.size}`);
  process.exit(0);
})().catch((e) => {
  console.error('[clear] failed', e);
  process.exit(1);
});
