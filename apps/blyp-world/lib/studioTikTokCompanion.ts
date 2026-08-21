/**

 * Client for the local Blyp TikTok Companion (127.0.0.1:8765).

 * Stream keys stay on the user's PC; Studio reads them over loopback only.

 */



export type TikTokCompanionPhase =

  | "idle"

  | "scanning"

  | "launching_app"

  | "watching"

  | "connected"

  | "error";



export type TikTokCompanionStatus = {

  connected: boolean;

  phase: TikTokCompanionPhase;

  rtmpUrl?: string;

  streamKey?: string;

  handle?: string;

  error?: string;

  message?: string;

  liveStudioInstalled?: boolean;

  scan?: {

    rootsChecked: number;

    filesScanned: number;

    roots: string[];

    installedExe?: string;

  };

};



export const TIKTOK_COMPANION_BASE =

  process.env.NEXT_PUBLIC_TIKTOK_COMPANION_URL || "http://127.0.0.1:8765";



/** Hosted Windows helper (double-click .exe). Not an npm script. */
export const TIKTOK_COMPANION_DOWNLOAD_URL =
  "/downloads/BlypTikTokCompanion-win.exe";

/** TikTok’s own Windows app. Auto-connect reads its local cache. */
export const TIKTOK_LIVE_STUDIO_DOWNLOAD_URL =
  "https://www.tiktok.com/studio/download";



const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));



async function companionFetch<T>(

  path: string,

  init?: RequestInit,

): Promise<T | null> {

  try {

    const res = await fetch(`${TIKTOK_COMPANION_BASE}${path}`, {

      ...init,

      cache: "no-store",

      headers: {

        "Content-Type": "application/json",

        ...(init?.headers || {}),

      },

    });

    return (await res.json().catch(() => null)) as T | null;

  } catch {

    return null;

  }

}



export function companionPhaseLabel(status: TikTokCompanionStatus): string {

  if (status.connected) return "Connected";

  if (status.message?.trim()) return status.message.trim();

  switch (status.phase) {

    case "scanning":

      return "Scanning TikTok Live Studio on this PC…";

    case "launching_app":

      return "Launching TikTok Live Studio…";

    case "watching":

      return status.liveStudioInstalled

        ? "Waiting for Live Studio to write Server URL + Stream key (Go LIVE → Stream settings)"

        : "Waiting for TikTok credentials on this PC…";

    case "error":

      return status.error || "Connection failed";

    default:

      return "Connecting…";

  }

}



export function companionBlockingHint(status: TikTokCompanionStatus | null): string | null {

  if (!status) return null;

  if (status.connected) return null;

  if (status.phase === "error" && status.error) return status.error;

  if (status.phase === "watching") {

    return "Open TikTok Live Studio → Go LIVE → Stream settings. Credentials appear here automatically when Live Studio writes them.";

  }

  if (status.phase === "launching_app") {

    return "TikTok Live Studio is opening. In the app: Go LIVE → Stream settings.";

  }

  if (!status.liveStudioInstalled) {

    return "Install TikTok Live Studio on this PC, sign in, then click Connect TikTok again.";

  }

  return null;

}



export async function companionHealth(): Promise<boolean> {

  const payload = await companionFetch<{ ok?: boolean }>("/health");

  return Boolean(payload?.ok);

}



export async function companionConnect(): Promise<TikTokCompanionStatus | null> {

  return companionFetch<TikTokCompanionStatus>("/connect", { method: "POST" });

}



export async function companionStatus(): Promise<TikTokCompanionStatus | null> {

  return companionFetch<TikTokCompanionStatus>("/status");

}



export async function companionSubmitCredentials(input: {

  rtmpUrl: string;

  streamKey: string;

  handle?: string;

}): Promise<TikTokCompanionStatus | null> {

  return companionFetch<TikTokCompanionStatus>("/setup", {

    method: "POST",

    body: JSON.stringify(input),

  });

}



export type ConnectTikTokResult =

  | {

      ok: true;

      status: TikTokCompanionStatus;

    }

  | {

      ok: false;

      reason: "companion_offline" | "timeout" | "error";

      message: string;

      status?: TikTokCompanionStatus | null;

    };



export async function connectTikTokViaCompanion(opts?: {

  timeoutMs?: number;

  pollMs?: number;

  onStatus?: (status: TikTokCompanionStatus) => void;

}): Promise<ConnectTikTokResult> {

  const timeoutMs = opts?.timeoutMs ?? 120_000;

  const pollMs = opts?.pollMs ?? 1_000;



  const healthy = await companionHealth();

  if (!healthy) {

    return {

      ok: false,

      reason: "companion_offline",

      message: "Companion not running on this PC",

    };

  }



  const kickoff = await companionConnect();

  if (!kickoff) {

    return {

      ok: false,

      reason: "error",

      message: "Companion did not respond to /connect",

    };

  }



  opts?.onStatus?.(kickoff);



  if (kickoff.connected && kickoff.rtmpUrl && kickoff.streamKey) {

    return { ok: true, status: kickoff };

  }



  if (kickoff.phase === "error" && kickoff.error) {

    return {

      ok: false,

      reason: "error",

      message: kickoff.error,

      status: kickoff,

    };

  }



  const deadline = Date.now() + timeoutMs;

  let last = kickoff;



  while (Date.now() < deadline) {

    const status = (await companionStatus()) || last;

    last = status;

    opts?.onStatus?.(status);



    if (status.connected && status.rtmpUrl && status.streamKey) {

      return { ok: true, status };

    }



    if (status.phase === "error" && status.error) {

      return {

        ok: false,

        reason: "error",

        message: status.error,

        status,

      };

    }



    await sleep(pollMs);

  }



  const blocking = companionBlockingHint(last);

  return {

    ok: false,

    reason: "timeout",

    message: blocking || "Timed out waiting for TikTok credentials from Live Studio",

    status: last,

  };

}

