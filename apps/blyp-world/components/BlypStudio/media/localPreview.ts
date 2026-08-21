/**
 * Local camera/mic preview for BlypStudio Phase 2.
 * Mirrors getUserMedia constraints used by lib/ivsWebHost.ts but does NOT
 * import or call Stage publish / startIvsWebHostPublish.
 * Requires secure context: https:// or http://localhost.
 */

export type LocalPreviewHandle = {
  stream: MediaStream;
  stop: () => void;
};

export async function startLocalPreview(
  videoEl: HTMLVideoElement | null,
): Promise<LocalPreviewHandle> {
  if (typeof window === "undefined") {
    throw new Error("Local preview only runs in the browser");
  }
  if (!window.isSecureContext) {
    throw new Error("Camera requires HTTPS or localhost");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });

  if (videoEl) {
    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    void videoEl.play().catch(() => undefined);
  }

  return {
    stream,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      if (videoEl) videoEl.srcObject = null;
    },
  };
}

/** Display capture (game / desktop) — fail-soft at the call site. */
export async function startScreenShare(): Promise<LocalPreviewHandle> {
  if (typeof window === "undefined") {
    throw new Error("Screen share only runs in the browser");
  }
  if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
    throw new Error("Screen share is not available in this browser");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 } },
    audio: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ selfBrowserSurface: "exclude", preferCurrentTab: false } as any),
  });
  return {
    stream,
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
