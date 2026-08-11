/**
 * Progressive-first playable URI ladder for For You.
 * HARD RULE: never prefer dead startUrl / ABR rung over working videoUrl.
 */
import { fixStorageUrl } from '../utils/urlUtils';
import { isHlsVideoUri, pickProgressiveFeedVideoUri } from '../utils/feedVideoUri';

function pickFirst(candidates) {
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    const t = c.trim();
    if (!t) continue;
    return fixStorageUrl(t) || t;
  }
  return null;
}

function mediaVideo(post) {
  const media = Array.isArray(post?.media) ? post.media : [];
  return media.find((m) => String(m?.type || '').includes('video')) || media[0] || null;
}

/**
 * @returns {{
 *   playUri: string|null,
 *   fullUri: string|null,
 *   hlsUri: string|null,
 *   startUri: string|null,
 *   ladder: string[],
 *   strategy: 'progressive'|'hls'|'start_mp4'|'none'
 * }}
 */
export function resolvePlayableUri(post) {
  if (!post) {
    return {
      playUri: null,
      fullUri: null,
      hlsUri: null,
      startUri: null,
      ladder: [],
      strategy: 'none',
    };
  }
  const v = mediaVideo(post);

  const fullUri = pickProgressiveFeedVideoUri([
    post.faststartUrl,
    post.compressedUrl,
    post.optimizedUrl,
    post.cdnUrl,
    post.playbackUrl,
    post.videoUrl,
    post.mediaUrl,
    post.streamUrl,
    v?.faststartUrl,
    v?.compressedUrl,
    v?.optimizedUrl,
    v?.cdnUrl,
    v?.playbackUrl,
    v?.url,
  ]);

  const hlsUri = pickFirst([
    post.hlsUrl,
    post.hlsMasterUrl,
    post.abr?.hlsUrl,
    post.playback?.hlsUrl,
    v?.hlsUrl,
    v?.hlsMasterUrl,
  ]);

  const startUri = pickFirst([
    post.startUrl,
    post.startMp4Url,
    post.abr?.startUrl,
    post.abr?.rungs?.[0]?.url,
    post.playback?.startUrl,
    post.variants?.start,
    post.variants?.['360'],
    post.variants?.['540'],
    v?.startUrl,
    v?.abr?.startUrl,
  ]);

  const ladder = [];
  const pushUnique = (uri) => {
    if (!uri || ladder.includes(uri)) return;
    ladder.push(uri);
  };

  pushUnique(fullUri && !isHlsVideoUri(fullUri) ? fullUri : null);
  if (!fullUri || isHlsVideoUri(fullUri)) {
    pushUnique(hlsUri);
  } else if (hlsUri) {
    pushUnique(hlsUri);
  }
  if (startUri && startUri !== fullUri && startUri !== hlsUri) {
    pushUnique(startUri);
  }

  const playUri = ladder[0] || null;
  let strategy = 'none';
  if (playUri && fullUri && playUri === fullUri && !isHlsVideoUri(fullUri)) {
    strategy = 'progressive';
  } else if (playUri && hlsUri && playUri === hlsUri) {
    strategy = 'hls';
  } else if (playUri && startUri && playUri === startUri) {
    strategy = 'start_mp4';
  } else if (playUri) {
    strategy = fullUri ? 'progressive' : 'hls';
  }

  return {
    playUri,
    fullUri: fullUri && !isHlsVideoUri(fullUri) ? fullUri : null,
    hlsUri,
    startUri: startUri || (fullUri && !isHlsVideoUri(fullUri) ? fullUri : null),
    ladder,
    strategy,
  };
}

/** Next URI after a hard failure. */
export function nextPlayableUri(ladder, failedUri) {
  const list = Array.isArray(ladder) ? ladder.filter((u) => typeof u === 'string' && u.trim()) : [];
  if (!list.length) return null;
  if (!failedUri) return list[0];
  const idx = list.findIndex((u) => u === failedUri);
  if (idx < 0) return list[0];
  return list[idx + 1] || null;
}
