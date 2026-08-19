import { liveServiceUrl } from "./env";

export type TikTokRoomEvent = {
  id: string;
  kind: "chat" | "gift";
  uniqueId: string;
  displayName: string;
  text: string;
  createdAt: number;
};

export type TikTokRoomStatus = {
  sessionId: string;
  uniqueId: string | null;
  phase: "idle" | "connecting" | "live" | "waiting" | "failed" | "stopped";
  message: string | null;
  lastEventAt: number | null;
  configured: boolean;
};

export function normalizeTikTokUniqueId(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .trim();
}

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
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

export async function startTikTokRoom(
  idToken: string,
  sessionId: string,
  uniqueId: string,
): Promise<{ ok: true; status: TikTokRoomStatus }> {
  return liveAuthFetch(
    `/api/live/${encodeURIComponent(sessionId)}/tiktok-room/start`,
    idToken,
    {
      method: "POST",
      body: JSON.stringify({ uniqueId: normalizeTikTokUniqueId(uniqueId) }),
    },
  );
}

export async function stopTikTokRoom(
  idToken: string,
  sessionId: string,
): Promise<{ ok: true; status: TikTokRoomStatus }> {
  return liveAuthFetch(
    `/api/live/${encodeURIComponent(sessionId)}/tiktok-room/stop`,
    idToken,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function fetchTikTokRoomEvents(
  idToken: string,
  sessionId: string,
): Promise<{ ok: true; status: TikTokRoomStatus; events: TikTokRoomEvent[] }> {
  return liveAuthFetch(
    `/api/live/${encodeURIComponent(sessionId)}/tiktok-room/events`,
    idToken,
    { method: "GET" },
  );
}
