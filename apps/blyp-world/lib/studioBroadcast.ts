import { liveServiceUrl } from "./env";

export type BroadcastPhase =
  | "idle"
  | "preflight"
  | "provisioning"
  | "starting"
  | "live"
  | "stopped"
  | "failed";

export type BroadcastDestinationView = {
  destinationId: string;
  platform: string;
  profile: string;
  status: string;
  expiresAt: string | null;
  lastError: string | null;
  relayPath: string | null;
};

export type BroadcastSessionView = {
  sessionId: string;
  phase: BroadcastPhase;
  region: string;
  workerAssigned: boolean;
  provisioningEtaSeconds: number | null;
  message: string | null;
  errorDetail: string | null;
  destinations: BroadcastDestinationView[];
  updatedAt: string;
};

const RTMP_URL_RE =
  /^rtmps?:\/\/[a-zA-Z0-9._-]+(?::\d+)?(?:\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=-]*)?$/;

const STREAM_KEY_RE = /^[\x21-\x7E]{8,512}$/;

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export const YOUTUBE_DEFAULT_RTMP = "rtmp://a.rtmp.youtube.com/live2";
export const TWITCH_DEFAULT_RTMP = "rtmp://live.twitch.tv/app";
export const FACEBOOK_DEFAULT_RTMP = "rtmps://live-api-s.facebook.com:443/rtmp";
/** Official Kick help example; some accounts show a unique prefix — paste from dashboard if different. */
export const KICK_DEFAULT_RTMP =
  "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app";

export function validateTikTokRtmpCredentials(
  rtmpUrl: string,
  streamKey: string,
): { ok: true } | { ok: false; message: string } {
  const url = String(rtmpUrl || "").trim().replace(/\/+$/, "");
  const key = String(streamKey || "").trim();
  if (!url || !RTMP_URL_RE.test(url)) {
    return {
      ok: false,
      message: "Server URL must start with rtmp:// or rtmps://",
    };
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0"
    ) {
      return { ok: false, message: "Server URL cannot be localhost" };
    }
  } catch {
    return { ok: false, message: "Server URL must start with rtmp:// or rtmps://" };
  }
  if (!key || !STREAM_KEY_RE.test(key)) {
    return {
      ok: false,
      message: "Stream key must be 8–512 printable characters",
    };
  }
  return { ok: true };
}

export function tiktokExpiresAtIso(): string {
  return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
}

async function liveAuthFetch<T>(
  path: string,
  idToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${liveServiceUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(
      pickStr(payload.error, payload.detail, payload.message) ||
        `HTTP ${res.status}`,
    ) as Error & { code?: string };
    err.code = pickStr(payload.code);
    throw err;
  }
  return payload as T;
}

export type BroadcastPrepareDest = {
  platform: "tiktok" | "youtube" | "twitch" | "facebook" | "custom_rtmp";
  rtmpUrl: string;
  streamKey: string;
};

export function fanoutDestLabel(platform: BroadcastPrepareDest["platform"]): string {
  switch (platform) {
    case "tiktok":
      return "TikTok";
    case "youtube":
      return "YouTube";
    case "twitch":
      return "Twitch";
    case "facebook":
      return "Facebook";
    case "custom_rtmp":
      return "Kick";
    default:
      return platform;
  }
}

export async function prepareBroadcast(
  idToken: string,
  sessionId: string,
  destinations: BroadcastPrepareDest[],
): Promise<{ ok: true; view: BroadcastSessionView }> {
  return liveAuthFetch(`/api/live/${encodeURIComponent(sessionId)}/broadcast/prepare`, idToken, {
    method: "POST",
    body: JSON.stringify({
      destinations: destinations.map((d) => ({
        platform: d.platform,
        rtmpUrl: d.rtmpUrl.trim().replace(/\/+$/, ""),
        streamKey: d.streamKey.trim(),
        profile: d.platform === "tiktok" ? "portrait_crop" : "landscape_copy",
        expiresAt: d.platform === "tiktok" ? tiktokExpiresAtIso() : null,
      })),
    }),
  });
}

export async function startBroadcastFanout(
  idToken: string,
  sessionId: string,
): Promise<{ ok: true; view: BroadcastSessionView }> {
  return liveAuthFetch(`/api/live/${encodeURIComponent(sessionId)}/broadcast/start`, idToken, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function fetchBroadcastStatus(
  idToken: string,
  sessionId: string,
): Promise<{ ok: true; view: BroadcastSessionView }> {
  return liveAuthFetch(`/api/live/${encodeURIComponent(sessionId)}/broadcast/status`, idToken, {
    method: "GET",
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Program HLS may lag IVS composition — retry start until ready or timeout. */
export async function startBroadcastFanoutWhenReady(
  idToken: string,
  sessionId: string,
  opts?: { maxAttempts?: number; delayMs?: number },
): Promise<{ ok: true; view: BroadcastSessionView }> {
  const maxAttempts = opts?.maxAttempts ?? 30;
  const delayMs = opts?.delayMs ?? 2000;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await startBroadcastFanout(idToken, sessionId);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      const code = (lastErr as Error & { code?: string }).code;
      if (code === "HLS_NOT_READY" || /not ready/i.test(lastErr.message)) {
        await sleep(delayMs);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr || new Error("Broadcast start timed out waiting for program HLS");
}

export function tiktokDestinationStatus(
  view: BroadcastSessionView | null,
): BroadcastDestinationView | null {
  if (!view?.destinations?.length) return null;
  return view.destinations.find((d) => d.platform === "tiktok") || null;
}
