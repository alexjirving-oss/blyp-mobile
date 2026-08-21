"use client";

/**
 * Spotify Connect for Blyp LIVE Studio jukebox (browser PKCE + server-held refresh token).
 *
 * Env (Netlify / .env.local) — names only; never commit secrets:
 *   NEXT_PUBLIC_SPOTIFY_CLIENT_ID=   (public; also used if function env is unset)
 *   SPOTIFY_CLIENT_ID=               (Netlify function; same value as public ID)
 *   SPOTIFY_CLIENT_SECRET=           (optional; PKCE works without it)
 *   NEXT_PUBLIC_SPOTIFY_REDIRECT_URI= (optional; default current origin + /live/studio/)
 *
 * Dashboard redirect URIs must match exactly (trailing slash). Spotify rejects
 * `localhost` (insecure); local loopback must be 127.0.0.1 — they are distinct URIs:
 *   https://blyp.world/live/studio/
 *   http://127.0.0.1:3000/live/studio/
 */

import { studioAudio } from "@/components/BlypStudio/audio/StudioAudioEngine";
import { loadStoredSession, refreshSessionIfNeeded } from "./cognito";
import { siteUrl } from "./env";

const CONNECT_RESUME_PARAM = "blyp_spotify_connect";
const PKCE_KEY = "blyp.liveStudio.spotify.pkce.v1";
const LEGACY_TOKEN_KEY = "blyp.liveStudio.spotify.tokens.v1";
const QUEUE_KEY = "blyp.liveStudio.spotify.mockQueue.v1";

/** Spotify treats localhost and 127.0.0.1 as different redirect URIs. */
function rewriteLocalhostHostname(url: URL): URL {
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }
  return url;
}

const SCOPES = [
  "user-read-email",
  "user-read-private",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "streaming",
  "playlist-read-private",
  "playlist-read-collaborative",
].join(" ");

export type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  artists: string;
  albumArt: string | null;
  externalUrl: string;
};

export type SpotifyLinkStatus = {
  configured: boolean;
  linked: boolean;
  displayName: string | null;
  product: string | null;
};

type AccessCache = {
  token: string;
  expiresAt: number;
};

let accessCache: AccessCache | null = null;
let cachedClientId = "";
let lastLinkStatus: SpotifyLinkStatus | null = null;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  u8.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest("SHA-256", data);
}

export function getSpotifyClientId(): string {
  return String(
    cachedClientId ||
      process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ||
      process.env.NEXT_PUBLIC_EXPO_PUBLIC_SPOTIFY_CLIENT_ID ||
      "",
  ).trim();
}

export function getSpotifyRedirectUri(): string {
  const fromEnv = String(process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI || "").trim();
  if (fromEnv) {
    try {
      return rewriteLocalhostHostname(new URL(fromEnv)).toString();
    } catch {
      return fromEnv;
    }
  }
  if (typeof window !== "undefined") {
    const origin = rewriteLocalhostHostname(new URL(window.location.origin)).origin;
    return `${origin}/live/studio/`;
  }
  return `${siteUrl}/live/studio/`;
}

export function isSpotifyConfigured(): boolean {
  return getSpotifyClientId().length > 0;
}

export function spotifySetupHint(): string {
  return (
    "Connect isn’t configured. Set NEXT_PUBLIC_SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_ID " +
    "in Netlify (rebuild web), add redirect URIs in Spotify Developer Dashboard, then Connect again."
  );
}

