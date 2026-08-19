/**
 * RTMP credential validation — format only. Never probe with media (TikTok state desync).
 */

export type BroadcastPlatform =
  | 'youtube'
  | 'facebook'
  | 'twitch'
  | 'tiktok'
  | 'custom_rtmp';

export type BroadcastProfile = 'landscape_copy' | 'portrait_crop';

const RTMP_URL_RE =
  /^rtmps?:\/\/[a-zA-Z0-9._-]+(?::\d+)?(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]*)?$/;

const STREAM_KEY_RE = /^[\x21-\x7E]{8,512}$/;

export function normalizeRtmpUrl(raw: string): string {
  return String(raw || '').trim().replace(/\/+$/, '');
}

export function normalizeStreamKey(raw: string): string {
  return String(raw || '').trim();
}

export function isLoopbackRtmpUrl(rtmpUrl: string): boolean {
  const url = normalizeRtmpUrl(rtmpUrl);
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0'
    );
  } catch {
    return /^rtmps?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)/i.test(url);
  }
}

export function validateRtmpCredentials(rtmpUrl: string, streamKey: string): {
  ok: true;
  rtmpUrl: string;
  streamKey: string;
} | {
  ok: false;
  code: string;
  detail: string;
} {
  const url = normalizeRtmpUrl(rtmpUrl);
  const key = normalizeStreamKey(streamKey);
  if (!url || !RTMP_URL_RE.test(url)) {
    return { ok: false, code: 'INVALID_RTMP_URL', detail: 'Server URL must be rtmp:// or rtmps://' };
  }
  if (isLoopbackRtmpUrl(url)) {
    return { ok: false, code: 'INVALID_RTMP_URL', detail: 'Server URL cannot be localhost' };
  }
  if (!key || !STREAM_KEY_RE.test(key)) {
    return { ok: false, code: 'INVALID_STREAM_KEY', detail: 'Stream key must be 8–512 printable ASCII characters' };
  }
  return { ok: true, rtmpUrl: url, streamKey: key };
}

export function buildRtmpPublishUrl(rtmpUrl: string, streamKey: string): string {
  const base = normalizeRtmpUrl(rtmpUrl);
  const key = normalizeStreamKey(streamKey);
  if (base.includes('?')) {
    return `${base}&${key}`;
  }
  const sep = base.endsWith('/') ? '' : '/';
  return `${base}${sep}${key}`;
}

export function profileForPlatform(platform: BroadcastPlatform): BroadcastProfile {
  if (platform === 'tiktok') return 'portrait_crop';
  return 'landscape_copy';
}

export function platformRequiresSessionConnect(platform: BroadcastPlatform): boolean {
  return platform === 'tiktok';
}

/** Default provisioning wait when no warm worker is available. */
export const BROADCAST_PROVISIONING_ETA_SECONDS = 45;
