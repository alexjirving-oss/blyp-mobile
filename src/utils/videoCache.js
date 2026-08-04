import * as FileSystem from 'expo-file-system/legacy';

const VIDEO_CACHE_DIR = `${FileSystem.cacheDirectory}videos/`;

/** In-flight background downloads so we don't start duplicates. */
const inflightDownloads = new Map();

function cacheFileNameForUri(remoteUri) {
  // Full URLs must not be used as filenames — slashes/colons break Android paths.
  let hash = 0;
  for (let i = 0; i < remoteUri.length; i += 1) {
    hash = ((hash << 5) - hash + remoteUri.charCodeAt(i)) | 0;
  }
  const hex = Math.abs(hash).toString(16);
  const lower = remoteUri.toLowerCase();
  const ext = lower.includes('.mp4') ? '.mp4' : lower.includes('.webm') ? '.webm' : '.vid';
  return `v_${hex}${ext}`;
}

async function ensureVideoCacheDir() {
  if (!VIDEO_CACHE_DIR) return null;

  try {
    const info = await FileSystem.getInfoAsync(VIDEO_CACHE_DIR);

    if (!info.exists || !info.isDirectory) {
      await FileSystem.makeDirectoryAsync(VIDEO_CACHE_DIR, { intermediates: true });
    }

    return VIDEO_CACHE_DIR;
  } catch (error) {
    if (__DEV__) {
      console.warn('[VIDEO CACHE] failed to ensure directory, using remote only', {
        error: String(error).slice(0, 200),
      });
    }
    return null;
  }
}

function shortUri(uri) {
  if (!uri) return uri;
  if (uri.length <= 80) return uri;
  return `${uri.slice(0, 60)}...${uri.slice(-8)}`;
}

async function downloadToCache(remoteUri, targetPath) {
  if (inflightDownloads.has(remoteUri)) {
    return inflightDownloads.get(remoteUri);
  }
  const job = (async () => {
    try {
      const result = await FileSystem.downloadAsync(remoteUri, targetPath);
      if (__DEV__) {
        console.log('[VIDEO CACHE] downloaded', {
          from: shortUri(remoteUri),
          to: result.uri,
        });
      }
      return result.uri;
    } finally {
      inflightDownloads.delete(remoteUri);
    }
  })();
  inflightDownloads.set(remoteUri, job);
  return job;
}

/**
 * Returns a URI that expo-av can play WITHOUT waiting on a full-file download.
 * Cache hits return the local file; misses return the remote URL immediately and
 * warm the disk cache in the background (TikTok-style progressive play).
 *
 * @param {string} remoteUri
 * @param {{ waitForDownload?: boolean }} [opts] waitForDownload=true for prefetch
 */
export async function getPlayableVideoUri(remoteUri, opts = {}) {
  if (!remoteUri || typeof remoteUri !== 'string') {
    return null;
  }

  const waitForDownload = !!opts.waitForDownload;
  const cacheDir = await ensureVideoCacheDir();
  const safeName = cacheFileNameForUri(remoteUri);
  const targetPath = cacheDir ? `${cacheDir}${safeName}` : null;

  try {
    if (!targetPath) {
      return remoteUri;
    }

    const info = await FileSystem.getInfoAsync(targetPath);
    if (info.exists && info.isFile) {
      if (__DEV__) {
        console.log('[VIDEO CACHE] hit', { uri: shortUri(remoteUri) });
      }
      return info.uri;
    }

    if (waitForDownload) {
      try {
        return await downloadToCache(remoteUri, targetPath);
      } catch (error) {
        if (__DEV__) {
          console.warn('[VIDEO CACHE] prefetch download failed', {
            uri: shortUri(remoteUri),
            error: String(error).slice(0, 200),
          });
        }
        return remoteUri;
      }
    }

    // Stream-first: play remote now; fill cache for the next visit / neighbor.
    downloadToCache(remoteUri, targetPath).catch(() => {});
    return remoteUri;
  } catch (error) {
    if (__DEV__) {
      console.warn('[VIDEO CACHE] resolve failed, using remote', {
        uri: shortUri(remoteUri),
        error,
      });
    }
    return remoteUri;
  }
}

/** Prefetch next clips to disk so swipe-to-next is already warm. */
export function prefetchVideoToCache(remoteUri) {
  return getPlayableVideoUri(remoteUri, { waitForDownload: true });
}
