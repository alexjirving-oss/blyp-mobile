export function isVideoPost(p) {
  return !!(
    p &&
    (p.type === 'video' ||
      !!p.videoUrl ||
      String(p?.media?.[0]?.type || '').includes('video') ||
      String(p?.mediaUrl || '').match(/\.(mp4|webm|mov)(\?|$)/i))
  );
}

export function buildVideoPlaylist(post, allPosts) {
  const vids = (allPosts || []).filter((p) => p && isVideoPost(p));
  if (!isVideoPost(post)) return [];
  return [post, ...vids.filter((p) => p && p.id !== post.id)];
}

export function mediaViewerParams(post, allPosts, extra = {}) {
  const playlist = buildVideoPlaylist(post, allPosts);
  if (playlist.length > 1) return { post, posts: playlist, ...extra };
  return { post, ...extra };
}
