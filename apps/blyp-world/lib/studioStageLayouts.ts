import type { DeskOrientation } from "@/lib/studioDeskMedia";

/**
 * Program / guest composition layouts for LIVE Studio.
 * Orientation filters which presets appear; CSS owns the geometry.
 */
export type StageLayoutId =
  // Portrait (9:16)
  | "solo"
  | "host-top"
  | "host-top-9"
  | "split-stack"
  | "host-bottom"
  | "host-bottom-9"
  | "side-by-side"
  | "focus-rail"
  | "tri-stack"
  | "quad"
  // Landscape (16:9)
  | "cinema-bar"
  | "split-dual"
  | "host-left-rail"
  | "focus-plus-4"
  | "grid-3x3";

export type StageLayoutDef = {
  id: StageLayoutId;
  label: string;
  blurb: string;
  /** Orientations this preset is designed for. */
  orientations: DeskOrientation[];
  /** Guest / secondary tiles to reserve on the stage (empty slots still render). */
  guestSlots: number;
  /** Host sits in the guest mosaic (no separate program pane). */
  hostInGrid?: boolean;
};

export const STAGE_LAYOUTS: StageLayoutDef[] = [
  {
    id: "solo",
    label: "Solo",
    blurb: "Host fills the whole program",
    orientations: ["portrait", "landscape"],
    guestSlots: 0,
  },
  {
    id: "host-top",
    label: "Host top",
    blurb: "Host on top · guest strip below",
    orientations: ["portrait", "landscape"],
    guestSlots: 4,
  },
  {
    id: "host-top-9",
    label: "Host + 9",
    blurb: "Host band · 3×3 guests · click cells to Nuke",
    orientations: ["portrait"],
    guestSlots: 9,
  },
  {
    id: "split-stack",
    label: "Split stack",
    blurb: "Two widescreen panes stacked (host / guest)",
    orientations: ["portrait"],
    guestSlots: 1,
  },
  {
    id: "host-bottom",
    label: "Host bottom",
    blurb: "Guests on top · host below",
    orientations: ["portrait"],
    guestSlots: 4,
  },
  {
    id: "host-bottom-9",
    label: "9 + host",
    blurb: "3×3 guests · host below · click cells to Nuke",
    orientations: ["portrait"],
    guestSlots: 9,
  },
  {
    id: "side-by-side",
    label: "Side by side",
    blurb: "Host left · guests right",
    orientations: ["portrait", "landscape"],
    guestSlots: 4,
  },
  {
    id: "focus-rail",
    label: "Focus + rail",
    blurb: "Large host · stacked guest rail",
    orientations: ["portrait", "landscape"],
    guestSlots: 3,
  },
  {
    id: "tri-stack",
    label: "Tri stack",
    blurb: "Three horizontal bands",
    orientations: ["portrait"],
    guestSlots: 2,
  },
  {
    id: "quad",
    label: "Quad",
    blurb: "2×2 equal panes (host + 3)",
    orientations: ["portrait", "landscape"],
    guestSlots: 3,
  },
  {
    id: "cinema-bar",
    label: "Cinema bar",
    blurb: "Full host · filmstrip guests under",
    orientations: ["landscape"],
    guestSlots: 6,
  },
  {
    id: "split-dual",
    label: "Split dual",
    blurb: "Two equal widescreen panes side by side",
    orientations: ["landscape"],
    guestSlots: 1,
  },
  {
    id: "host-left-rail",
    label: "Host + rail",
    blurb: "Wide host · vertical guest column",
    orientations: ["landscape"],
    guestSlots: 4,
  },
  {
    id: "focus-plus-4",
    label: "Focus + 4",
    blurb: "Large host · 2×2 guests",
    orientations: ["landscape"],
    guestSlots: 4,
  },
  {
    id: "grid-3x3",
    label: "Grid 3×3",
    blurb: "Nine cells · host center · click to Nuke",
    orientations: ["portrait", "landscape"],
    guestSlots: 8,
    hostInGrid: true,
  },
];

export function layoutsForOrientation(
  orientation: DeskOrientation,
): StageLayoutDef[] {
  return STAGE_LAYOUTS.filter((l) => l.orientations.includes(orientation));
}

export function layoutDef(id: StageLayoutId): StageLayoutDef {
  return STAGE_LAYOUTS.find((l) => l.id === id) ?? STAGE_LAYOUTS[0];
}

/** Default when switching orientation if current preset is invalid. */
export function defaultLayoutFor(
  orientation: DeskOrientation,
): StageLayoutId {
  void orientation;
  return "solo";
}

export function coerceLayout(
  id: StageLayoutId,
  orientation: DeskOrientation,
): StageLayoutId {
  const ok = layoutDef(id).orientations.includes(orientation);
  return ok ? id : defaultLayoutFor(orientation);
}

/** Phone compositional modes — keep in sync with src/live/ivs/multiGuestLayout.ts */
export type PhoneLiveLayoutMode =
  | "bottom_grid"
  | "host_focus"
  | "equal_grid"
  | "side_by_side"
  | "solo"
  | "host_top_9";

const STUDIO_TO_PHONE: Record<StageLayoutId, PhoneLiveLayoutMode> = {
  solo: "solo",
  "host-top": "host_focus",
  "host-top-9": "host_top_9",
  "split-stack": "equal_grid",
  "host-bottom": "host_focus",
  "host-bottom-9": "equal_grid",
  "side-by-side": "side_by_side",
  "focus-rail": "host_focus",
  "tri-stack": "equal_grid",
  quad: "equal_grid",
  "cinema-bar": "host_focus",
  "split-dual": "side_by_side",
  "host-left-rail": "side_by_side",
  "focus-plus-4": "host_focus",
  "grid-3x3": "equal_grid",
};

export function phoneLayoutModeFromStudio(raw: string): PhoneLiveLayoutMode | null {
  const id = raw.trim() as StageLayoutId;
  return STUDIO_TO_PHONE[id] || null;
}

/** Host+9 / 9+host / Grid 3×3 — bomb-strike (Nukemonkey) is armed. */
export function isStrikeLayout(layout: StageLayoutDef): boolean {
  return layout.guestSlots === 9 || Boolean(layout.hostInGrid);
}

export type StageTile = {
  key: string;
  label: string;
  sub: string;
  empty: boolean;
  isHost?: boolean;
};
