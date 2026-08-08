import * as FileSystem from 'expo-file-system/legacy';

// Compress earlier: phone camera MP4s are often 15–80MB; waiting until 6MB left
// most clips uncompressed and made For You cold-start / swipe hitchy.
const VIDEO_COMPRESS_THRESHOLD_BYTES = 2 * 1024 * 1024;
const TARGET_MAX_EDGE = 720;
// ~1.5 Mbps @ 720p keeps TikTok-like quality with smaller files / faster first byte.
const TARGET_BITRATE = 1_500_000;


/**
 * TikTok-ish client prep: shrink large videos before Firebase Storage upload.
 * Soft-fail: if compressor unavailable or errors, return the original URI.
 */
export async function prepareMediaForUpload(localUri, mediaType, { onProgress } = {}) {
  const kind = String(mediaType || '').toLowerCase();
  if (!localUri || typeof localUri !== 'string') return { uri: localUri, compressed: false };

  if (kind !== 'video' && !kind.includes('video')) {
    return { uri: localUri, compressed: false };
  }

  let size = null;
  try {
    const info = await FileSystem.getInfoAsync(localUri);
    size = info?.exists ? Number(info.size) || null : null;
  } catch {
    /* ignore */
  }

  if (size != null && size > 0 && size <= VIDEO_COMPRESS_THRESHOLD_BYTES) {
    console.log('[MEDIA_PREP] skip compress (already small)', { size });
    return { uri: localUri, compressed: false, originalBytes: size };
  }

  let VideoCompressor = null;
  try {
    // Optional native module — present after a rebuild with react-native-compressor.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const mod = require('react-native-compressor');
    VideoCompressor = mod?.Video || mod?.default?.Video || null;
  } catch (e) {
    console.warn('[MEDIA_PREP] compressor unavailable; uploading original', e?.message || e);
    return { uri: localUri, compressed: false, originalBytes: size, reason: 'module_missing' };
  }

  if (!VideoCompressor || typeof VideoCompressor.compress !== 'function') {
    return { uri: localUri, compressed: false, originalBytes: size, reason: 'api_missing' };
  }

  try {
    console.log('[MEDIA_PREP] compressing video', { size, maxSize: TARGET_MAX_EDGE, bitrate: TARGET_BITRATE });
    const outUri = await VideoCompressor.compress(
      localUri,
      {
        compressionMethod: 'manual',
        maxSize: TARGET_MAX_EDGE,
        bitrate: TARGET_BITRATE,
        minimumFileSizeForCompress: 0,
      },
      (progress) => {
        try {
          onProgress?.(Number(progress) || 0);
        } catch {
          /* ignore */
        }
      },
    );

    const nextUri = String(outUri || '').trim() || localUri;
    let nextSize = null;
    try {
      const info2 = await FileSystem.getInfoAsync(nextUri);
      nextSize = info2?.exists ? Number(info2.size) || null : null;
    } catch {
      /* ignore */
    }

    const improved =
      size == null ||
      nextSize == null ||
      nextSize < size;

    console.log('[MEDIA_PREP] compress done', {
      originalBytes: size,
      compressedBytes: nextSize,
      usedCompressed: improved && nextUri !== localUri,
    });

    if (!improved || nextUri === localUri) {
      return { uri: localUri, compressed: false, originalBytes: size, compressedBytes: nextSize };
    }

    return {
      uri: nextUri,
      compressed: true,
      originalBytes: size,
      compressedBytes: nextSize,
    };
  } catch (e) {
    console.warn('[MEDIA_PREP] compress failed; uploading original', e?.message || e);
    return { uri: localUri, compressed: false, originalBytes: size, reason: 'compress_failed' };
  }
}

export default { prepareMediaForUpload };
