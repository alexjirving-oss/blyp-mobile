import * as FileSystem from 'expo-file-system/legacy';

const VIDEO_CACHE_DIR = `${FileSystem.cacheDirectory}videos/`;
/** Reject tiny/corrupt cache files (failed or interrupted downloads). */
const MIN_CACHE_BYTES = 8 * 1024;

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

function isUsableCacheInfo(info) {
  if (!info?.exists || !info?.isFile) return false;
  const size = Number(info.size || 0);
  // size can be 0 on some platforms when unknown — only reject clearly tiny files.
  if (Number.isFinite(size) && size > 0 && size < MIN_CACHE_BYTES) return false;
  return true;
}

async function downloadToCache(remoteUri, targetPath) {
  if (inflightDownloads.has(remoteUri)) {
    return inflightDownloads.get(remoteUri);
  }
  const job = (async () => {
    try {
      // Avoid appending onto a corrupt partial from a previous failed download.
      try {
        const existing = await FileSystem.getInfoAsync(targetPath);
        if (existing.exists) {
          await FileSystem.deleteAsync(targetPath, { idempotent: true });
        }
      } catch {
        /* ignore */
      }
      const result = await FileSystem.downloadAsync(remoteUri, targetPath);
      const check = await FileSystem.getInfoAsync(result.uri || targetPath);
      if (!isUsableCacheInfo(check)) {
        try {
          await FileSystem.deleteAsync(targetPath, { idempotent: true });
        } catch {
          /* ignore */
        }
        throw new Error('Downloaded file too small / corrupt');
      }
      if (__DEV__) {
        console.log('[VIDEO CACHE] downloaded', {
          from: shortUri(remoteUri),
          to: result.uri,
          bytes: check.size,
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
 * Resolve a playable URI for expo-av.
 *
 * Many Blyp MP4s (phone camera uploads to Firebase Storage) have the moov atom
 * at the END of the file. Progressive HTTP streaming then fails silently —
 * poster shows, video never plays. So the reliable path is: play a complete
 * local file whenever possible.
 *
 * @param {string} remoteUri
 * @param {{ waitForDownload?: boolean }} [opts]
 *   waitForDownload=true (default for playback): block until cached locally
 *   waitForDownload=false: return remote immediately only for non-play probes
 */
export async function getPlayableVideoUri(remoteUri, opts = {}) {
  if (!remoteUri || typeof remoteUri !== 'string') {
    return null;
  }

  if (remoteUri.startsWith('file:') || remoteUri.startsWith('content:')) {
    return remoteUri;
  }

  // Default to download-for-play. Stream-first broke 1.0.9 for moov-at-end MP4s.
  const waitForDownload = opts.waitForDownload !== false;
  const cacheDir = await ensureVideoCacheDir();
  const safeName = cacheFileNameForUri(remoteUri);
  const targetPath = cacheDir ? `${cacheDir}${safeName}` : null;

  try {
    if (!targetPath) {
      return remoteUri;
    }

    const info = await FileSystem.getInfoAsync(targetPath);
    if (isUsableCacheInfo(info)) {
      if (__DEV__) {
        console.log('[VIDEO CACHE] hit', { uri: shortUri(remoteUri), bytes: info.size });
      }
      return info.uri;
    }

    // Stale tiny/corrupt file — wipe before re-download.
    if (info.exists) {
      try {
        await FileSystem.deleteAsync(targetPath, { idempotent: true });
      } catch {
        /* ignore */
      }
    }

    if (waitForDownload) {
      try {
        return await downloadToCache(remoteUri, targetPath);
      } catch (error) {
        if (__DEV__) {
          console.warn('[VIDEO CACHE] download failed, falling back to remote', {
            uri: shortUri(remoteUri),
            error: String(error).slice(0, 200),
          });
        }
        return remoteUri;
      }
    }

    // Non-blocking probe: return cache hit or remote. Callers that want a warm
    // disk copy should use prefetchVideoToCache / waitForDownload:true.
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

/** Drop a bad cache entry after a playback error so the next attempt re-downloads. */
export async function invalidateCachedVideo(remoteUri) {
  if (!remoteUri || typeof remoteUri !== 'string') return;
  if (remoteUri.startsWith('file:') || remoteUri.startsWith('content:')) {
    try {
      await FileSystem.deleteAsync(remoteUri, { idempotent: true });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const cacheDir = await ensureVideoCacheDir();
    if (!cacheDir) return;
    const targetPath = `${cacheDir}${cacheFileNameForUri(remoteUri)}`;
    await FileSystem.deleteAsync(targetPath, { idempotent: true });
  } catch {
    /* ignore */
  }
}
