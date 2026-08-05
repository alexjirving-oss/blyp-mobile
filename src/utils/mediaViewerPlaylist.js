export function isVideoPost(p) {
  return !!(
    p &&
    (p.type === 'video' ||
      !!p.videoUrl ||
      String(p?.media?.[0]?.type || '').includes('video') ||
      String(p?.mediaUrl || '').match(/\.(mp4|webm|mov)(\?|$)/i))
  );
}

/**
 * Build an ordered video playlist from a source list, preserving list order.
 * Returns { posts, initialIndex } so the viewer can open at the tapped item
 * and swipe next/prev through the same sequence (e.g. profile grid order).
 */
export function buildVideoPlaylist(post, allPosts) {
  const vids = (allPosts || []).filter((p) => p && isVideoPost(p));
  if (!isVideoPost(post)) return { posts: [], initialIndex: 0 };

  const idx = vids.findIndex((p) => p && p.id === post.id);
  if (idx >= 0) {
    // Prefer the instance from the source list (same object/order as the grid).
    return { posts: vids, initialIndex: idx };
  }
  // Opened post not in the list — keep it at the start, then the rest.
  return { posts: [post, ...vids], initialIndex: 0 };
}

export function mediaViewerParams(post, allPosts, extra = {}) {
  const { posts: playlist, initialIndex } = buildVideoPlaylist(post, allPosts);
  if (playlist.length > 1) {
    return { ...extra, post, posts: playlist, initialIndex };
  }
  return { ...extra, post, initialIndex: 0 };
}
