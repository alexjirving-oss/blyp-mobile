import type { DeskOrientation } from "@/lib/studioDeskMedia";
import type { StageLayoutDef, StageTile } from "@/lib/studioStageLayouts";

export type StudioOverlayId =
  | "gifters"
  | "goal"
  | "chat"
  | "gifts"
  | "jukebox"
  | "events"
  | "timer"
  | "viewers"
  | "qr";

export const STUDIO_OVERLAYS: {
  id: StudioOverlayId;
  label: string;
}[] = [
  { id: "gifters", label: "Top gifters" },
  { id: "goal", label: "Goal" },
  { id: "chat", label: "Chat dock" },
  { id: "gifts", label: "Gift alerts" },
  { id: "jukebox", label: "Jukebox" },
  { id: "events", label: "Recent events" },
  { id: "timer", label: "Session timer" },
  { id: "viewers", label: "Viewer chip" },
  { id: "qr", label: "Watch QR / link" },
];

export type OverlayState = Record<StudioOverlayId, boolean>;

export const DEFAULT_OVERLAYS: OverlayState = {
  gifters: true,
  goal: true,
  chat: true,
  gifts: true,
  jukebox: false,
  events: true,
  timer: true,
  viewers: true,
  qr: false,
};

/** Percent of program-host width/height (top-left of overlay). Scale is 1 = default. */
export type OverlayPos = { x: number; y: number; scale: number };
export type OverlayPositions = Record<StudioOverlayId, OverlayPos>;

export const OVERLAY_SCALE_PRESETS = {
  S: 0.52,
  M: 1,
  L: 1.42,
} as const;

export function clampOverlayScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(1.75, Math.max(0.4, n));
}

const S = OVERLAY_SCALE_PRESETS.S;

export const DEFAULT_OVERLAY_POSITIONS: OverlayPositions = {
  gifters: { x: 2, y: 2, scale: S },
  goal: { x: 2, y: 78, scale: S },
  chat: { x: 62, y: 78, scale: S },
  gifts: { x: 72, y: 62, scale: S },
  jukebox: { x: 3, y: 86, scale: S },
  events: { x: 2, y: 48, scale: S },
  timer: { x: 78, y: 2, scale: S },
  viewers: { x: 40, y: 2, scale: S },
  qr: { x: 78, y: 40, scale: S },
};

export type OverlayPositionsByAspect = {
  portrait: OverlayPositions;
  landscape: OverlayPositions;
};

const OVERLAY_POS_STORAGE_KEY = "blyp.liveStudio.overlayPositions.v3";
const OVERLAY_POS_STORAGE_KEY_V2 = "blyp.liveStudio.overlayPositions.v2";
const OVERLAY_POS_STORAGE_KEY_V1 = "blyp.liveStudio.overlayPositions.v1";
const OVERLAY_POS_ASPECT_KEY = "blyp.liveStudio.overlayPositions.aspect.v1";

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(95, Math.max(0, n));
}

export function readOverlayPos(
  id: StudioOverlayId,
  raw: Partial<OverlayPos> | undefined,
): OverlayPos {
  const d = DEFAULT_OVERLAY_POSITIONS[id];
  const x = typeof raw?.x === "number" ? clampPercent(raw.x) : d.x;
  const y = typeof raw?.y === "number" ? clampPercent(raw.y) : d.y;
  const scale =
    typeof raw?.scale === "number" ? clampOverlayScale(raw.scale) : d.scale;
  return { x, y, scale };
}

export function normalizeOverlayPositions(
  raw?: Partial<Record<StudioOverlayId, Partial<OverlayPos>>> | null,
): OverlayPositions {
  const base: OverlayPositions = { ...DEFAULT_OVERLAY_POSITIONS };
  if (!raw) return base;
  for (const id of Object.keys(DEFAULT_OVERLAY_POSITIONS) as StudioOverlayId[]) {
    if (raw[id]) base[id] = readOverlayPos(id, raw[id]);
  }
  return base;
}

export function loadOverlayPositions(): OverlayPositions {
  if (typeof window === "undefined") return { ...DEFAULT_OVERLAY_POSITIONS };
  try {
    const v3 = window.localStorage.getItem(OVERLAY_POS_STORAGE_KEY);
    const v2 = window.localStorage.getItem(OVERLAY_POS_STORAGE_KEY_V2);
    const v1 = window.localStorage.getItem(OVERLAY_POS_STORAGE_KEY_V1);
    const parsed = JSON.parse(v3 || v2 || v1 || "null") as Partial<
      Record<StudioOverlayId, Partial<OverlayPos>>
    > | null;
    return normalizeOverlayPositions(parsed);
  } catch {
    return { ...DEFAULT_OVERLAY_POSITIONS };
  }
}

