export type LayoutOrientation = "portrait" | "landscape";
export type LayoutPreset = "solo" | "host-top" | "side-by-side";

export type OverlayKind =
  | "top-gifters"
  | "chat-ticker"
  | "chat-dock"
  | "coin-counter"
  | "jackpot"
  | "goal"
  | "gift-alerts"
  | "live-badge";

export type OverlayAnchor = "tl" | "tr" | "bl" | "br" | "top" | "bottom" | "custom";

export type OverlayInstance = {
  id: string;
  kind: OverlayKind;
  label: string;
  enabled: boolean;
  visibleOnCleanFeed: boolean;
  anchor: OverlayAnchor;
  /** Percent of clean-feed width (used when anchor is custom or after drag). */
  x: number;
  y: number;
};

export type OverlayCatalogItem = {
  kind: OverlayKind;
  label: string;
  blurb: string;
  defaultAnchor: OverlayAnchor;
  defaultX: number;
  defaultY: number;
  grid9Only?: boolean;
};

export const OVERLAY_CATALOG: OverlayCatalogItem[] = [
  {
    kind: "live-badge",
    label: "Host / LIVE badge",
    blurb: "Name plate + LIVE pill",
    defaultAnchor: "tl",
    defaultX: 2,
    defaultY: 2,
  },
  {
    kind: "top-gifters",
    label: "Top gifters / Daily Top 3",
    blurb: "Leaderboard of coin supporters",
    defaultAnchor: "tr",
    defaultX: 68,
    defaultY: 2,
  },
  {
    kind: "coin-counter",
    label: "Coin / gift counter",
    blurb: "Session coins + viewer tally",
    defaultAnchor: "tr",
    defaultX: 68,
    defaultY: 22,
  },
  {
    kind: "jackpot",
    label: "Jackpot pot",
    blurb: "Grid 9 house pot",
    defaultAnchor: "top",
    defaultX: 28,
    defaultY: 2,
    grid9Only: true,
  },
  {
    kind: "goal",
    label: "Treasure goal",
    blurb: "Progress bar toward a coin target",
    defaultAnchor: "bl",
    defaultX: 2,
    defaultY: 78,
  },
  {
    kind: "gift-alerts",
    label: "Gift alerts / gift rail",
    blurb: "Recent gift toasts",
    defaultAnchor: "br",
    defaultX: 62,
    defaultY: 62,
  },
  {
    kind: "chat-ticker",
    label: "Chat ticker / phone chat",
    blurb: "Scrolling live-feed line",
    defaultAnchor: "bottom",
    defaultX: 2,
    defaultY: 92,
  },
  {
    kind: "chat-dock",
    label: "Chat dock",
    blurb: "Stacked comments panel",
    defaultAnchor: "br",
    defaultX: 62,
    defaultY: 38,
  },
];

const ANCHOR_POS: Record<Exclude<OverlayAnchor, "custom">, { x: number; y: number }> = {
  tl: { x: 2, y: 2 },
  tr: { x: 68, y: 2 },
  bl: { x: 2, y: 78 },
  br: { x: 62, y: 62 },
  top: { x: 28, y: 2 },
  bottom: { x: 2, y: 92 },
};

export function catalogItem(kind: OverlayKind): OverlayCatalogItem {
  return OVERLAY_CATALOG.find((c) => c.kind === kind) ?? OVERLAY_CATALOG[0];
}

export function createOverlay(kind: OverlayKind): OverlayInstance {
  const item = catalogItem(kind);
  return {
    id: `ov-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    label: item.label,
    enabled: true,
    visibleOnCleanFeed: true,
    anchor: item.defaultAnchor,
    x: item.defaultX,
    y: item.defaultY,
  };
}

export function defaultOverlays(): OverlayInstance[] {
  return (
    [
      "live-badge",
      "top-gifters",
      "coin-counter",
      "jackpot",
      "goal",
      "gift-alerts",
      "chat-ticker",
    ] as OverlayKind[]
  ).map(createOverlay);
}

export function overlayPosition(o: OverlayInstance): { x: number; y: number } {
  if (o.anchor === "custom") return { x: o.x, y: o.y };
  return ANCHOR_POS[o.anchor] ?? { x: o.x, y: o.y };
}

export function applyAnchor(
  o: OverlayInstance,
  anchor: OverlayAnchor,
): OverlayInstance {
  if (anchor === "custom") return { ...o, anchor };
  const pos = ANCHOR_POS[anchor];
  return { ...o, anchor, x: pos.x, y: pos.y };
}

export function canvasSize(orientation: LayoutOrientation): {
  w: number;
  h: number;
} {
  return orientation === "portrait"
    ? { w: 720, h: 1280 }
    : { w: 1280, h: 720 };
}
