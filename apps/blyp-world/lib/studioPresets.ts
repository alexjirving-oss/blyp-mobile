import type { DeskOrientation } from "@/lib/studioDeskMedia";
import type { StageLayoutId } from "@/lib/studioStageLayouts";
import type { OverlayPositions, OverlayState } from "@/lib/studioDualView";

export type StudioPreset = {
  id: string;
  name: string;
  orientation: DeskOrientation;
  layout: StageLayoutId | string;
  overlays: OverlayState;
  positions: OverlayPositions;
  savedAt: number;
};

const PRESETS_KEY = "blyp.liveStudio.presets.v1";

function safeParse(raw: string | null): StudioPreset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StudioPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        p.overlays &&
        p.positions,
    );
  } catch {
    return [];
  }
}

export function loadStudioPresets(): StudioPreset[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParse(window.localStorage.getItem(PRESETS_KEY));
  } catch {
    return [];
  }
}

export function saveStudioPresets(presets: StudioPreset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.slice(0, 24)));
  } catch {
    /* quota */
  }
}

export function upsertStudioPreset(
  list: StudioPreset[],
  next: Omit<StudioPreset, "id" | "savedAt"> & { id?: string },
): StudioPreset[] {
  const id =
    next.id ||
    `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const row: StudioPreset = {
    id,
    name: next.name.trim() || "Untitled studio",
    orientation: next.orientation,
    layout: next.layout,
    overlays: next.overlays,
    positions: next.positions,
    savedAt: Date.now(),
  };
  const without = list.filter((p) => p.id !== id && p.name !== row.name);
  return [row, ...without].slice(0, 24);
}

export function deleteStudioPreset(
  list: StudioPreset[],
  id: string,
): StudioPreset[] {
  return list.filter((p) => p.id !== id);
}
