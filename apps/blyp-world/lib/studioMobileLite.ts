/**
 * Fold / phone browser heuristics for Studio + LIVE watch.
 * Coarse pointer and short viewports (incl. Flex/cover flips) get a lighter path:
 * no dual Clean Feed PIP, no Nuke VP9+alpha, leaner HLS buffers, no auto getUserMedia.
 */

export function isStudioMobileLite(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Z Fold inner screen is often >900px / shortEdge >720 — still mobile Chromium.
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    if (/Android|SamsungBrowser|Mobile/i.test(ua)) return true;
    if (window.matchMedia("(pointer: coarse)").matches) return true;
    if (window.matchMedia("(max-width: 900px)").matches) return true;
    // Fold cover / Flex: short edge often ≤ 720 CSS px even when "wide".
    const shortEdge = Math.min(window.innerWidth, window.innerHeight);
    if (shortEdge > 0 && shortEdge <= 720) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Prefer CSS/SVG Nuke fallback — keyed WEBM is ~9MB VP9+alpha. */
export function shouldPreferNukeFallback(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return true;
    }
  } catch {
    /* ignore */
  }
  return isStudioMobileLite();
}