function clearLegacyBrowserTokens(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function spotifyLinkBases(): string[] {
  const urls: string[] = [];
  if (typeof window !== "undefined") {
    urls.push(`${window.location.origin}/api/spotify`);
    if (siteUrl && !urls.includes(`${siteUrl}/api/spotify`)) {
      urls.push(`${siteUrl}/api/spotify`);
    }
  } else if (siteUrl) {
    urls.push(`${siteUrl}/api/spotify`);
  }
  return urls;
}

async function cognitoIdToken(): Promise<string | null> {
  const session = await refreshSessionIfNeeded(loadStoredSession());
  return session?.idToken || null;
}

async function linkFetch(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean },
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.auth !== false) {
    const token = await cognitoIdToken();
    if (!token) {
      const err = new Error("Log in to Connect Spotify");
      (err as Error & { statusCode?: number }).statusCode = 401;
      throw err;
    }
    headers.Authorization = `Bearer ${token}`;
  }
  let last: Response | null = null;
  let lastErr = "";
  for (const base of spotifyLinkBases()) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: init.method || "GET",
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      last = res;
      if (res.status === 404) {
        lastErr = "404";
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (last) return last;
  throw new Error(lastErr || "Spotify link API unreachable");
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

export async function getSpotifyLinkStatus(): Promise<SpotifyLinkStatus> {
  clearLegacyBrowserTokens();
  const token = loadStoredSession()?.idToken;
  try {
    const res = await linkFetch("?action=status", { method: "GET", auth: !!token });
    const json = await readJson<{
      configured?: boolean;
      clientId?: string;
      linked?: boolean;
      displayName?: string | null;
      product?: string | null;
      error?: string;
    }>(res);
    if (json.clientId) cachedClientId = json.clientId;
    const status: SpotifyLinkStatus = !res.ok
      ? {
          configured: isSpotifyConfigured(),
          linked: false,
          displayName: null,
          product: null,
        }
      : {
          configured: !!json.configured,
          linked: !!json.linked,
          displayName: json.displayName || null,
          product: json.product || null,
        };
    lastLinkStatus = status;
    return status;
  } catch {
    const status: SpotifyLinkStatus = {
      configured: isSpotifyConfigured(),
      linked: false,
      displayName: null,
      product: null,
    };
    lastLinkStatus = status;
    return status;
  }
}

export async function beginSpotifyAuth(): Promise<{ ok: boolean; error?: string }> {
  if (typeof window === "undefined") {
    return { ok: false, error: "Connect Spotify in the browser" };
  }
  // PKCE lives in localStorage (origin-scoped). Bounce localhost → 127.0.0.1
  // before storing the verifier so Spotify's callback hits the same origin.
  if (window.location.hostname === "localhost") {
    const next = rewriteLocalhostHostname(new URL(window.location.href));
    next.searchParams.set(CONNECT_RESUME_PARAM, "1");
    window.location.replace(next.toString());
    return { ok: true };
  }
  const signedIn = await cognitoIdToken();
  if (!signedIn) {
    return { ok: false, error: "Log in to Connect Spotify" };
  }
  if (!getSpotifyClientId()) {
    try {
      const status = await getSpotifyLinkStatus();
      if (!status.configured) {
        return { ok: false, error: spotifySetupHint() };
      }
    } catch {
      return { ok: false, error: spotifySetupHint() };
    }
  }
  const clientId = getSpotifyClientId();
  if (!clientId) {
    return { ok: false, error: spotifySetupHint() };
  }
  const verifierBytes = crypto.getRandomValues(new Uint8Array(64));
  const verifier = b64url(verifierBytes);
  const challenge = b64url(await sha256(verifier));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  try {
    window.localStorage.setItem(
      PKCE_KEY,
      JSON.stringify({ verifier, state, at: Date.now() }),
    );
  } catch {
    return { ok: false, error: "Could not store PKCE verifier" };
  }
  const redirectUri = getSpotifyRedirectUri();
  const url = new URL("https://accounts.spotify.com/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  window.location.assign(url.toString());
  return { ok: true };
}

export async function completeSpotifyAuthFromUrl(
  href?: string,
): Promise<{ handled: boolean; error?: string }> {
  if (typeof window === "undefined") return { handled: false };
  const url = new URL(href || window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (!code && !err) {
    if (url.searchParams.get(CONNECT_RESUME_PARAM) === "1") {
      url.searchParams.delete(CONNECT_RESUME_PARAM);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      void beginSpotifyAuth();
    }
    return { handled: false };
  }
  if (err) {
    scrubAuthParams(url);
    return { handled: true, error: `Spotify auth: ${err}` };
  }
  if (!code) {
    scrubAuthParams(url);
    return { handled: true, error: "Spotify auth missing code" };
  }
  let pkce: { verifier?: string; state?: string } | null = null;
  try {
    pkce = JSON.parse(window.localStorage.getItem(PKCE_KEY) || "null");
  } catch {
    pkce = null;
  }
  if (!pkce?.verifier || !state || state !== pkce.state) {
    scrubAuthParams(url);
    return { handled: true, error: "Spotify PKCE state mismatch — try Connect again" };
  }
  try {
    const res = await linkFetch("?action=exchange", {
      method: "POST",
      auth: true,
      body: {
        code,
        codeVerifier: pkce.verifier,
        redirectUri: getSpotifyRedirectUri(),
      },
    });
    const json = await readJson<{
      accessToken?: string;
      expiresAt?: number;
      error?: string;
    }>(res);
    window.localStorage.removeItem(PKCE_KEY);
    scrubAuthParams(url);
    clearLegacyBrowserTokens();
    if (!res.ok || !json.accessToken) {
      return {
        handled: true,
        error: json.error || "Spotify token exchange failed",
      };
    }
    accessCache = {
      token: json.accessToken,
      expiresAt: Number(json.expiresAt || Date.now() + 3600_000),
    };
    return { handled: true };
  } catch (e) {
    window.localStorage.removeItem(PKCE_KEY);
    scrubAuthParams(url);
    return {
      handled: true,
      error: e instanceof Error ? e.message : "Spotify token exchange failed",
    };
  }
}

function scrubAuthParams(url: URL): void {
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (
    !forceRefresh &&
    accessCache?.token &&
    Date.now() < accessCache.expiresAt - 60_000
  ) {
    return accessCache.token;
  }
  const res = await linkFetch(
    forceRefresh ? "?action=token&refresh=1" : "?action=token",
    {
      method: "GET",
      auth: true,
    },
  );
  const json = await readJson<{
    accessToken?: string;
    expiresAt?: number;
    error?: string;
  }>(res);
  if (!res.ok || !json.accessToken) {
    accessCache = null;
    throw new Error(json.error || "Connect Spotify first");
  }
  accessCache = {
    token: json.accessToken,
    expiresAt: Number(json.expiresAt || Date.now() + 3600_000),
  };
  return accessCache.token;
}

async function spotifyApiFetch<T>(
  path: string,
  init?: { method?: string; body?: unknown },
  retried = false,
): Promise<T> {
  const accessToken = await getAccessToken(retried);
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method: init?.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 && !retried) {
    accessCache = null;
    return spotifyApiFetch<T>(path, init, true);
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Spotify API ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function disconnectSpotify(): Promise<void> {
  accessCache = null;
  clearLegacyBrowserTokens();
  await disconnectStudioSpotifyPlayer();
  try {
    await linkFetch("?action=disconnect", { method: "POST", auth: true });
  } catch {
    /* local cache already cleared */
  }
}

export async function searchSpotifyTracks(query: string): Promise<SpotifyTrack[]> {
  const q = query.trim();
  if (!q) return [];
  const data = await spotifyApiFetch<{
    tracks?: {
      items?: Array<{
        id: string;
        uri: string;
        name: string;
        artists?: Array<{ name: string }>;
        album?: { images?: Array<{ url: string }> };
        external_urls?: { spotify?: string };
      }>;
    };
  }>(`/search?type=track&limit=8&q=${encodeURIComponent(q)}`);
  return (data.tracks?.items || [])
    .filter((t): t is NonNullable<typeof t> => !!t?.id && !!t?.uri)
    .map((t) => ({
      id: String(t.id),
      uri: String(t.uri),
      name: String(t.name || "Track"),
      artists: (t.artists || []).map((a) => a.name).filter(Boolean).join(", "),
      albumArt: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || null,
      externalUrl: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    }));
}

export async function listSpotifyPlaylists(): Promise<
  { id: string; name: string; tracks: number }[]
> {
  const data = await spotifyApiFetch<{
    items?: Array<{ id: string; name: string; tracks?: { total?: number } }>;
  }>("/me/playlists?limit=10");
  return (data.items || []).map((p) => ({
    id: p.id,
    name: p.name,
    tracks: Number(p.tracks?.total) || 0,
  }));
}

export async function playlistTracks(playlistId: string): Promise<SpotifyTrack[]> {
  const data = await spotifyApiFetch<{
    items?: Array<{
      track?: {
        id?: string;
        uri?: string;
        name?: string;
        artists?: Array<{ name: string }>;
        album?: { images?: Array<{ url: string }> };
        external_urls?: { spotify?: string };
      } | null;
    }>;
  }>(`/playlists/${encodeURIComponent(playlistId)}/tracks?limit=20`);
  return (data.items || [])
    .map((row) => row.track)
    .filter((t): t is NonNullable<typeof t> => !!t?.id && !!t.uri)
    .map((t) => ({
      id: t.id!,
      uri: t.uri!,
      name: t.name || "Track",
      artists: (t.artists || []).map((a) => a.name).join(", "),
      albumArt: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || null,
      externalUrl:
        t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
    }));
}

function readQueue(): SpotifyTrack[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SpotifyTrack[];
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function writeQueue(tracks: SpotifyTrack[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(tracks.slice(0, 20)));
  } catch {
    /* ignore */
  }
}

export function loadLocalSpotifyQueue(): SpotifyTrack[] {
  return readQueue();
}

export function saveLocalSpotifyQueue(tracks: SpotifyTrack[]): void {
  writeQueue(tracks);
}

export async function loadSpotifyQueue(): Promise<SpotifyTrack[]> {
  try {
    const res = await linkFetch("?action=queue", { method: "GET", auth: true });
    const json = await readJson<{ tracks?: SpotifyTrack[] }>(res);
    if (res.ok && Array.isArray(json.tracks)) {
      const tracks = json.tracks.filter((t) => t?.id && t?.uri).slice(0, 40);
      saveLocalSpotifyQueue(tracks);
      return tracks;
    }
  } catch {
    /* fall through to local */
  }
  return loadLocalSpotifyQueue();
}

export async function saveSpotifyQueue(tracks: SpotifyTrack[]): Promise<void> {
  const next = tracks.filter((t) => t?.id && t?.uri).slice(0, 40);
  saveLocalSpotifyQueue(next);
  try {
    await linkFetch("?action=queue", { method: "POST", auth: true, body: { tracks: next } });
  } catch {
    /* local already saved */
  }
}

export type SpotifyPlayResult = {
  ok: boolean;
  mode: "sdk" | "api";
  message: string;
};

export type StudioSpotifyPlayback = {
  deviceId: string | null;
  ready: boolean;
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  track: SpotifyTrack | null;
  error: string | null;
};

type SdkTrack = {
  id?: string;
  uri?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  album?: { images?: Array<{ url?: string }> };
};

type SdkPlayerState = {
  paused?: boolean;
  position?: number;
  duration?: number;
  track_window?: { current_track?: SdkTrack };
};

type SpotifySdkPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (payload: unknown) => void) => boolean;
  removeListener: (event: string, cb?: (payload: unknown) => void) => boolean;
  getCurrentState: () => Promise<SdkPlayerState | null>;
  setVolume: (n: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  activateElement?: () => Promise<void>;
};

const STUDIO_DEVICE_NAME = "Blyp Studio";
const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

let sdkPlayer: SpotifySdkPlayer | null = null;
let sdkDeviceId: string | null = null;
const sdkReadyWaiters: Array<(id: string) => void> = [];
let sdkVolume = 0.7;
let lastPlayback: StudioSpotifyPlayback = {
  deviceId: null,
  ready: false,
  paused: true,
  position: 0,
  duration: 0,
  volume: 0.7,
  track: null,
  error: null,
};
const playbackListeners = new Set<(s: StudioSpotifyPlayback) => void>();

function emitPlayback(partial: Partial<StudioSpotifyPlayback>) {
  lastPlayback = { ...lastPlayback, ...partial };
  playbackListeners.forEach((cb) => cb(lastPlayback));
}

export function getStudioSpotifyPlayback(): StudioSpotifyPlayback {
  return lastPlayback;
}

export function subscribeStudioSpotifyPlayback(
  cb: (s: StudioSpotifyPlayback) => void,
): () => void {
  playbackListeners.add(cb);
  cb(lastPlayback);
  return () => {
    playbackListeners.delete(cb);
  };
}

function trackFromSdk(raw: SdkTrack | undefined): SpotifyTrack | null {
  const id = String(raw?.id || "").trim();
  const uri = String(raw?.uri || "").trim();
  if (!id || !uri) return null;
  const artists = Array.isArray(raw?.artists)
    ? raw.artists.map((a: { name?: string }) => a.name).filter(Boolean).join(", ")
    : "";
  const art =
    raw?.album?.images?.[1]?.url ||
    raw?.album?.images?.[0]?.url ||
    raw?.album?.images?.[2]?.url ||
    null;
  return {
    id,
    uri,
    name: String(raw?.name || "Track"),
    artists,
    albumArt: typeof art === "string" ? art : null,
    externalUrl: `https://open.spotify.com/track/${id}`,
  };
}

function loadSpotifySdk(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Spotify player needs the browser"));
  }
  const w = window as Window & {
    Spotify?: { Player: new (opts: Record<string, unknown>) => SpotifySdkPlayer };
    onSpotifyWebPlaybackSDKReady?: () => void;
  };
  if (w.Spotify?.Player) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const prev = w.onSpotifyWebPlaybackSDKReady;
    w.onSpotifyWebPlaybackSDKReady = () => {
      try {
        prev?.();
      } catch {
        /* ignore */
      }
      resolve();
    };
    if (!document.querySelector(`script[src="${SDK_SRC}"]`)) {
      const s = document.createElement("script");
      s.src = SDK_SRC;
      s.async = true;
      s.onerror = () => reject(new Error("Spotify Web Playback SDK failed to load"));
      document.head.appendChild(s);
    }
    window.setTimeout(() => {
      if (w.Spotify?.Player) resolve();
    }, 4000);
  });
}

