import { fixStorageUrl } from './urlUtils';

export function postLikeCount(post) {
  const fromLikedBy = Array.isArray(post?.likedBy) ? post.likedBy.length : 0;
  const likes = Number(post?.likes);
  const likeCount = Number(post?.likeCount);
  return Math.max(
    Number.isFinite(likes) ? Math.trunc(likes) : 0,
    Number.isFinite(likeCount) ? Math.trunc(likeCount) : 0,
    fromLikedBy,
  );
}

export function isVideoWithSoundPost(post) {
  if (!post) return false;
  if (post.type === 'image' || post.type === 'photo' || post.type === 'audio') return false;
  if (post.imageUrl && !post.videoUrl) return false;

  const isVideo =
    post.type === 'video' ||
    (post.type && String(post.type).includes('video')) ||
    !!post.videoUrl ||
    !!post?.media?.[0]?.type?.includes?.('video');

  if (!isVideo) return false;

  const uri = fixStorageUrl(post.videoUrl || post.mediaUrl || post?.media?.[0]?.url);
  if (typeof uri !== 'string' || !uri.trim()) return false;

  if (post.hasAudio === false || post.muted === true || post.isMuted === true || post.silent === true) {
    return false;
  }

  return true;
}

/** For You surfaces: playable videos with sound. Likes boost ranking, not eligibility. */
export function isForYouFeedPost(post) {
  return isVideoWithSoundPost(post);
}

export function filterForYouPosts(posts) {
  return (posts || []).filter(isForYouFeedPost);
}
