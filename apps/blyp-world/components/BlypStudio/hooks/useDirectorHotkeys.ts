"use client";

import { useEffect } from "react";
import { useStudioState } from "../store/StudioStateContext";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable=true]"));
}

/**
 * Global director hotkeys (ignored while typing in inputs).
 * Space → Spin · Shift+S → Auto-Fill · Shift+R → Reset · Numpad 1–9 → focus slot
 */
export function useDirectorHotkeys() {
  const {
    spinRoulette,
    autoFillSentinels,
    resetMatch,
    setFocusSlot,
    isRouletteSpinning,
  } = useStudioState();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      if (e.code === "Space") {
        e.preventDefault();
        if (!isRouletteSpinning) spinRoulette();
        return;
      }

      if (e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        autoFillSentinels();
        return;
      }

      if (e.shiftKey && (e.key === "R" || e.key === "r")) {
        e.preventDefault();
        resetMatch();
        return;
      }

      if (e.code.startsWith("Numpad") && e.code.length === 7) {
        const n = Number(e.code.slice(-1));
        if (n >= 1 && n <= 9) {
          e.preventDefault();
          setFocusSlot(n);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    autoFillSentinels,
    isRouletteSpinning,
    resetMatch,
    setFocusSlot,
    spinRoulette,
  ]);
}
