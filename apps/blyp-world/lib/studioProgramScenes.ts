/**
 * Named program scenes: camera / screen / PIP + layout combo.
 */

import type { DeskMediaMode, DeskOrientation } from "@/lib/studioDeskMedia";
import type { StageLayoutId } from "@/lib/studioStageLayouts";
import type { OverlayPositions, OverlayState } from "@/lib/studioDualView";

export type ProgramScene = {
  id: string;
  name: string;
  mediaMode: DeskMediaMode;
  mainSource: "laptop" | "phone" | "screen" | "other";
  pipOn: boolean;
  pipSource: "laptop" | "phone" | "screen" | "other";
  orientation: DeskOrientation;
  layout: StageLayoutId | string;
  overlays: OverlayState;
  positions: OverlayPositions;
  savedAt: number;
};

const SCENES_KEY = "blyp.liveStudio.programScenes.v1";

function safeParse(raw: string | null): ProgramScene[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ProgramScene[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s) =>
        s &&
        typeof s.id === "string" &&
        typeof s.name === "string" &&
        s.overlays &&
        s.positions,
    );
  } catch {
    return [];
  }
}

export function loadProgramScenes(): ProgramScene[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParse(window.localStorage.getItem(SCENES_KEY));
  } catch {
    return [];
  }
}

export function saveProgramScenes(scenes: ProgramScene[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCENES_KEY, JSON.stringify(scenes.slice(0, 12)));
  } catch {
    /* quota */
  }
}

export function upsertProgramScene(
  list: ProgramScene[],
  next: Omit<ProgramScene, "id" | "savedAt"> & { id?: string },
): ProgramScene[] {
  const id =
    next.id ||
    `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const row: ProgramScene = {
    id,
    name: next.name.trim() || "Untitled scene",
    mediaMode: next.mediaMode,
    mainSource: next.mainSource,
    pipOn: next.pipOn,
    pipSource: next.pipSource,
    orientation: next.orientation,
    layout: next.layout,
    overlays: next.overlays,
    positions: next.positions,
    savedAt: Date.now(),
  };
  const without = list.filter((s) => s.id !== id && s.name !== row.name);
  return [row, ...without].slice(0, 12);
}

export function deleteProgramScene(
  list: ProgramScene[],
  id: string,
): ProgramScene[] {
  return list.filter((s) => s.id !== id);
}
