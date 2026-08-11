/**
 * Back-compat shim — For You uses `src/feed/resolvePlayableUri`.
 */
export {
  resolvePlayableUri as resolveFeedPlayback,
  nextPlayableUri as nextFeedPlaybackUri,
} from '../feed/resolvePlayableUri';

import { resolvePlayableUri } from '../feed/resolvePlayableUri';

export function resolveFeedVideoUriFromPlayback(post) {
  const p = resolvePlayableUri(post);
  return p.fullUri || p.playUri || p.hlsUri || p.startUri;
}
