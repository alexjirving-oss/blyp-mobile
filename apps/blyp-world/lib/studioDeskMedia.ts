/**
 * Laptop host media for /live/studio.
 * Camera-only, screen-only, screen-full + camera corner, or camera-full +
 * camera/screen corner — composited to a canvas stream when two layers.
 * Does not replace ivsWebHost — callers pass publishStream into startIvsWebHostPublish.
 */

export type DeskMediaMode = "camera" | "screen" | "screen-pip" | "camera-pip";
export type DeskOrientation = "landscape" | "portrait";

/** Extra layer when mode is camera-pip (main camera stays full-frame). */
export type DeskPipRequest =
  | { kind: "camera"; deviceId: string }
  | { kind: "screen"; existing?: MediaStream | null };

/** Encode ceiling for display capture / local PIP canvas — camera uses native fps. */
export const DESK_PUBLISH_FPS = 30;
export const DESK_PUBLISH_MAX_WIDTH = 1280;
export const DESK_PUBLISH_MAX_HEIGHT = 1280;

/**
 * Stage video must be getUserMedia / getDisplayMedia — never canvas.captureStream.
 * Canvas tracks have no deviceId and no displaySurface (phone then stalls / still-frames).
 */
export function isNativePublishVideoTrack(
  track: MediaStreamTrack | null | undefined,
): track is MediaStreamTrack {
  if (!track || track.kind !== "video" || track.readyState !== "live") {
    return false;
  }
  const settings = track.getSettings?.() ?? {};
  if (settings.deviceId) return true;
  if (settings.displaySurface) return true;
  if (settings.facingMode) return true;
  const label = track.label || "";
  if (/canvas/i.test(label)) return false;
  return /screen|display|window|web-contents/i.test(label);
}

export function nativePublishVideoTrack(
  stream: MediaStream | null | undefined,
): MediaStreamTrack | null {
  return stream?.getVideoTracks().find(isNativePublishVideoTrack) ?? null;
}

export type DeskMediaHandle = {
  mode: DeskMediaMode;
  orientation: DeskOrientation;
  previewStream: MediaStream;
  publishStream: MediaStream;
  /** Display capture only. Never a camera — Main · Screen must not treat cam as a share. */
  screenStream?: MediaStream | null;
  /** Corner source for director preview only — never Stage video. */
  pipPreviewStream?: MediaStream | null;
  stop: (opts?: { keepScreen?: boolean; keepCamera?: boolean }) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Serialize desk camera opens. Probe-then-reopen and Strict Mode double-mount
 * otherwise fight for the same USB webcam (NotReadableError).
 */
let deskMediaOpenChain: Promise<unknown> = Promise.resolve();

/** Cross-tab exclusive camera: only one LIVE Studio page may hold getUserMedia. */
export const STUDIO_CAM_CHANNEL = "blyp-studio-cam";
const STUDIO_CAM_STORAGE_KEY = "blyp-studio-cam";
const STUDIO_CAM_CLAIM_WAIT_MS = 450;
export const STUDIO_CAM_SIBLING_BANNER =
  "Another page still has the camera — close the other LIVE Studio tab";

type StudioCamLockMsg = {
  type: "claim" | "released";
  tabId: string;
  at: number;
};

type StudioCamPageBag = {
  clientId: string;
  posted: Set<string>;
  camera: MediaStream | null;
  pipCamera: MediaStream | null;
  screen: MediaStream | null;
  stopAt: number;
  gumAttempted: boolean;
};

function newStudioCamClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function newStudioCamPageBag(): StudioCamPageBag {
  return {
    clientId: newStudioCamClientId(),
    posted: new Set<string>(),
    camera: null,
    pipCamera: null,
    screen: null,
    stopAt: 0,
    gumAttempted: false,
  };
}

/** Module fallback (SSR). Browser copies share one bag on window so duplicate chunks cannot self-steal. */
const moduleCamBag = newStudioCamPageBag();

function camBag(): StudioCamPageBag {
  if (typeof window === "undefined") return moduleCamBag;
  const w = window as Window & { __blypStudioCamBag?: StudioCamPageBag };
  if (!w.__blypStudioCamBag) w.__blypStudioCamBag = moduleCamBag;
  return w.__blypStudioCamBag;
}

function studioCamClientId(): string {
  return camBag().clientId;
}

let camLockChannel: BroadcastChannel | null = null;
let camLockListening = false;
let camLockEpoch = 0;
let siblingSeenThisClaim = false;
let lastCamLockHandled = "";
const stolenListeners = new Set<() => void>();

export function mediaStreamHasLiveVideo(
  stream: MediaStream | null | undefined,
): boolean {
  return !!stream?.getVideoTracks().some((t) => t.readyState === "live");
}

async function withDeskMediaLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = deskMediaOpenChain.then(fn, fn);
  deskMediaOpenChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function stopStreamTracks(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  let hadLive = false;
  stream.getTracks().forEach((t) => {
    if (t.readyState === "live") hadLive = true;
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  });
  if (hadLive) camBag().stopAt = Date.now();
  return hadLive;
}

/** Stop leftover camera + display-share tracks this page still holds. */
async function stopHeldDeskTracks(): Promise<boolean> {
  const bag = camBag();
  const cam = bag.camera;
  const pip = bag.pipCamera;
  const screen = bag.screen;
  bag.camera = null;
  bag.pipCamera = null;
  bag.screen = null;
  return (
    stopStreamTracks(cam) || stopStreamTracks(pip) || stopStreamTracks(screen)
  );
}

function rememberDeskScreenStream(stream: MediaStream): MediaStream {
  camBag().screen = stream;
  return stream;
}

function rememberDeskCameraStream(stream: MediaStream): MediaStream {
  camBag().camera = stream;
  return stream;
}

function rememberDeskPipCameraStream(stream: MediaStream): MediaStream {
  camBag().pipCamera = stream;
  return stream;
}

function forgetDeskCameraStream(stream: MediaStream | null | undefined): void {
  const bag = camBag();
  if (stream && bag.camera === stream) {
    bag.camera = null;
  }
}

function forgetDeskPipCameraStream(stream: MediaStream | null | undefined): void {
  const bag = camBag();
  if (stream && bag.pipCamera === stream) {
    bag.pipCamera = null;
  }
}

function forgetDeskScreenStream(stream: MediaStream | null | undefined): void {
  const bag = camBag();
  if (stream && bag.screen === stream) {
    bag.screen = null;
  }
}

function parseStudioCamLockMsg(raw: unknown): StudioCamLockMsg | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (type !== "claim" && type !== "released") {
    return null;
  }
  if (typeof o.tabId !== "string" || !o.tabId) return null;
  const at = typeof o.at === "number" ? o.at : Date.now();
  return { type, tabId: o.tabId, at };
}

