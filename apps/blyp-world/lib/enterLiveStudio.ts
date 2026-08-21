const FS_FLAG = "blyp-studio-fs";

export const STUDIO_MAXIMIZED_CLASS = "tls-booth-maximized";

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

let requestInFlight: Promise<boolean> | null = null;

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

/** YouTube-style target: <html>. Load-time auto-fullscreen is blocked without a gesture. */
export function studioFullscreenTarget(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.documentElement;
}

export function getStudioFullscreenElement(): Element | null {
  if (typeof document === "undefined") return null;
  const doc = document as WebkitDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function isNativeStudioFullscreen(): boolean {
  return getStudioFullscreenElement() != null;
}

function requestElementFullscreen(el: HTMLElement): Promise<void> {
  if (typeof el.requestFullscreen === "function") {
    return el.requestFullscreen({ navigationUI: "hide" });
  }
  const webkit = (el as WebkitElement).webkitRequestFullscreen;
  if (webkit) return Promise.resolve(webkit.call(el));
  return Promise.reject(new Error("Fullscreen API unavailable"));
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

/** True only when the Fullscreen API is active — never CSS-only maximize. */
export function isStudioMaximized(): boolean {
  return isNativeStudioFullscreen();
}

export function subscribeStudioFullscreenChange(handler: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const events = ["fullscreenchange", "webkitfullscreenchange"];
  for (const ev of events) {
    document.addEventListener(ev, handler);
  }
  return () => {
    for (const ev of events) {
      document.removeEventListener(ev, handler);
    }
  };
}

/**
 * YouTube-style Fullscreen API on document.documentElement so Chrome tabs and
 * the address bar hide. Browsers reject this on page load without a user gesture.
 * Do not call this on the same click as getDisplayMedia — it consumes that
 * activation and can end an active display capture.
 * Returns whether native fullscreen is active after the attempt.
 */
export async function requestStudioFullscreen(
  root?: HTMLElement | null,
): Promise<boolean> {
  if (typeof document === "undefined") return false;
  if (getStudioFullscreenElement()) return true;
  if (requestInFlight) return requestInFlight;

  requestInFlight = (async () => {
    const targets: HTMLElement[] = [];
    const html = studioFullscreenTarget();
    if (html) targets.push(html);
    if (root && root !== html) targets.push(root);
    for (const el of targets) {
      try {
        await requestElementFullscreen(el);
        if (getStudioFullscreenElement()) return true;
      } catch {
        /* NotAllowedError without a gesture, or capture/policy denial */
      }
    }
    return getStudioFullscreenElement() != null;
  })();

  try {
    return await requestInFlight;
  } finally {
    requestInFlight = null;
  }
}

export async function exitStudioFullscreen(
  root?: HTMLElement | null,
): Promise<void> {
  if (typeof document === "undefined") return;
  setStudioMaximizedClass(false, root);
  if (!getStudioFullscreenElement()) return;
  const doc = document as WebkitDocument;
  try {
    if (typeof document.exitFullscreen === "function") {
      await document.exitFullscreen();
    } else if (doc.webkitExitFullscreen) {
      await Promise.resolve(doc.webkitExitFullscreen());
    }
  } catch {
    /* ignore */
  }
}

/** User-gesture entry: request native fullscreen, then open the booth. */
export async function enterLiveStudio(push?: (href: string) => void): Promise<void> {
  markStudioFullscreenIntent();
  await requestStudioFullscreen();
  if (push) push("/live/studio");
  else window.location.assign("/live/studio");
}
