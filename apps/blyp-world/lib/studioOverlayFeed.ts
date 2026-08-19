import {
  DEFAULT_OVERLAYS,
  DEFAULT_OVERLAY_POSITIONS,
  normalizeOverlayPositions,
  type OverlayPositions,
  type OverlayState,
  type StudioOverlayId,
} from "@/lib/studioDualView";

export type OverlayFeedEvent = {
  id: string;
  text: string;
  at: number;
};

export type OverlayFeedSnapshot = {
  v: 1;
  overlays: OverlayState;
  positions: OverlayPositions;
  chatLines: { name: string; text: string }[];
  giftsLabel: string;
  goalPct: number;
  goalLabel: string;
  jukeboxNow: string;
  jukeboxArt?: string | null;
  jukeboxTitle?: string;
  jukeboxArtist?: string;
  jukeboxNext?: string;
  jukeboxPos?: number;
  jukeboxDur?: number;
  jukeboxPaused?: boolean;
  events: OverlayFeedEvent[];
  timerLabel: string;
  viewers: number;
  watchUrl: string;
  gifters: string[];
  /** Per-aspect overlay layouts — watch picks by viewport, not host toggle. */
  positionsPortrait?: OverlayPositions;
  positionsLandscape?: OverlayPositions;
  layoutPortrait?: string;
  layoutLandscape?: string;
  /** Optional custom CSS injected by overlay clean-feed page. */
  themeCss?: string;
  /** Live session id when mirrored to Firestore for cross-machine OBS. */
  sessionId?: string;
  updatedAt: number;
};

export const OVERLAY_FEED_KEY = "blyp.liveStudio.overlayFeed.v1";
export const OVERLAY_STATE_KEY = "blyp.liveStudio.overlayState.v1";
export const OVERLAY_CHANNEL = "blyp.liveStudio.overlayFeed";

export const DEFAULT_OVERLAY_FEED: OverlayFeedSnapshot = {
  v: 1,
  overlays: { ...DEFAULT_OVERLAYS },
  positions: { ...DEFAULT_OVERLAY_POSITIONS },
  chatLines: [],
  giftsLabel: "Gift alerts",
  goalPct: 0,
  goalLabel: "Stream goal",
  jukeboxNow: "Queue empty",
  jukeboxArt: null,
  jukeboxTitle: "",
  jukeboxArtist: "",
  jukeboxNext: "",
  jukeboxPos: 0,
  jukeboxDur: 0,
  jukeboxPaused: true,
  events: [],
  timerLabel: "00:00:00",
  viewers: 0,
  watchUrl: "",
  gifters: ["Waiting…", "—", "—"],
  themeCss: "",
  sessionId: "",
  updatedAt: 0,
};

