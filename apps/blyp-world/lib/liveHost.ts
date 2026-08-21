import { liveServiceUrl, siteUrl } from "./env";
import { liveServiceFetch } from "./liveServiceAuth";

export type LiveHostSession = {
  sessionId: string;
  streamId: string;
  stageArn: string;
  hostToken: string;
  title: string;
  status: string;
  region?: string;
};

export type GuestRequestRow = {
  userId: string;
  status: string;
  requestedAt?: string;
  updatedAt?: string;
  sessionId?: string;
  slotIndex?: number | null;
};

function pickStr(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

async function livePost<T>(
  path: string,
  idToken: string,
  body?: Record<string, unknown>,
): Promise<T> {
  return liveServiceFetch<T>(path, idToken, "POST", body);
}

async function liveGet<T>(
  path: string,
  idToken: string,
  query?: Record<string, string>,
): Promise<T> {
  return liveServiceFetch<T>(path, idToken, "GET", undefined, query);
}

/** Probe result — 429/transient must not be reported as "offline". */
export type LiveProbeResult = "ok" | "busy" | "down";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Health probe with short retries. Platform 429s (latency 0s) previously made
 * GO LIVE throw a false "offline" toast while Cloud Run was still Ready.
 */
export async function probeLiveService(): Promise<LiveProbeResult> {
  let sawBusy = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${liveServiceUrl}/health`, {
        method: "GET",
        cache: "no-store",
      });
      if (res.ok) return "ok";
      if (res.status === 429) {
        sawBusy = true;
        if (attempt < 2) {
          await sleep(350 * (attempt + 1));
          continue;
        }
        return "busy";
      }
      if (attempt < 2) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      return "down";
    } catch {
      if (attempt < 2) {
        await sleep(350 * (attempt + 1));
        continue;
      }
      return sawBusy ? "busy" : "down";
    }
  }
  return sawBusy ? "busy" : "down";
}

export async function startLiveHostSession(
  idToken: string,
  title: string,
): Promise<LiveHostSession> {
  const probe = await probeLiveService();
  if (probe === "down") {
    throw new Error("Live service is offline right now. Try again in a moment.");
  }
  // "busy" (429 after retries): still attempt /api/live/start — service is up.
  const raw = await livePost<Record<string, unknown>>("/api/live/start", idToken, {
    title: title.trim() || "LIVE",
  });
  const session = (raw.session && typeof raw.session === "object"
    ? (raw.session as Record<string, unknown>)
    : raw) as Record<string, unknown>;
  const tokens =
    raw.tokens && typeof raw.tokens === "object"
      ? (raw.tokens as Record<string, unknown>)
      : {};
  const sessionId = pickStr(
    session.sessionId,
    session.streamId,
    raw.sessionId,
    raw.streamId,
  );
  const stageArn = pickStr(session.stageArn, raw.stageArn);
  const hostToken = pickStr(
    raw.hostToken,
    raw.token,
    tokens.hostToken,
    tokens.host,
    session.hostToken,
  );
  if (!sessionId || !stageArn || !hostToken) {
    throw new Error("Live start response missing session, stage, or host token");
  }
  return {
    sessionId,
    streamId: sessionId,
    stageArn,
    hostToken,
    title: pickStr(session.title, title) || "LIVE",
    status: pickStr(session.status) || "LIVE",
    region: pickStr(session.region) || undefined,
  };
}

export async function endLiveHostSession(
  idToken: string,
  sessionId: string,
): Promise<void> {
  await livePost("/api/live/end", idToken, { sessionId });
}

export async function heartbeatLiveHostSession(
  idToken: string,
  sessionId: string,
  studio?: {
    studioOrientation?: "portrait" | "landscape";
    studioLayout?: string;
  },
): Promise<void> {
  const body: Record<string, unknown> = { sessionId };
  if (
    studio?.studioOrientation === "portrait" ||
    studio?.studioOrientation === "landscape"
  ) {
    body.studioOrientation = studio.studioOrientation;
  }
  if (typeof studio?.studioLayout === "string" && studio.studioLayout.trim()) {
    body.studioLayout = studio.studioLayout.trim();
  }
  await livePost("/api/live/heartbeat", idToken, body);
}

export async function fetchGuestRequests(
  idToken: string,
  sessionId: string,
): Promise<GuestRequestRow[]> {
  const out = await liveGet<{ requests?: GuestRequestRow[] }>(
    "/api/live/guest/requests",
    idToken,
    { sessionId },
  );
  return Array.isArray(out.requests) ? out.requests : [];
}

export async function inviteGuest(
  idToken: string,
  sessionId: string,
  guestUserId: string,
): Promise<void> {
  await livePost("/api/live/guest/invite", idToken, { sessionId, guestUserId });
}

export async function rejectGuest(
  idToken: string,
  sessionId: string,
  guestUserId: string,
): Promise<void> {
  await livePost("/api/live/guest/reject", idToken, { sessionId, guestUserId });
}

export function watchUrlForSession(sessionId: string): string {
  return `${siteUrl}/live/${encodeURIComponent(sessionId)}/`;
}

const ACTIVE_KEY = "blyp.world.liveStudio.activeSession";

export function persistActiveHostSession(session: LiveHostSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (!session) {
      sessionStorage.removeItem(ACTIVE_KEY);
      return;
    }
    sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function loadActiveHostSession(): LiveHostSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveHostSession;
    if (!parsed?.sessionId || !parsed?.hostToken) return null;
    return parsed;
  } catch {
    return null;
  }
}
