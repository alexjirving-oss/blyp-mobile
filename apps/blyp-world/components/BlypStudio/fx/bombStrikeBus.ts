/**
 * Bomb / Nukemonkey strike FX for 3×3 grids (Studio Host+9 / Grid 3×3 / GRID9).
 * Hero clip: `/studio/fx/nukemonkey-keyed.webm` (VP9+alpha full-plate rembg —
 * scenic BG removed, hands + bomb kept; same look as inspect rembg_frame_003).
 * SFX via StudioAudioEngine.playBombBoom().
 *
 * Game / director code:
 *   import { playBombStrike } from "@/components/BlypStudio/fx/bombStrikeBus";
 *   playBombStrike(3); // cell 0..8, row-major
 *
 * Browser console (after Studio mounts):
 *   window.playBombStrike(0)
 */

export type BombStrikeEvent = {
  id: string;
  cellIndex: number;
  at: number;
};

type Listener = (event: BombStrikeEvent) => void;

const listeners = new Set<Listener>();
let seq = 0;

export function clampBombCell(cellIndex: number): number | null {
  if (!Number.isFinite(cellIndex)) return null;
  const i = Math.trunc(cellIndex);
  if (i < 0 || i > 8) return null;
  return i;
}

/** Fire the strike toward grid cell 0..8. Non-blocking; safe to retrigger. */
export function playBombStrike(cellIndex: number): void {
  const cell = clampBombCell(cellIndex);
  if (cell === null) return;
  const event: BombStrikeEvent = {
    id: `bomb-${Date.now()}-${++seq}`,
    cellIndex: cell,
    at: Date.now(),
  };
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      /* fail soft */
    }
  });
}

export function subscribeBombStrike(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

declare global {
  interface Window {
    playBombStrike?: typeof playBombStrike;
  }
}

export function installBombStrikeGlobal(): void {
  if (typeof window === "undefined") return;
  window.playBombStrike = playBombStrike;
}