let tabAudioStream: MediaStream | null = null;
let tabCaptureBusy = false;

export const TAB_AUDIO_REQUIRED =
  "Share this Chrome tab and tick “Also share tab audio”. Without that, GO LIVE will not start while Spotify is connected.";

export function rememberSpotifyLinkStatus(status: SpotifyLinkStatus | null) {
  if (status) lastLinkStatus = status;
}

export function isStudioSpotifyLinked(): boolean {
  if (lastLinkStatus?.linked) return true;
  if (sdkDeviceId) return true;
  if (lastPlayback.ready && lastPlayback.deviceId) return true;
  return false;
}

export function isStudioSpotifyAudible(): boolean {
  return !!lastPlayback.track && !lastPlayback.paused;
}

export function hasStudioTabAudio(): boolean {
  return !!tabAudioStream?.getAudioTracks().some((t) => t.readyState === "live");
}

function stopTabAudio() {
  if (!tabAudioStream) return;
  tabAudioStream.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  });
  tabAudioStream = null;
}

/**
 * Tab-audio mix for Spotify DRM. Video from this picker is stopped immediately
 * and must never become Stage video. Does not register as desk screen-share.
 */
export async function captureStudioTabAudio(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    emitPlayback({ error: TAB_AUDIO_REQUIRED });
    return false;
  }
  if (hasStudioTabAudio() && studioAudio.attachMusicStream(tabAudioStream)) {
    emitPlayback({ error: null });
    return true;
  }
  if (tabCaptureBusy) return false;
  tabCaptureBusy = true;
  try {
    const CaptureControllerCtor = (
      window as unknown as {
        CaptureController?: new () => {
          setFocusBehavior: (b: string) => void;
        };
      }
    ).CaptureController;
    const opts = {
      video: true,
      audio: true,
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      systemAudio: "exclude",
      surfaceSwitching: "exclude",
      monitorTypeSurfaces: "exclude",
    } as DisplayMediaStreamOptions & {
      controller?: { setFocusBehavior: (b: string) => void };
    };
    if (CaptureControllerCtor) {
      const controller = new CaptureControllerCtor();
      try {
        controller.setFocusBehavior("no-focus-change");
      } catch {
        /* ignore */
      }
      opts.controller = controller;
    }
    const stream = await navigator.mediaDevices.getDisplayMedia(opts);
    stream.getVideoTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* video must never go to Stage */
      }
    });
    const audio = stream.getAudioTracks().filter((t) => t.readyState === "live");
    if (!audio.length) {
      stream.getTracks().forEach((t) => t.stop());
      emitPlayback({ error: TAB_AUDIO_REQUIRED });
      return false;
    }
    stopTabAudio();
    tabAudioStream = new MediaStream(audio);
    audio[0].addEventListener("ended", () => {
      tabAudioStream = null;
      studioAudio.detachMusicElement();
      if (isStudioSpotifyAudible()) {
        emitPlayback({ error: TAB_AUDIO_REQUIRED });
      }
    });
    const attached = studioAudio.attachMusicStream(tabAudioStream);
    emitPlayback({ error: attached ? null : TAB_AUDIO_REQUIRED });
    return attached;
  } catch {
    emitPlayback({ error: TAB_AUDIO_REQUIRED });
    return false;
  } finally {
    tabCaptureBusy = false;
  }
}