export function loadOverlayPositionsByAspect(): OverlayPositionsByAspect {
  const fallback = loadOverlayPositions();
  if (typeof window === "undefined") {
    return { portrait: { ...fallback }, landscape: { ...fallback } };
  }
  try {
    const raw = window.localStorage.getItem(OVERLAY_POS_ASPECT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<OverlayPositionsByAspect>;
      return {
        portrait: normalizeOverlayPositions(parsed.portrait),
        landscape: normalizeOverlayPositions(parsed.landscape),
      };
    }
  } catch {
    /* ignore */
  }
  return { portrait: { ...fallback }, landscape: { ...fallback } };
}

export function saveOverlayPositions(positions: OverlayPositions): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      OVERLAY_POS_STORAGE_KEY,
      JSON.stringify(positions),
    );
  } catch {
    /* quota / private mode */
  }
}

export function saveOverlayPositionsByAspect(
  maps: OverlayPositionsByAspect,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OVERLAY_POS_ASPECT_KEY, JSON.stringify(maps));
    saveOverlayPositions(maps.portrait);
  } catch {
    /* quota / private mode */
  }
}

/**
 * Web watch: phone / Fold cover → portrait program.
 * Desktop / iPad → landscape. Host PORTRAIT/LANDSCAPE is director layout only.
 */
export function watchProgramAspectFromViewport(
  width?: number,
  height?: number,
): DeskOrientation {
  if (typeof window === "undefined") return "landscape";
  const w = width ?? window.innerWidth;
  const h = height ?? window.innerHeight;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isIpad =
    /iPad/i.test(ua) ||
    (/Macintosh/i.test(ua) &&
      typeof navigator !== "undefined" &&
      navigator.maxTouchPoints > 1);
  if (isIpad) return "landscape";
  if (w >= 900) return "landscape";
  if (w < 700) return "portrait";
  if (/iPhone/i.test(ua)) return "portrait";
  if (/Android/i.test(ua) && /Mobile/i.test(ua) && h > w) return "portrait";
  return "landscape";
}

export function overlayPositionsForWatchAspect(
  positions: OverlayPositions,
  portrait: OverlayPositions | undefined,
  landscape: OverlayPositions | undefined,
  aspect: DeskOrientation,
): OverlayPositions {
  if (aspect === "portrait") return portrait || positions;
  return landscape || positions;
}

/** Quick presets in the top bar (mockup-style). */
export const TOP_LAYOUT_PRESETS: {
  id: string;
  label: string;
  orientation: DeskOrientation;
  layout: string;
}[] = [
  {
    id: "portrait",
    label: "Portrait",
    orientation: "portrait",
    layout: "solo",
  },
  {
    id: "landscape",
    label: "Landscape",
    orientation: "landscape",
    layout: "solo",
  },
  {
    id: "host-top",
    label: "Host-top",
    orientation: "portrait",
    layout: "host-top",
  },
  {
    id: "host-9",
    label: "Host + 9",
    orientation: "portrait",
    layout: "host-top-9",
  },
  {
    id: "grid",
    label: "Grid · Nuke",
    orientation: "portrait",
    layout: "grid-3x3",
  },
];

export function stageFrameClass(
  orientation: DeskOrientation,
  layoutId: string,
): string {
  const base =
    orientation === "portrait" ? "tls-phone" : "tls-phone tls-phone-wide";
  return `${base} tls-layout-${layoutId}`;
}

export function buildStageTiles(
  layout: StageLayoutDef,
  onStage: { userId: string; status: string }[],
): StageTile[] {
  const tiles: StageTile[] = [];
  for (let i = 0; i < layout.guestSlots; i += 1) {
    const g = onStage[i];
    if (g) {
      tiles.push({
        key: g.userId,
        label: g.userId.slice(0, 8),
        sub: g.status,
        empty: false,
      });
    } else {
      tiles.push({
        key: `empty-${layout.id}-${i}`,
        label: `Guest ${i + 1}`,
        sub: "Open",
        empty: true,
      });
    }
  }
  return tiles;
}
