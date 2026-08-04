'use strict';

/**
 * Remove posts that should not appear on For You surfaces:
 * - zero likes
 * - not a video with sound (photos, audio-only, etc.)
 *
 * Dry run (default): node tools/admin/prune_for_you_posts.js
 * Execute deletes:    node tools/admin/prune_for_you_posts.js --execute
 */

const admin = require('firebase-admin');

function postLikeCount(post) {
  const fromLikedBy = Array.isArray(post?.likedBy) ? post.likedBy.length : 0;
  const likes = Number(post?.likes);
  const likeCount = Number(post?.likeCount);
  return Math.max(
    Number.isFinite(likes) ? Math.trunc(likes) : 0,
    Number.isFinite(likeCount) ? Math.trunc(likeCount) : 0,
    fromLikedBy,
  );
}

function isVideoWithSoundPost(post) {
  if (!post) return false;
  if (post.type === 'image' || post.type === 'photo' || post.type === 'audio') return false;
  if (post.imageUrl && !post.videoUrl) return false;
  const isVideo =
    post.type === 'video' ||
    (post.type && String(post.type).includes('video')) ||
    !!post.videoUrl;
  if (!isVideo) return false;
  if (post.hasAudio === false || post.muted === true || post.isMuted === true || post.silent === true) {
    return false;
  }
  return true;
}

function shouldPrune(post) {
  return !isVideoWithSoundPost(post) || postLikeCount(post) < 1;
}

async function main() {
  const execute = process.argv.includes('--execute');
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: process.env.PROJECT_ID || 'blyp-master' });
  }
  const db = admin.firestore();
  const snap = await db.collection('posts').get();
  const toDelete = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    if (shouldPrune(data)) toDelete.push({ id: doc.id, type: data.type, likes: postLikeCount(data) });
  }
  console.log(`posts scanned: ${snap.size}`);
  console.log(`posts to prune: ${toDelete.length}`);
  toDelete.slice(0, 20).forEach((p) => console.log(`  ${p.id} type=${p.type} likes=${p.likes}`));
  if (!execute) {
    console.log('\nDry run only. Re-run with --execute to delete.');
    return;
  }
  let deleted = 0;
  for (const row of toDelete) {
    await db.collection('posts').doc(row.id).delete();
    deleted += 1;
  }
  console.log(`deleted: ${deleted}`);
}

main().catch((e) => {
  console.error('prune failed', e?.message || e);
  process.exit(1);
});