/**
 * Local jukebox files mix in AudioContext (no picker).
 * Spotify IVS mix-out needs tab-share — prompt only from explicit clicks
 * (Share tab audio / GO LIVE). Play uses Web Playback SDK locally.
 */
export async function ensureJukeboxPublishMix(opts?: {
  allowTabCapture?: boolean;
}): Promise<boolean> {
  if (hasStudioTabAudio() && studioAudio.attachMusicStream(tabAudioStream)) {
    return true;
  }
  if (studioAudio.isMusicPlaying() && studioAudio.currentBed()) {
    return true;
  }
  if (opts?.allowTabCapture === false) return false;
  return captureStudioTabAudio();
}

/** GO LIVE: if Spotify is connected, tab-audio must already be live or this prompts. */
export async function armSpotifyTabAudioForLive(): Promise<boolean> {
  if (!lastLinkStatus) {
    await getSpotifyLinkStatus();
  }
  if (!isStudioSpotifyLinked()) return true;
  if (hasStudioTabAudio() && studioAudio.attachMusicStream(tabAudioStream)) {
    return true;
  }
  return captureStudioTabAudio();
}

async function transferToStudio(deviceId: string) {
  await spotifyApiFetch("/me/player", {
    method: "PUT",
    body: { device_ids: [deviceId], play: false },
  });
}

