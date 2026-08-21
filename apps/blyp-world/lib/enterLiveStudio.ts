const FS_FLAG = "blyp-studio-fs";

export const STUDIO_MAXIMIZED_CLASS = "tls-booth-maximized";

export function markStudioFullscreenIntent(): void {
  try {
    sessionStorage.setItem(FS_FLAG, "1");
  } catch {
    /* ignore */
  }
}

export function consumeStudioFullscreenIntent(): boolean {
  try {
    const want = sessionStorage.getItem(FS_FLAG) === "1";
    sessionStorage.removeItem(FS_FLAG);
    return want;
  } catch {
    return false;
  }
}

function requestElementFullscreen(el: HTMLElement): Promise<void> {
  const req =
    el.requestFullscreen?.bind(el) ||
    (
      el as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      }
    ).webkitRequestFullscreen?.bind(el);
  if (!req) return Promise.resolve();
  return Promise.resolve(req());
}

export function setStudioMaximizedClass(
  on: boolean,
  root?: HTMLElement | null,
): void {
  if (typeof document === "undefined") return;
  const el = root ?? document.querySelector<HTMLElement>(".tls-booth");
  if (!el) return;
  el.classList.toggle(STUDIO_MAXIMIZED_CLASS, on);
}

export function isStudioMaximized(root?: HTMLElement | null): boolean {
  if (typeof document === "undefined") return false;
  const el = root ?? document.querySelector<HTMLElement>(".tls-booth");
  if (!el) return false;
  return (
    document.fullscreenElement === el ||
    el.classList.contains(STUDIO_MAXIMIZED_CLASS)
  );
}

/** Browser fullscreen on the studio root (falls back to documentElement). */
export async function requestStudioFullscreen(
  root?: HTMLElement | null,
): Promise<void> {
  if (typeof document === "undefined") return;
  const el = root ?? document.documentElement;
  if (document.fullscreenElement === el) return;
  try {
    await requestElementFullscreen(el);
  } catch {
    /* browser may reject without a gesture — CSS class fallback handles layout */
  }
}

export async function exitStudioFullscreen(
  root?: HTMLElement | null,
): Promise<void> {
  if (typeof document === "undefined") return;
  setStudioMaximizedClass(false, root);
  if (!document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}

/** User-gesture entry: hide browser chrome, then open the booth. */
export async function enterLiveStudio(push?: (href: string) => void): Promise<void> {
  markStudioFullscreenIntent();
  await requestStudioFullscreen();
  if (push) push("/live/studio");
  else window.location.assign("/live/studio");
}
