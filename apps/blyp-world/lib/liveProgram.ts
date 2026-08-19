import { liveServiceUrl } from "./env";

export type LiveProgram = {
  sessionId: string;
  status: string;
  title: string;
  playbackUrl: string;
  compositionState: string;
};

export type LiveProgramFetch =
  | { ok: true; program: LiveProgram }
  | { ok: false; reason: "not_live" | "rate_limited" | "transient" };

function readErrorCode(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const rec = body as { code?: unknown; error?: unknown };
  if (typeof rec.code === "string") return rec.code;
  if (typeof rec.error === "string") return rec.error;
  return "";
}

export async function fetchLiveProgram(
  sessionId: string,
): Promise<LiveProgramFetch> {
  try {
    const res = await fetch(
      liveServiceUrl + "/api/live/program/" + encodeURIComponent(sessionId),
      { method: "GET" },
    );
    if (res.status === 429) {
      return { ok: false, reason: "rate_limited" };
    }
    if (res.status === 404) {
      return { ok: false, reason: "not_live" };
    }
    if (!res.ok) {
      let code = "";
      try {
        code = readErrorCode(await res.json());
      } catch {
        /* ignore */
      }
      if (code === "NOT_LIVE") return { ok: false, reason: "not_live" };
      if (code === "RATE_LIMIT") return { ok: false, reason: "rate_limited" };
      return { ok: false, reason: "transient" };
    }
    const json = (await res.json()) as LiveProgram;
    if (!json || typeof json.playbackUrl !== "string" || !json.playbackUrl) {
      return { ok: false, reason: "transient" };
    }
    return { ok: true, program: json };
  } catch {
    return { ok: false, reason: "transient" };
  }
}
