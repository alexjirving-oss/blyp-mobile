// Shared feed playback URI helpers — progressive MP4 first; never full-download HLS.

import { fixStorageUrl } from './urlUtils';

/** True for HLS manifests / playlist URLs (not progressive MP4). */
export function isHlsVideoUri(uri) {
  if (!uri || typeof uri !== 'string') return false;
  const u = uri.trim().toLowerCase();
  if (!u) return false;
  if (u.includes('.m3u8')) return true;
  if (u.includes('application/vnd.apple.mpegurl')) return true;
  if (/\/hls\/|\/hls-|format=m3u8|type=m3u8/.test(u)) return true;
  return false;
}

/**
 * Prefer progressive / CDN / compressed MP4 for For You + MediaViewer.
 * HLS is last — full-file cache + expo-av progressive path expect a single media file.
 */
export function pickProgressiveFeedVideoUri(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  let hlsFallback = null;
  for (const c of list) {
    if (typeof c !== 'string') continue;
    const trimmed = c.trim();
    if (!trimmed) continue;
    const fixed = fixStorageUrl(trimmed) || trimmed;
    if (isHlsVideoUri(fixed)) {
      if (!hlsFallback) hlsFallback = fixed;
      continue;
    }
    return fixed;
  }
  return hlsFallback;
}
