/*
 * READ-ONLY audit: simulate the deployed canTogglePostLike rule against the
 * exact write LikeService.setPostLiked would produce, for every post.
 * Reports how many posts would be REJECTED for a like or an unlike, and why.
 *
 * Run: node tools/seed/_audit_like_rule.js
 */
'use strict';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: process.env.PROJECT_ID || 'blyp-master' });
const db = admin.firestore();

// Firestore stores JS integral numbers as int64; doubles show up via
// admin SDK as non-integer or as Number with fractional part. We treat
// Number.isInteger as "is int" — flag separately if we can't tell.
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

function simulate(data, userId) {
  // ---- mirror of the deployed rule ----
  const beforeLikedBy = Array.isArray(data.likedBy) ? data.likedBy : [];
  const beforeLikes = isInt(data.likes) ? data.likes : 0;
  const beforeLikeCount = isInt(data.likeCount) ? data.likeCount : beforeLikes;
  const baseline = Math.max(beforeLikes, beforeLikeCount);
  const beforeLiked = beforeLikedBy.includes(userId);
  const delta = beforeLiked ? -1 : 1;

  // ---- mirror of LikeService.setPostLiked's write ----
  const cliLikes = isInt(data.likes) ? data.likes : 0;
  const cliLikeCount = isInt(data.likeCount) ? data.likeCount : cliLikes;
  const cliBaseline = Math.max(cliLikes, cliLikeCount, 0);
  const arr = beforeLikedBy.filter((x) => typeof x === 'string');
  const cliBeforeLiked = arr.includes(userId);
  const cliDelta = cliBeforeLiked ? -1 : 1;
  const nextCount = Math.max(0, cliBaseline + cliDelta);

  const reasons = [];
  if (!('userId' in data)) reasons.push('MISSING_userId_FIELD'); // rule errors -> deny
  if (nextCount !== baseline + delta) reasons.push(`COUNT_MISMATCH want=${baseline + delta} write=${nextCount}`);
  if (baseline + delta < 0) reasons.push('RULE_IMPOSSIBLE_NEGATIVE (unlike at baseline 0)');
  if ('likes' in data && !isInt(data.likes)) reasons.push(`likes_not_int (${typeof data.likes}:${data.likes})`);
  if ('likeCount' in data && !isInt(data.likeCount)) reasons.push(`likeCount_not_int (${typeof data.likeCount}:${data.likeCount})`);
  if ('likedBy' in data && !Array.isArray(data.likedBy)) reasons.push('likedBy_not_array');
  return { reasons, beforeLiked, baseline };
}

(async () => {
  const snap = await db.collection('posts').get();
  let total = 0;
  const likeFail = [];
  const unlikeFail = [];
  let missingUserId = 0;
  let nonIntCounters = 0;
  let drift = 0; // likes != likeCount

  for (const doc of snap.docs) {
    const d = doc.data() || {};
    total += 1;
    if (!('userId' in d)) missingUserId += 1;
    const likesIsInt = !('likes' in d) || isInt(d.likes);
    const lcIsInt = !('likeCount' in d) || isInt(d.likeCount);
    if (!likesIsInt || !lcIsInt) nonIntCounters += 1;
    const lv = isInt(d.likes) ? d.likes : null;
    const lcv = isInt(d.likeCount) ? d.likeCount : null;
    if (lv !== null && lcv !== null && lv !== lcv) drift += 1;

    // Simulate a brand-new user LIKING the post:
    const fresh = simulate(d, '__not_in_likedBy__');
    if (fresh.reasons.length) likeFail.push({ id: doc.id, reasons: fresh.reasons });

    // Simulate every existing liker UNLIKING:
    const likedBy = Array.isArray(d.likedBy) ? d.likedBy : [];
    if (likedBy.length > 0) {
      const sim = simulate(d, likedBy[0]);
      if (sim.reasons.length) unlikeFail.push({ id: doc.id, reasons: sim.reasons });
    }
  }

  console.log(`posts total: ${total}`);
  console.log(`missing userId field: ${missingUserId}`);
  console.log(`non-int counters: ${nonIntCounters}`);
  console.log(`likes != likeCount drift: ${drift}`);
  console.log(`\nLIKE would be REJECTED on ${likeFail.length} posts:`);
  likeFail.slice(0, 15).forEach((f) => console.log('  ', f.id, f.reasons.join(' | ')));
  console.log(`\nUNLIKE would be REJECTED on ${unlikeFail.length} posts (sampled first liker):`);
  unlikeFail.slice(0, 15).forEach((f) => console.log('  ', f.id, f.reasons.join(' | ')));
  process.exit(0);
})().catch((e) => { console.error('audit failed', e); process.exit(1); });