function camLockKey(msg: StudioCamLockMsg): string {
  return `${msg.type}:${msg.tabId}:${msg.at}`;
}

function postStudioCamLock(msg: StudioCamLockMsg): void {
  if (typeof window === "undefined") return;
  camBag().posted.add(camLockKey(msg));
  try {
    camLockChannel?.postMessage(msg);
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.setItem(STUDIO_CAM_STORAGE_KEY, JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}

/** True when this browsing context originated the message (same tab / duplicate chunk). */
function isOwnStudioCamLock(msg: StudioCamLockMsg): boolean {
  const bag = camBag();
  if (msg.tabId === bag.clientId) return true;
  if (bag.posted.has(camLockKey(msg))) return true;
  return false;
}

function handleStudioCamLockMsg(raw: unknown): void {
  const msg = parseStudioCamLockMsg(raw);
  if (!msg) return;
  // Never stop our own live tracks because we heard our own claim.
  if (isOwnStudioCamLock(msg)) return;
  const dedupe = camLockKey(msg);
  if (dedupe === lastCamLockHandled) return;
  lastCamLockHandled = dedupe;
  siblingSeenThisClaim = true;
  if (msg.type !== "claim") return;
  camLockEpoch += 1;
  const bag = camBag();
  const hasLive = mediaStreamHasLiveVideo(bag.camera);
  // Fresh load: do not stop anything before first getUserMedia.
  if (!bag.gumAttempted && !hasLive) {
    return;
  }
  void stopHeldDeskTracks();
  stolenListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
  postStudioCamLock({
    type: "released",
    tabId: studioCamClientId(),
    at: Date.now(),
  });
}

function ensureStudioCamLockListening(): void {
  if (camLockListening || typeof window === "undefined") return;
  camLockListening = true;
  try {
    camLockChannel = new BroadcastChannel(STUDIO_CAM_CHANNEL);
    camLockChannel.onmessage = (ev) => handleStudioCamLockMsg(ev.data);
  } catch {
    camLockChannel = null;
  }
  window.addEventListener("storage", (e) => {
    if (e.key !== STUDIO_CAM_STORAGE_KEY || !e.newValue) return;
    try {
      handleStudioCamLockMsg(JSON.parse(e.newValue));
    } catch {
      /* ignore */
    }
  });
}

/** True when another LIVE Studio tab answered this claim over the channel. */
export function studioCamSiblingSeen(): boolean {
  return siblingSeenThisClaim;
}

/**
 * Announce camera ownership. Other Studio tabs must stop tracks and reply
 * `released`. Pass waitMs ≈ 300–600 before getUserMedia so USB can unlock.
 */
export async function claimStudioCameraExclusive(
  waitMs: number = STUDIO_CAM_CLAIM_WAIT_MS,
): Promise<{ siblingSeen: boolean; stillHolder: boolean }> {
  ensureStudioCamLockListening();
  siblingSeenThisClaim = false;
  const epoch = ++camLockEpoch;
  const at = Date.now();
  postStudioCamLock({ type: "claim", tabId: studioCamClientId(), at });
  if (waitMs > 0) await sleep(waitMs);
  return {
    siblingSeen: siblingSeenThisClaim,
    stillHolder: epoch === camLockEpoch,
  };
}

/** Keep the channel for this tab; register UI teardown when another tab steals. */
export function installStudioCamLock(opts?: { onStolen?: () => void }): () => void {
  ensureStudioCamLockListening();
  const cb = opts?.onStolen;
  if (cb) stolenListeners.add(cb);
  return () => {
    if (cb) stolenListeners.delete(cb);
  };
}

export type GumDebugInfo = {
  status: "idle" | "ok" | "fail";
  name?: string;
  constraints?: string;
  message?: string;
};

let lastGumDebug: GumDebugInfo = { status: "idle" };

/** Last getUserMedia outcome for on-page Cam debug. */
export function getLastGumDebug(): GumDebugInfo {
  return lastGumDebug;
}

function gumErrorName(err: unknown): string {
  if (err instanceof DOMException && err.name) return err.name;
  if (err instanceof Error && err.name) return err.name;
  return "Error";
}

function gumErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err || "unknown");
}

