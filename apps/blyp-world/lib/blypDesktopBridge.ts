/**
 * Desktop shell bridge exposed by apps/blyp-desktop preload (window.blypDesktop).
 * Browser studio keeps working when this is undefined.
 */

export type BlypDesktopPickScreenOptions = {
  audio?: boolean;
  video?: boolean | MediaTrackConstraints;
};

export type BlypDesktopBridge = {
  isDesktop: true;
  platform: string;
  pickScreen: (options?: BlypDesktopPickScreenOptions) => Promise<MediaStream>;
};

declare global {
  interface Window {
    blypDesktop?: BlypDesktopBridge;
  }
}

export function getBlypDesktopBridge(): BlypDesktopBridge | undefined {
  if (typeof window === "undefined") return undefined;
  const bridge = window.blypDesktop;
  if (!bridge?.pickScreen) return undefined;
  return bridge;
}
