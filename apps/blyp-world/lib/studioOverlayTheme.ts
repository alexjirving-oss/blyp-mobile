/**
 * Custom CSS theme for the OBS clean-feed overlay page.
 */

export const OVERLAY_THEME_CSS_KEY = "blyp.liveStudio.overlayThemeCss.v1";

export const DEFAULT_OVERLAY_THEME_CSS = `/* Custom overlay theme — applied on /live/studio/overlay/
.tls-ov-title { letter-spacing: 0.06em; }
.tls-ov-gifters { backdrop-filter: blur(8px); }
`;

export function loadOverlayThemeCss(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(OVERLAY_THEME_CSS_KEY) || "";
  } catch {
    return "";
  }
}

export function saveOverlayThemeCss(css: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OVERLAY_THEME_CSS_KEY, css.slice(0, 12_000));
  } catch {
    /* ignore */
  }
}