/** Banner copy: real DOMException name + message. Never remap to Zoom/Chrome-busy. */
export function formatGumError(err: unknown, constraints?: string): string {
  const name = gumErrorName(err);
  const raw = gumErrorMessage(err);
  const core = raw.startsWith(name) ? raw : `${name}: ${raw}`;
  return constraints ? `${core} (${constraints})` : core;
}

/**
 * Banner copy: real DOMException name + message.
 * Sibling close-the-other-tab copy only when a *different* client answered.
 */
export function formatStudioCamOpenError(
  err: unknown,
  constraints?: string,
): string {
  if (err instanceof Error && err.message && !constraints) {
    return err.message;
  }
  return formatGumError(err, constraints);
}

function cameraOpenError(
  lastErr: unknown,
  _videoInputCount: number,
  constraints: string,
): Error {
  const name = gumErrorName(lastErr);
  const raw = gumErrorMessage(lastErr);
  lastGumDebug = {
    status: "fail",
    name,
    constraints,
    message: raw,
  };
  return new Error(formatGumError(lastErr, constraints));
}

/**
 * Prefer a deviceId only if it appears in a fresh enumerateDevices() list.
 * Stale / Continuity / unplugged ids must never reach getUserMedia.
 */
export async function resolveLiveVideoDeviceId(
  preferred?: string | null,
): Promise<string | null> {
  const listed = await requireDevices().enumerateDevices();
  return pickPreferredLaptopVideoId(listed, preferred ?? null);
}

/**
 * Score labels so USB/UVC/webcam beat IR / virtual / Continuity stubs.
 * `{ video: true }` often picks the stub first → NotReadableError.
 */
export function scoreLaptopCameraLabel(label: string): number {
  const low = label.toLowerCase().trim();
  if (!low) return 0;
  if (
    /virtual|\bobs\b|iriun|droidcam|epoccam|continuity|infrared|\bir\s*cam|many\s*cam|stub/.test(
      low,
    )
  ) {
    return -100;
  }
  if (
    /iphone|ipad|android\b|camo\b|\bmobile\b|phone\s*camera|fold\b|galaxy|samsung|phone\s*link/.test(
      low,
    )
  ) {
    return -50;
  }
  let score = 0;
  if (/\buvc\b/.test(low)) score += 50;
  if (/usb/.test(low)) score += 40;
  if (/webcam/.test(low)) score += 30;
  if (/logitech|razer|microsoft\s*life|surface\b/.test(low)) score += 20;
  if (
    /integrated|built[-\s]?in|internal\b|laptop|facetime|user[-\s]?facing/.test(
      low,
    )
  ) {
    score += 10;
  }
  return score;
}

/**
 * Pick a videoinput id from THIS enumerate snapshot only.
 * Caller-preferred id wins if it is in the list this millisecond;
 * otherwise the highest-scoring UVC/USB/webcam/integrated device.
 */
export function pickPreferredLaptopVideoId(
  listed: MediaDeviceInfo[],
  preferred?: string | null,
): string | null {
  const videos = listed.filter((d) => d.kind === "videoinput" && d.deviceId);
  if (videos.length === 0) return null;
  if (preferred && videos.some((d) => d.deviceId === preferred)) {
    return preferred;
  }
  const anyLabel = videos.some((d) => (d.label || "").trim());
  if (!anyLabel) return null;
  const ranked = [...videos].sort(
    (a, b) =>
      scoreLaptopCameraLabel(b.label || "") -
      scoreLaptopCameraLabel(a.label || ""),
  );
  const best = ranked.find((d) => scoreLaptopCameraLabel(d.label || "") >= 0);
  return (best ?? ranked[0])?.deviceId ?? null;
}

/** Laptop-friendly capture. Ideal 16:9 — never force 720×1280 (starves IVS). */
export function cameraVideoConstraints(
  deviceId?: string | null,
): MediaTrackConstraints {
  const size: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
  const id = String(deviceId || "").trim();
  if (!id) return size;
  return { ...size, deviceId: { exact: id } };
}

/**
 * Bind one deviceId only. Do not add width/height/frameRate here —
 * Windows Phone Link / Fold wireless cams then sit on
 * "Connecting to …" after getUserMedia already resolved.
 */
export function exactVideoConstraints(deviceId: string): MediaTrackConstraints {
  const id = String(deviceId || "").trim();
  return { deviceId: { exact: id } };
}

function trackDeviceId(stream: MediaStream | null | undefined): string | null {
  const id = stream?.getVideoTracks()[0]?.getSettings()?.deviceId;
  return id ? String(id) : null;
}

