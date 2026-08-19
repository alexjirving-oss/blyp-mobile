const FS_FLAG = "blyp-studio-fs";

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

export async function requestStudioFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  if (document.fullscreenElement) return;
  const el = document.documentElement;
  const req =
    el.requestFullscreen?.bind(el) ||
    (
      el as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      }
    ).webkitRequestFullscreen?.bind(el);
  if (!req) return;
  try {
    await req();
  } catch {
    /* browser may reject without a gesture */
  }
}

export async function exitStudioFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
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