export async function ensureStudioSpotifyPlayer(): Promise<string> {
  if (sdkDeviceId && sdkPlayer) return sdkDeviceId;
  await loadSpotifySdk();
  const w = window as Window & {
    Spotify?: { Player: new (opts: Record<string, unknown>) => SpotifySdkPlayer };
  };
  if (!w.Spotify?.Player) {
    throw new Error("Spotify player is not available");
  }
  if (!sdkPlayer) {
    sdkPlayer = new w.Spotify.Player({
      name: STUDIO_DEVICE_NAME,
      getOAuthToken: (cb: (token: string) => void) => {
        void getAccessToken()
          .then((token) => cb(token))
          .catch(() => cb(""));
      },
      volume: sdkVolume,
    });
    sdkPlayer.addListener("ready", (payload) => {
      const id = String(
        (payload as { device_id?: string } | null)?.device_id || "",
      ).trim();
      if (!id) return;
      sdkDeviceId = id;
      emitPlayback({ deviceId: id, ready: true, error: lastPlayback.error });
      sdkReadyWaiters.splice(0).forEach((fn) => fn(id));
    });
    sdkPlayer.addListener("not_ready", () => {
      sdkDeviceId = null;
      emitPlayback({ deviceId: null, ready: false });
    });
    sdkPlayer.addListener("player_state_changed", (raw) => {
      const state = raw as SdkPlayerState | null;
      if (!state) {
        emitPlayback({ paused: true });
        return;
      }
      const sdkTrack = trackFromSdk(state.track_window?.current_track);
      emitPlayback({
        paused: !!state.paused,
        position: Number(state.position) || 0,
        duration: Number(state.duration) || 0,
        ...(sdkTrack ? { track: sdkTrack } : {}),
        error: hasStudioTabAudio()
          ? null
          : lastPlayback.error,
      });
    });
    sdkPlayer.addListener("initialization_error", (e) => {
      const msg = (e as { message?: string } | null)?.message;
      emitPlayback({ error: msg || "Spotify player failed to start" });
    });
    sdkPlayer.addListener("authentication_error", (e) => {
      const msg = (e as { message?: string } | null)?.message;
      emitPlayback({
        error: msg || "Spotify auth failed — Disconnect and Connect again",
      });
    });
    sdkPlayer.addListener("account_error", (e) => {
      const msg = (e as { message?: string } | null)?.message;
      emitPlayback({
        error: msg || "Spotify Premium is required for the booth player",
      });
    });
    const ok = await sdkPlayer.connect();
    if (!ok) throw new Error("Could not start Blyp Studio Spotify player");
    if (sdkPlayer.activateElement) {
      await sdkPlayer.activateElement().catch(() => undefined);
    }
  }
  if (sdkDeviceId) return sdkDeviceId;
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(
      () => reject(new Error("Spotify booth player timed out")),
      12000,
    );
    sdkReadyWaiters.push((id) => {
      window.clearTimeout(t);
      resolve(id);
    });
  });
}