async function releaseHeldCamera(stream: MediaStream): Promise<void> {
  stopStreamTracks(stream);
  forgetDeskCameraStream(stream);
  await sleep(350);
}

/**
 * Video first, default mic second. Never `{ audio: true, video: camera }`
 * in one getUserMedia — Phone Link Fold then holds "Connecting to …"
 * forever while Chrome already reports gum ok.
 */
async function gumCameraWithMic(
  video: boolean | MediaTrackConstraints,
): Promise<MediaStream> {
  const devices = requireDevices();
  const videoOnly = await devices.getUserMedia({ video });
  try {
    const mic = await devices.getUserMedia({ audio: true, video: false });
    mic.getAudioTracks().forEach((t) => videoOnly.addTrack(t));
  } catch {
    /* IVS host synthesizes silence if this stream has no audio */
  }
  return videoOnly;
}

async function ensureMicOnStream(stream: MediaStream): Promise<void> {
  if (stream.getAudioTracks().some((t) => t.readyState === "live")) return;
  try {
    const mic = await requireDevices().getUserMedia({
      audio: true,
      video: false,
    });
    mic.getAudioTracks().forEach((t) => stream.addTrack(t));
  } catch {
    /* video-only is still publishable */
  }
}

/**
 * Open camera. Reuse a live track only when it is already the requested
 * deviceId. User picks (and laptop vs Continuity/phone) must use
 * `{ deviceId: { exact } }` — never `{ video: true }` after a device is known.
 */
async function getUserMediaCamera(deviceId?: string | null): Promise<MediaStream> {
  const wanted = String(deviceId || "").trim() || null;
  const devices = requireDevices();
  const held = camBag().camera;
  if (mediaStreamHasLiveVideo(held)) {
    const liveId = trackDeviceId(held);
    if (wanted) {
      if (liveId === wanted) {
        lastGumDebug = { status: "ok", constraints: "reuse-live" };
        await ensureMicOnStream(held!);
        return held!;
      }
      await releaseHeldCamera(held!);
    } else {
      const listed = await devices.enumerateDevices();
      const preferred = pickPreferredLaptopVideoId(listed, null);
      if (!preferred || liveId === preferred) {
        lastGumDebug = { status: "ok", constraints: "reuse-live" };
        await ensureMicOnStream(held!);
        return held!;
      }
      await releaseHeldCamera(held!);
    }
  }

  const bag = camBag();
  bag.gumAttempted = true;
  const listed = await devices.enumerateDevices();
  const boundId = pickPreferredLaptopVideoId(listed, wanted) || wanted;

  if (boundId) {
    const constraints = `exact:${boundId.slice(0, 8)}`;
    try {
      const stream = await gumCameraWithMic(exactVideoConstraints(boundId));
      lastGumDebug = { status: "ok", constraints };
      return rememberDeskCameraStream(stream);
    } catch (err) {
      throw cameraOpenError(err, listed.filter((d) => d.kind === "videoinput").length, constraints);
    }
  }

  try {
    const stream = await gumCameraWithMic(cameraVideoConstraints());
    const after = await devices.enumerateDevices();
    const preferred = pickPreferredLaptopVideoId(after, null);
    const gotId = trackDeviceId(stream);
    if (preferred && gotId && preferred !== gotId) {
      await releaseHeldCamera(stream);
      const constraints = `rebind-exact:${preferred.slice(0, 8)}`;
      try {
        const rebound = await gumCameraWithMic(exactVideoConstraints(preferred));
        lastGumDebug = { status: "ok", constraints };
        return rememberDeskCameraStream(rebound);
      } catch (err) {
        throw cameraOpenError(err, after.filter((d) => d.kind === "videoinput").length, constraints);
      }
    }
    lastGumDebug = { status: "ok", constraints: "{video:true}" };
    return rememberDeskCameraStream(stream);
  } catch (err) {
    throw cameraOpenError(err, 0, "{video:true}");
  }
}

/**
 * Second camera for a corner overlay. Never stops or replaces bag.camera.
 */
async function getUserMediaCameraPip(deviceId: string): Promise<MediaStream> {
  const wanted = String(deviceId || "").trim();
  if (!wanted) {
    throw new Error(
      "Need a second camera for PIP — this one is already Main. Pick another cam, or put a screen in the corner.",
    );
  }
  const mainId = trackDeviceId(camBag().camera);
  if (mainId && mainId === wanted) {
    throw new Error(
      "Need a second camera for PIP — this one is already Main. Pick another cam, or put a screen in the corner.",
    );
  }
  const heldPip = camBag().pipCamera;
  if (mediaStreamHasLiveVideo(heldPip) && trackDeviceId(heldPip) === wanted) {
    lastGumDebug = { status: "ok", constraints: "reuse-pip" };
    return heldPip!;
  }
  if (heldPip) {
    stopStreamTracks(heldPip);
    forgetDeskPipCameraStream(heldPip);
    await sleep(350);
  }

  const devices = requireDevices();
  const listed = await devices.enumerateDevices();
  const present = listed.some(
    (d) => d.kind === "videoinput" && d.deviceId === wanted,
  );
  if (!present) {
    throw new Error("That camera is no longer available");
  }
  const constraints = `pip-exact:${wanted.slice(0, 8)}`;
  try {
    const stream = await devices.getUserMedia({
      video: exactVideoConstraints(wanted),
    });
    lastGumDebug = { status: "ok", constraints };
    return rememberDeskPipCameraStream(stream);
  } catch (err) {
    throw cameraOpenError(
      err,
      listed.filter((d) => d.kind === "videoinput").length,
      constraints,
    );
  }
}

