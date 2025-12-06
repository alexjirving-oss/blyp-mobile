import * as FileSystem from 'expo-file-system/legacy';

const VIDEO_CACHE_DIR = `${FileSystem.cacheDirectory}videos/`;

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

/**
 * Returns a URI that expo-av can play.
 * - Prefers cached file
 * - Falls back to remote URI if anything fails
 */
export async function getPlayableVideoUri(remoteUri) {
  if (!remoteUri || typeof remoteUri !== 'string') {
    return null;
  }

  const cacheDir = await ensureVideoCacheDir();
  const safeName = encodeURIComponent(remoteUri);
  const targetPath = cacheDir ? `${cacheDir}${safeName}` : null;

  const shortUri = (uri) => {
    if (!uri) return uri;
    if (uri.length <= 80) return uri;
    return `${uri.slice(0, 60)}...${uri.slice(-8)}`;
  };

  try {
    if (!targetPath) {
      if (__DEV__) {
        console.warn('[VIDEO CACHE] no cache directory, using remote only', {
          uri: shortUri(remoteUri),
        });
      }
      return remoteUri;
    }

    const info = await FileSystem.getInfoAsync(targetPath);

    if (info.exists && info.isFile) {
      if (__DEV__) {
        console.log('[VIDEO CACHE] hit', { uri: shortUri(remoteUri) });
      }
      return info.uri;
    }

    const result = await FileSystem.downloadAsync(remoteUri, targetPath);

    if (__DEV__) {
      console.log('[VIDEO CACHE] downloaded', {
        from: shortUri(remoteUri),
        to: result.uri,
      });
    }

    return result.uri;
  } catch (error) {
    if (__DEV__) {
      console.warn('[VIDEO CACHE] download failed, falling back to remote', {
        uri: shortUri(remoteUri),
        error,
      });
    }
    return remoteUri;
  }
}