async function playOnStudioDevice(uris: string[], offsetUri?: string) {
  const tabMixed = hasStudioTabAudio();
  const deviceId = await ensureStudioSpotifyPlayer();
  studioAudio.stopMusic();
  try {
    await transferToStudio(deviceId);
  } catch {
    /* play with device_id still works */
  }
  const body: { uris: string[]; offset?: { uri: string } } = { uris };
  if (offsetUri && uris.includes(offsetUri)) {
    body.offset = { uri: offsetUri };
  }
  await spotifyApiFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    body,
  });
  emitPlayback({
    ready: true,
    deviceId,
    paused: false,
    error: tabMixed ? null : TAB_AUDIO_REQUIRED,
  });
}

/** Play in the Studio booth player. Never opens Spotify.com. */
export async function playSpotifyTrack(
  track: SpotifyTrack,
  queue: SpotifyTrack[] = [],
): Promise<SpotifyPlayResult> {
  const list = [track, ...queue.filter((t) => t.id !== track.id)].slice(0, 40);
  await playOnStudioDevice(
    list.map((t) => t.uri),
    track.uri,
  );
  emitPlayback({ track, paused: false });
  return { ok: true, mode: "sdk", message: `Playing · ${track.name}` };
}

export async function pauseSpotifyPlayback(): Promise<void> {
  try {
    if (sdkPlayer) await sdkPlayer.pause();
    else await spotifyApiFetch("/me/player/pause", { method: "PUT" });
    emitPlayback({ paused: true });
  } catch {
    /* soft-fail */
  }
}