/**
 * After getUserMedia: hint + fps only.
 * Do not force 720×1280 — laptop sensors are 16:9; that size starves the
 * IVS encoder (phone hears mic, shows one still frame). Canvas tracks also
 * mute when applyConstraints sets width/height.
 */
async function constrainPublishVideoTrack(
  track: MediaStreamTrack,
  _orientation: DeskOrientation,
  hint: "motion" | "detail",
): Promise<void> {
  hintVideoTrack(track, hint);
  const settings = track.getSettings?.() ?? {};
  // Camera: native fps. Canvas captureStream: applyConstraints mutes the track.
  if (settings.deviceId || (!settings.deviceId && settings.displaySurface == null)) {
    return;
  }
  try {
    await track.applyConstraints({
      frameRate: { ideal: DESK_PUBLISH_FPS, max: DESK_PUBLISH_FPS },
    });
  } catch {
    /* device may reject fps */
  }
}

function requireDevices(): MediaDevices {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    throw new Error("Media devices are not available in this browser");
  }
  return navigator.mediaDevices;
}

async function openCamera(
  orientation: DeskOrientation,
  deviceId?: string | null,
): Promise<DeskMediaHandle> {
  const stream = await getUserMediaCamera(deviceId);
  // Solo camera: publish the raw MediaStream (no canvas) — lower latency.
  const vt = stream.getVideoTracks()[0];
  if (vt) await constrainPublishVideoTrack(vt, orientation, "motion");
  return {
    mode: "camera",
    orientation,
    previewStream: stream,
    publishStream: stream,
    stop: (opts) => {
      if (opts?.keepCamera) return;
      stopStreamTracks(stream);
      forgetDeskCameraStream(stream);
    },
  };
}

type CaptureControllerLike = {
  setFocusBehavior: (
    behavior:
      | "focus-captured-surface"
      | "focus-capturing-application"
      | "no-focus-change",
  ) => void;
};

type DisplayMediaOptions = DisplayMediaStreamOptions & {
  controller?: CaptureControllerLike;
};

/**
 * Screen/tab capture that keeps focus on Live Studio.
 * Chrome otherwise jumps to the shared Chrome tab after Share.
 */
async function getDisplayMediaStayInStudio(
  options: DisplayMediaStreamOptions,
): Promise<MediaStream> {
  const devices = requireDevices();
  if (typeof devices.getDisplayMedia !== "function") {
    throw new Error("Screen share is not available in this browser");
  }

  const CaptureControllerCtor = (
    typeof window !== "undefined"
      ? (
          window as unknown as {
            CaptureController?: new () => CaptureControllerLike;
          }
        ).CaptureController
      : undefined
  );

  let controller: CaptureControllerLike | null = null;
  const opts: DisplayMediaOptions = { ...options };

  if (CaptureControllerCtor) {
    controller = new CaptureControllerCtor();
    try {
      controller.setFocusBehavior("no-focus-change");
    } catch {
      /* ignore */
    }
    opts.controller = controller;
  }

  const stream = rememberDeskScreenStream(await devices.getDisplayMedia(opts));

  try {
    const surface = stream.getVideoTracks()[0]?.getSettings()?.displaySurface;
    if (controller && (surface === "browser" || surface === "window")) {
      controller.setFocusBehavior("focus-capturing-application");
    }
  } catch {
    try {
      controller?.setFocusBehavior("no-focus-change");
    } catch {
      /* ignore */
    }
  }

  try {
    window.focus();
  } catch {
    /* ignore */
  }

  return stream;
}

function createSilentAudioTrack(): MediaStreamTrack {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const constant = ctx.createConstantSource();
  constant.offset.value = 0;
  constant.connect(gain);
  gain.connect(dest);
  constant.start();
  void ctx.resume().catch(() => undefined);
  const track = dest.stream.getAudioTracks()[0];
  track.enabled = true;
  return track;
}

/** Mix mic + optional tab/system audio into one publish track. */
function mixAudioTracks(tracks: MediaStreamTrack[]): {
  track: MediaStreamTrack;
  stop: () => void;
} {
  const live = tracks.filter((t) => t.readyState === "live");
  if (live.length === 0) {
    const silent = createSilentAudioTrack();
    return {
      track: silent,
      stop: () => silent.stop(),
    };
  }
  if (live.length === 1) {
    return {
      track: live[0],
      stop: () => {
        /* caller owns source tracks */
      },
    };
  }

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const sources: MediaStreamAudioSourceNode[] = [];
  for (const t of live) {
    const src = ctx.createMediaStreamSource(new MediaStream([t]));
    src.connect(dest);
    sources.push(src);
  }
  void ctx.resume().catch(() => undefined);
  const mixed = dest.stream.getAudioTracks()[0];
  return {
    track: mixed,
    stop: () => {
      sources.forEach((s) => {
        try {
          s.disconnect();
        } catch {
          /* ignore */
        }
      });
      void ctx.close().catch(() => undefined);
    },
  };
}