export function loadOverlayState(): OverlayState {
  const base: OverlayState = { ...DEFAULT_OVERLAYS };
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(OVERLAY_STATE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Record<StudioOverlayId, boolean>>;
    for (const id of Object.keys(DEFAULT_OVERLAYS) as StudioOverlayId[]) {
      if (typeof parsed[id] === "boolean") base[id] = parsed[id]!;
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function saveOverlayState(state: OverlayState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OVERLAY_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export function writeOverlayFeed(snap: OverlayFeedSnapshot): void {
  if (typeof window === "undefined") return;
  const payload: OverlayFeedSnapshot = { ...snap, v: 1, updatedAt: Date.now() };
  try {
    window.localStorage.setItem(OVERLAY_FEED_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
  try {
    const ch = new BroadcastChannel(OVERLAY_CHANNEL);
    ch.postMessage(payload);
    ch.close();
  } catch {
    /* ignore */
  }
}

export function readOverlayFeed(): OverlayFeedSnapshot {
  if (typeof window === "undefined") return { ...DEFAULT_OVERLAY_FEED };
  try {
    const raw = window.localStorage.getItem(OVERLAY_FEED_KEY);
    if (!raw) return { ...DEFAULT_OVERLAY_FEED };
    const parsed = JSON.parse(raw) as Partial<OverlayFeedSnapshot>;
    return normalizeFeed(parsed);
  } catch {
    return { ...DEFAULT_OVERLAY_FEED };
  }
}

export function normalizeFeed(
  parsed: Partial<OverlayFeedSnapshot> | null | undefined,
): OverlayFeedSnapshot {
  const overlays: OverlayState = { ...DEFAULT_OVERLAYS };
  const positions = parsed?.positions
    ? normalizeOverlayPositions(parsed.positions)
    : { ...DEFAULT_OVERLAY_POSITIONS };
  if (parsed?.overlays) {
    for (const id of Object.keys(DEFAULT_OVERLAYS) as StudioOverlayId[]) {
      if (typeof parsed.overlays[id] === "boolean") {
        overlays[id] = parsed.overlays[id]!;
      }
    }
  }
  return {
    v: 1,
    overlays,
    positions,
    chatLines: Array.isArray(parsed?.chatLines) ? parsed!.chatLines!.slice(0, 8) : [],
    giftsLabel:
      typeof parsed?.giftsLabel === "string" ? parsed.giftsLabel : "Gift alerts",
    goalPct:
      typeof parsed?.goalPct === "number"
        ? Math.min(100, Math.max(0, parsed.goalPct))
        : 0,
    goalLabel:
      typeof parsed?.goalLabel === "string" ? parsed.goalLabel : "Stream goal",
    jukeboxNow:
      typeof parsed?.jukeboxNow === "string" ? parsed.jukeboxNow : "Queue empty",
    jukeboxArt: typeof parsed?.jukeboxArt === "string" ? parsed.jukeboxArt : null,
    jukeboxTitle: typeof parsed?.jukeboxTitle === "string" ? parsed.jukeboxTitle : "",
    jukeboxArtist: typeof parsed?.jukeboxArtist === "string" ? parsed.jukeboxArtist : "",
    jukeboxNext: typeof parsed?.jukeboxNext === "string" ? parsed.jukeboxNext : "",
    jukeboxPos: typeof parsed?.jukeboxPos === "number" ? parsed.jukeboxPos : 0,
    jukeboxDur: typeof parsed?.jukeboxDur === "number" ? parsed.jukeboxDur : 0,
    jukeboxPaused: typeof parsed?.jukeboxPaused === "boolean" ? parsed.jukeboxPaused : true,
    events: Array.isArray(parsed?.events) ? parsed!.events!.slice(0, 12) : [],
    timerLabel:
      typeof parsed?.timerLabel === "string" ? parsed.timerLabel : "00:00:00",
    viewers: typeof parsed?.viewers === "number" ? parsed.viewers : 0,
    watchUrl: typeof parsed?.watchUrl === "string" ? parsed.watchUrl : "",
    gifters: Array.isArray(parsed?.gifters)
      ? parsed!.gifters!.slice(0, 5)
      : ["Waiting…", "—", "—"],
    positionsPortrait: parsed?.positionsPortrait
      ? normalizeOverlayPositions(parsed.positionsPortrait)
      : undefined,
    positionsLandscape: parsed?.positionsLandscape
      ? normalizeOverlayPositions(parsed.positionsLandscape)
      : undefined,
    layoutPortrait:
      typeof parsed?.layoutPortrait === "string" ? parsed.layoutPortrait : undefined,
    layoutLandscape:
      typeof parsed?.layoutLandscape === "string" ? parsed.layoutLandscape : undefined,
    themeCss: typeof parsed?.themeCss === "string" ? parsed.themeCss.slice(0, 12_000) : "",
    sessionId: typeof parsed?.sessionId === "string" ? parsed.sessionId : "",
    updatedAt: typeof parsed?.updatedAt === "number" ? parsed.updatedAt : 0,
  };
}

export function overlayBrowserSourcePath(sessionId?: string): string {
  if (sessionId) {
    return `/live/studio/overlay/?session=${encodeURIComponent(sessionId)}`;
  }
  return "/live/studio/overlay/";
}

export function deckCompanionPath(): string {
  return "/live/studio/deck/";
}

export function formatSessionTimer(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function overlayFeedUrl(sessionId: string): string {
  return `/api/live/overlay-feed?session=${encodeURIComponent(sessionId)}`;
}

/** Public watch/OBS overlay snapshot (no login). Host writes with Cognito. */
export async function fetchOverlayFeedRemote(
  sessionId: string,
): Promise<OverlayFeedSnapshot | null> {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  try {
    const res = await fetch(overlayFeedUrl(id), { method: "GET" });
    if (!res.ok) return null;
    const json = (await res.json()) as { feed?: Partial<OverlayFeedSnapshot> };
    if (!json?.feed || typeof json.feed !== "object") return null;
    return normalizeFeed(json.feed);
  } catch {
    return null;
  }
}

export async function publishOverlayFeedRemote(
  sessionId: string,
  idToken: string,
  snap: OverlayFeedSnapshot,
): Promise<boolean> {
  const id = String(sessionId || "").trim();
  const token = String(idToken || "").trim();
  if (!id || !token) return false;
  try {
    const res = await fetch(overlayFeedUrl(id), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sessionId: id, feed: snap }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