export async function resumeSpotifyPlayback(): Promise<void> {
  const tabMixed = hasStudioTabAudio();
  const deviceId = await ensureStudioSpotifyPlayer();
  try {
    if (sdkPlayer) await sdkPlayer.resume();
    else {
      await spotifyApiFetch(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: "PUT",
        body: {},
      });
    }
    emitPlayback({
      paused: false,
      error: tabMixed ? null : TAB_AUDIO_REQUIRED,
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : "Could not resume Spotify");
  }
}

export async function skipSpotifyNext(): Promise<void> {
  if (sdkPlayer) {
    await sdkPlayer.nextTrack();
    return;
  }
  await spotifyApiFetch("/me/player/next", { method: "POST" });
}

export async function skipSpotifyPrevious(): Promise<void> {
  if (sdkPlayer) {
    await sdkPlayer.previousTrack();
    return;
  }
  await spotifyApiFetch("/me/player/previous", { method: "POST" });
}

export async function setSpotifyVolume(unit: number): Promise<void> {
  sdkVolume = Math.max(0, Math.min(1, unit));
  studioAudio.setMusicVolume(sdkVolume);
  emitPlayback({ volume: sdkVolume });
  try {
    if (sdkPlayer) await sdkPlayer.setVolume(sdkVolume);
  } catch {
    /* ignore */
  }
}

export async function disconnectStudioSpotifyPlayer(): Promise<void> {
  try {
    sdkPlayer?.disconnect();
  } catch {
    /* ignore */
  }
  sdkPlayer = null;
  sdkDeviceId = null;
  stopTabAudio();
  studioAudio.detachMusicElement();
  emitPlayback({
    deviceId: null,
    ready: false,
    paused: true,
    track: null,
    position: 0,
  });
}

export async function getSpotifyAccessTokenForSdk(): Promise<string | null> {
  try {
    return await getAccessToken();
  } catch {
    return null;
  }
}