function hintVideoTrack(track: MediaStreamTrack, hint: "motion" | "detail") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (track as any).contentHint = hint;
  } catch {
    /* ignore */
  }
}

const DISPLAY_VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280, max: DESK_PUBLISH_MAX_WIDTH },
  height: { ideal: 720, max: 720 },
  frameRate: { ideal: DESK_PUBLISH_FPS, max: DESK_PUBLISH_FPS },
};

function isDisplayCaptureStream(stream: MediaStream | null | undefined): boolean {
  const surface = stream?.getVideoTracks()[0]?.getSettings()?.displaySurface;
  return (
    surface === "monitor" ||
    surface === "window" ||
    surface === "browser" ||
    surface === "application"
  );
}

async function captureDisplayStayInStudio(): Promise<MediaStream> {
  return getDisplayMediaStayInStudio({
    video: DISPLAY_VIDEO_CONSTRAINTS,
    audio: {
      // Chrome: check “Share tab audio” for webpage / YouTube sound
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    } as MediaTrackConstraints,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...({ systemAudio: "include" } as any),
  });
}

/**
 * Stage video is the native camera/screen track. Never canvas.captureStream —
 * that encode path stall-then-jumps on phones. PIP overlay stays local-only
 * if the director UI draws it; it is not published.
 */
function composeLayeredProgram(opts: {
  orientation: DeskOrientation;
  background: MediaStream;
  overlay?: MediaStream | null;
  mode: "screen" | "screen-pip" | "camera-pip";
  displayStream?: MediaStream | null;
  camera?: MediaStream | null;
  pipCamera?: MediaStream | null;
  stopBackgroundOnFail: boolean;
}): DeskMediaHandle {
  const { orientation, background, overlay, mode, camera, pipCamera } = opts;
  const displayStream =
    opts.displayStream ??
    (isDisplayCaptureStream(background)
      ? background
      : isDisplayCaptureStream(overlay)
        ? overlay ?? null
        : null);

  const nativeVideo =
    nativePublishVideoTrack(background) ||
    nativePublishVideoTrack(overlay) ||
    nativePublishVideoTrack(camera);
  if (!nativeVideo) {
    if (pipCamera && pipCamera !== camera) {
      pipCamera.getTracks().forEach((t) => t.stop());
      forgetDeskPipCameraStream(pipCamera);
    }
    if (opts.stopBackgroundOnFail) {
      background.getTracks().forEach((t) => t.stop());
    }
    if (overlay && overlay !== background && overlay !== camera) {
      overlay.getTracks().forEach((t) => t.stop());
    }
    throw new Error("Stage video must be the camera or screen — not a canvas");
  }

  const audioBits: MediaStreamTrack[] = [];
  const seenAudio = new Set<MediaStreamTrack>();
  const pushAudio = (track: MediaStreamTrack | undefined) => {
    if (!track || seenAudio.has(track)) return;
    seenAudio.add(track);
    audioBits.push(track);
  };
  camera?.getAudioTracks().forEach((t) => pushAudio(t));
  displayStream?.getAudioTracks().forEach((t) => pushAudio(t));
  background.getAudioTracks().forEach((t) => pushAudio(t));
  overlay?.getAudioTracks().forEach((t) => pushAudio(t));

  const audioMix = mixAudioTracks(audioBits);
  const program = new MediaStream([nativeVideo, audioMix.track]);

  let stopped = false;
  const stopUnified = (stopOpts?: {
    keepScreen?: boolean;
    keepCamera?: boolean;
  }) => {
    if (stopped) return;
    stopped = true;
    audioMix.stop();
    if (!stopOpts?.keepCamera) {
      camera?.getTracks().forEach((t) => t.stop());
      if (camera) forgetDeskCameraStream(camera);
    }
    if (pipCamera && pipCamera !== camera) {
      pipCamera.getTracks().forEach((t) => t.stop());
      forgetDeskPipCameraStream(pipCamera);
    }
    if (!stopOpts?.keepScreen && displayStream) {
      displayStream.getTracks().forEach((t) => t.stop());
      forgetDeskScreenStream(displayStream);
    }
  };

  if (isDisplayCaptureStream(background)) {
    background.getVideoTracks()[0]?.addEventListener("ended", () => stopUnified());
  }

  const pipPreview =
    overlay && overlay !== background && mediaStreamHasLiveVideo(overlay)
      ? overlay
      : null;

  return {
    mode,
    orientation,
    previewStream: program,
    publishStream: program,
    screenStream:
      mode === "camera-pip"
        ? isDisplayCaptureStream(displayStream)
          ? displayStream
          : null
        : displayStream,
    pipPreviewStream: pipPreview,
    stop: stopUnified,
  };
}

function composeScreenProgram(opts: {
  orientation: DeskOrientation;
  screen: MediaStream;
  mode: "screen" | "screen-pip";
  camera?: MediaStream | null;
  stopScreenOnEnd: boolean;
}): DeskMediaHandle {
  return composeLayeredProgram({
    orientation: opts.orientation,
    background: opts.screen,
    overlay: opts.camera ?? null,
    mode: opts.mode,
    displayStream: opts.screen,
    camera: opts.camera ?? null,
    stopBackgroundOnFail: opts.stopScreenOnEnd,
  });
}

async function openScreen(
  orientation: DeskOrientation,
  existingScreen?: MediaStream | null,
): Promise<DeskMediaHandle> {
  const screen =
    existingScreen &&
    existingScreen.getVideoTracks().some((t) => t.readyState === "live")
      ? rememberDeskScreenStream(existingScreen)
      : await captureDisplayStayInStudio();

  const screenVideoTrack = screen.getVideoTracks()[0];
  if (screenVideoTrack) {
    await constrainPublishVideoTrack(screenVideoTrack, orientation, "detail");
  }

  let mic: MediaStream | null = null;
  try {
    mic = await requireDevices().getUserMedia({ audio: true, video: false });
  } catch {
    mic = null;
  }

  const stream = new MediaStream([
    ...screen.getVideoTracks(),
    ...screen.getAudioTracks(),
    ...(mic?.getAudioTracks() ?? []),
  ]);
  return {
    mode: "screen",
    orientation,
    previewStream: stream,
    publishStream: stream,
    screenStream: screen,
    stop: (opts) => {
      if (opts?.keepScreen) {
        mic?.getTracks().forEach((t) => t.stop());
        return;
      }
      stopStreamTracks(screen);
      forgetDeskScreenStream(screen);
      mic?.getTracks().forEach((t) => t.stop());
    },
  };
}

async function composeScreenPip(
  orientation: DeskOrientation,
  screen: MediaStream,
  stopScreenOnEnd: boolean,
  cameraDeviceId?: string | null,
): Promise<DeskMediaHandle> {
  let camera: MediaStream;
  try {
    camera = await getUserMediaCamera(cameraDeviceId);
    const camVt = camera.getVideoTracks()[0];
    if (camVt) await constrainPublishVideoTrack(camVt, orientation, "motion");
  } catch (err) {
    if (stopScreenOnEnd) {
      screen.getTracks().forEach((t) => t.stop());
    }
    throw err;
  }

  return composeScreenProgram({
    orientation,
    screen,
    mode: "screen-pip",
    camera,
    stopScreenOnEnd,
  });
}

async function openScreenPip(
  orientation: DeskOrientation,
  existingScreen?: MediaStream | null,
  cameraDeviceId?: string | null,
): Promise<DeskMediaHandle> {
  if (existingScreen?.getVideoTracks().some((t) => t.readyState === "live")) {
    return composeScreenPip(
      orientation,
      rememberDeskScreenStream(existingScreen),
      false,
      cameraDeviceId,
    );
  }
  const screen = await captureDisplayStayInStudio();
  const vt = screen.getVideoTracks()[0];
  if (vt) await constrainPublishVideoTrack(vt, orientation, "detail");
  return composeScreenPip(orientation, screen, true, cameraDeviceId);
}

async function openCameraPip(
  orientation: DeskOrientation,
  backgroundDeviceId: string | null | undefined,
  pip: DeskPipRequest,
): Promise<DeskMediaHandle> {
  const held = camBag().camera;
  const camera = mediaStreamHasLiveVideo(held)
    ? held!
    : await getUserMediaCamera(backgroundDeviceId);
  const camVt = camera.getVideoTracks()[0];
  if (camVt) await constrainPublishVideoTrack(camVt, orientation, "motion");

  let overlay: MediaStream;
  let pipCamera: MediaStream | null = null;
  let display: MediaStream | null = null;

  if (pip.kind === "camera") {
    overlay = await getUserMediaCameraPip(pip.deviceId);
    pipCamera = overlay;
    const ovt = overlay.getVideoTracks()[0];
    if (ovt) await constrainPublishVideoTrack(ovt, orientation, "motion");
  } else {
    const existing = pip.existing;
    overlay =
      existing && existing.getVideoTracks().some((t) => t.readyState === "live")
        ? rememberDeskScreenStream(existing)
        : await captureDisplayStayInStudio();
    display = overlay;
    const vt = overlay.getVideoTracks()[0];
    if (vt) await constrainPublishVideoTrack(vt, orientation, "detail");
  }

  return composeLayeredProgram({
    orientation,
    background: camera,
    overlay,
    mode: "camera-pip",
    displayStream: display,
    camera,
    pipCamera,
    stopBackgroundOnFail: false,
  });
}

export type VideoInputDevice = {
  deviceId: string;
  label: string;
  kind: "laptop" | "phone" | "other";
};

/**
 * Classify by device label. Continuity / Camo / mobile bridges → phone.
 * Built-in / common PC cams → laptop. Everything else → other.
 * resolveStudioCameras maps a second unlabeled camera to the Phone slot.
 */
export function classifyCameraLabel(label: string): VideoInputDevice["kind"] {
  const low = label.toLowerCase().trim();
  if (!low) return "other";

  // Mobile / Continuity / Phone Link — Fold labels are "Alexander's Z Fold7".
  if (
    /iphone|ipad|continuity|android\b|camo\b|iriun|droidcam|epoccam|nds?\s*camera|phone\s*camera|\bmobile\b|fold\b|galaxy|samsung|phone\s*link/.test(
      low,
    )
  ) {
    return "phone";
  }

  // Typical built-in / user-facing desktop cam.
  if (
    /integrated|facetime|laptop|built[-\s]?in|internal\b|hd\s*webcam|usb.?2\.0|logitech|razer|microsoft\s*life|surface\b|webcam|uvc|user[-\s]?facing/.test(
      low,
    )
  ) {
    return "laptop";
  }

  return "other";
}

/** Exclusive laptop / phone / other picks for Program Source (never share IDs when 2+ cams). */
export function resolveStudioCameras(devs: VideoInputDevice[]): {
  laptop: VideoInputDevice | null;
  phone: VideoInputDevice | null;
  other: VideoInputDevice[];
} {
  if (devs.length === 0) {
    return { laptop: null, phone: null, other: [] };
  }

  // One webcam: Laptop only. Do not alias Phone to the same id — selecting
  // Phone must not stop-and-reopen (or steal) the Main laptop camera.
  if (devs.length === 1) {
    return {
      laptop: { ...devs[0], kind: "laptop" },
      phone: null,
      other: [],
    };
  }

  const phones = devs.filter((d) => d.kind === "phone");
  const laptops = devs.filter((d) => d.kind === "laptop");
  const others = devs.filter((d) => d.kind === "other");

  // Prefer a true laptop/built-in; else first non-phone; else first device.
  const laptopBase =
    laptops[0] ||
    others[0] ||
    devs.find((d) => d.kind !== "phone") ||
    devs[0];

  // Phone = Continuity/Camo label, else any second camera (USB / virtual / etc.).
  const phoneBase =
    phones.find((d) => d.deviceId !== laptopBase.deviceId) ||
    devs.find((d) => d.deviceId !== laptopBase.deviceId) ||
    null;

  const laptop: VideoInputDevice = { ...laptopBase, kind: "laptop" };
  const phone: VideoInputDevice | null = phoneBase
    ? { ...phoneBase, kind: "phone" }
    : null;

  const other = devs.filter(
    (d) => d.deviceId !== laptop.deviceId && d.deviceId !== phone?.deviceId,
  );

  return { laptop, phone, other };
}

export function shortDeviceLabel(label: string, max = 36): string {
  const t = (label || "").trim();
  if (!t) return "Unnamed camera";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export type ListVideoInputDevicesOpts = {
  /**
   * When true (default), may briefly open+stop getUserMedia so labels populate.
   * Studio auto-preview must pass false — probe-then-reopen races the webcam
   * and surfaces as "Could not start video source" on hard refresh.
   */
  warmPermission?: boolean;
};

/** List cameras. Labels need prior permission (or warmPermission). */
export async function listVideoInputDevices(
  opts?: ListVideoInputDevicesOpts,
): Promise<VideoInputDevice[]> {
  const devices = requireDevices();
  const warmPermission = opts?.warmPermission !== false;

  const mapDevices = (all: MediaDeviceInfo[]): VideoInputDevice[] =>
    all
      .filter((d) => d.kind === "videoinput" && d.deviceId)
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${d.deviceId.slice(0, 6)}`,
        kind: classifyCameraLabel(d.label || ""),
      }));

  let all = await devices.enumerateDevices();
  const listed = mapDevices(all);
  const labelsMissing = listed.some((d) => !d.label || /^Camera /i.test(d.label));

  // Only warm when labels are empty — never when caller will open preview next.
  if (warmPermission && labelsMissing) {
    try {
      await withDeskMediaLock(async () => {
        const probe = await devices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 640, max: 1280 },
            height: { ideal: 360, max: 720 },
            frameRate: { ideal: DESK_PUBLISH_FPS, max: DESK_PUBLISH_FPS },
          },
        });
        probe.getTracks().forEach((t) => t.stop());
        // USB webcams often need a beat after stop before reopen.
        await sleep(350);
      });
      all = await devices.enumerateDevices();
    } catch {
      /* still return enumerate result */
    }
  }

  return mapDevices(all);
}

export async function openDeskMedia(
  mode: DeskMediaMode,
  orientation: DeskOrientation = "landscape",
  existingScreen?: MediaStream | null,
  cameraDeviceId?: string | null,
  pip?: DeskPipRequest | null,
): Promise<DeskMediaHandle> {
  return withDeskMediaLock(async () => {
    if (mode === "camera-pip") {
      if (!pip) {
        return openCamera(orientation, cameraDeviceId);
      }
      const pipSpec: DeskPipRequest =
        pip.kind === "screen"
          ? { kind: "screen", existing: pip.existing ?? existingScreen }
          : pip;
      return openCameraPip(orientation, cameraDeviceId, pipSpec);
    }
    if (mode === "screen-pip") {
      return openScreenPip(orientation, existingScreen, cameraDeviceId);
    }
    if (mode === "screen") return openScreen(orientation, existingScreen);
    // Reuse live same-page camera — never stop-then-immediately-reopen.
    return openCamera(orientation, cameraDeviceId);
  });
}

export function screenStreamIsLive(stream: MediaStream | null | undefined): boolean {
  return !!stream?.getVideoTracks().some((t) => t.readyState === "live");
}
