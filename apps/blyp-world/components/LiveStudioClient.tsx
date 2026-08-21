"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthProvider";
import { ensureFirebaseFromCognito } from "@/lib/firebaseBridge";
import {
  PUBLISH_MAX_BITRATE_KBPS,
  startIvsWebHostPublish,
  type IvsHostPublishHandle,
} from "@/lib/ivsWebHost";
import {
  hostInviteGuestByUid,
  fetchStreamGiftSummary,
  fetchStreamGiftTotals,
  fetchLiveEngagementSession,
  kickGuest,
  muteGuest,
  rankTopGifters,
  setGuestCamera,
  subscribeLiveChat,
  subscribeLiveGiftEvents,
  subscribeLiveStudioMirror,
  updateLiveSessionMeta,
  type LiveChatComment,
  type LiveStudioMirror,
  type StreamGiftSummary,
  type TopGifterRow,
} from "@/lib/live";
import {
  forceRefreshSession,
  loadStoredSession,
  refreshSessionIfNeeded,
} from "@/lib/cognito";
import { loadMeProfile } from "@/lib/profile";
import {
  endLiveHostSession,
  fetchGuestRequests,
  heartbeatLiveHostSession,
  inviteGuest,
  loadActiveHostSession,
  persistActiveHostSession,
  rejectGuest,
  startLiveHostSession,
  watchUrlForSession,
  type GuestRequestRow,
  type LiveHostSession,
} from "@/lib/liveHost";
import {
  formatLiveAuthError,
  SESSION_EXPIRED_MSG,
} from "@/lib/liveServiceAuth";
import {
  FACEBOOK_DEFAULT_RTMP,
  fetchBroadcastStatus,
  fanoutDestLabel,
  KICK_DEFAULT_RTMP,
  prepareBroadcast,
  startBroadcastFanoutWhenReady,
  TWITCH_DEFAULT_RTMP,
  YOUTUBE_DEFAULT_RTMP,
  type BroadcastPrepareDest,
  type BroadcastSessionView,
} from "@/lib/studioBroadcast";
import {
  fetchTikTokRoomEvents,
  startTikTokRoom,
  stopTikTokRoom,
  type TikTokRoomEvent,
  type TikTokRoomStatus,
} from "@/lib/studioTikTokRoom";
import {
  consumeStudioFullscreenIntent,
  exitStudioFullscreen,
  isStudioMaximized,
  requestStudioFullscreen,
  setStudioMaximizedClass,
  STUDIO_MAXIMIZED_CLASS,
} from "@/lib/enterLiveStudio";
import { ConfidenceRail } from "./studio/ConfidenceRail";
import { DestinationDock } from "./studio/DestinationDock";
import {
  liveGoLiveSummary,
  setupGoLiveSummary,
} from "@/lib/studioDestinations";
import {
  DESK_PUBLISH_FPS,
  formatGumError,
  formatStudioCamOpenError,
  getLastGumDebug,
  installStudioCamLock,
  listVideoInputDevices,
  mediaStreamHasLiveVideo,
  nativePublishVideoTrack,
  openDeskMedia,
  resolveLiveVideoDeviceId,
  resolveStudioCameras,
  screenStreamIsLive,
  shortDeviceLabel,
  type DeskMediaHandle,
  type DeskMediaMode,
  type DeskOrientation,
  type DeskPipRequest,
  type GumDebugInfo,
  type VideoInputDevice,
} from "@/lib/studioDeskMedia";

/** Survives Strict Mode remount so cleanup does not kill a just-opened webcam. */
let liveStudioMountGen = 0;

const TIKTOK_HANDLE_KEY = "blyp-studio-tiktok-uniqueId";
const OVERLAY_REMOTE_DEBOUNCE_MS = 800;
const OVERLAY_REMOTE_MAX_WAIT_MS = 2500;

function tiktokEventsToComments(events: TikTokRoomEvent[]): LiveChatComment[] {
  return events.map((ev) => ({
    id: ev.id,
    userId: `tiktok:${ev.uniqueId}`,
    username: ev.uniqueId,
    displayName: ev.displayName || ev.uniqueId,
    text: ev.text,
    createdAt: ev.createdAt,
    source: "tiktok" as const,
    kind: ev.kind,
  }));
}

function isPlayAbortError(err: unknown): boolean {
  const name =
    err instanceof DOMException
      ? err.name
      : err instanceof Error
        ? err.name
        : "";
  const msg = err instanceof Error ? err.message : String(err || "");
  return name === "AbortError" || /interrupted by a new load request/i.test(msg);
}

function bindProgramVideo(
  el: HTMLVideoElement,
  stream: MediaStream,
): Promise<void> {
  el.muted = true;
  el.defaultMuted = true;
  el.playsInline = true;
  el.setAttribute("playsinline", "true");
  el.setAttribute("webkit-playsinline", "true");
  el.autoplay = true;
  if (el.srcObject === stream && !el.paused) {
    return Promise.resolve();
  }
  el.srcObject = stream;
  return el.play().then(() => undefined).catch((err) => {
    if (isPlayAbortError(err)) return;
    throw err;
  });
}

function liveCameraMatchesDevice(
  live: DeskMediaHandle | null | undefined,
  deviceId: string | null | undefined,
): boolean {
  if (!live || live.mode !== "camera") return false;
  if (!mediaStreamHasLiveVideo(live.previewStream)) return false;
  const wanted = String(deviceId || "").trim();
  if (!wanted) return true;
  const liveId = live.previewStream.getVideoTracks()[0]?.getSettings()?.deviceId;
  return !!liveId && liveId === wanted;
}

function isDisplayCaptureStream(stream: MediaStream | null | undefined): boolean {
  const surface = stream?.getVideoTracks()[0]?.getSettings()?.displaySurface;
  return (
    surface === "monitor" ||
    surface === "window" ||
    surface === "browser" ||
    surface === "application"
  );
}

function streamDeviceId(stream: MediaStream | null | undefined): string | null {
  const id = stream?.getVideoTracks()[0]?.getSettings()?.deviceId;
  return id ? String(id) : null;
}

const PIP_SAME_CAM_TOAST =
  "Need a second camera for PIP — this one is already Main. Pick another cam, or put a screen in the corner.";

import {
  coerceLayout,
  defaultLayoutFor,
  isStrikeLayout,
  layoutDef,
  layoutsForOrientation,
  portraitLayoutOnLoad,
  PORTRAIT_DEFAULT_LAYOUT,
  type StageLayoutId,
  type StageTile,
} from "@/lib/studioStageLayouts";
import {
  DEFAULT_OVERLAY_POSITIONS,
  STUDIO_OVERLAYS,
  TOP_LAYOUT_PRESETS,
  buildStageTiles,
  loadOverlayPositionsByAspect,
  saveOverlayPositionsByAspect,
  stageFrameClass,
  normalizeOverlayPositions,
  OVERLAY_SCALE_PRESETS,
  clampOverlayScale,
  type OverlayPos,
  type OverlayPositions,
  type OverlayPositionsByAspect,
  type OverlayState,
  type StudioOverlayId,
} from "@/lib/studioDualView";
import { liveGuestInviteBlurb } from "@/lib/liveShareCopy";
import { searchUsers } from "@/lib/search";
import {
  deckCompanionPath,
  formatSessionTimer,
  loadOverlayState,
  overlayBrowserSourcePath,
  readOverlayFeed,
  saveOverlayState,
  writeOverlayFeed,
  publishOverlayFeedRemote,
  type OverlayFeedEvent,
  type OverlayFeedSnapshot,
} from "@/lib/studioOverlayFeed";
import {
  deleteStudioPreset,
  loadStudioPresets,
  saveStudioPresets,
  upsertStudioPreset,
  type StudioPreset,
} from "@/lib/studioPresets";
import {
  deleteProgramScene,
  loadProgramScenes,
  saveProgramScenes,
  upsertProgramScene,
  type ProgramScene,
} from "@/lib/studioProgramScenes";
import { planPublishAudio } from "@/lib/studioPublishGraph";
import {
  armSpotifyTabAudioForLive,
  completeSpotifyAuthFromUrl,
  ensureJukeboxPublishMix,
  getSpotifyLinkStatus,
  isStudioSpotifyLinked,
  pauseSpotifyPlayback,
  rememberSpotifyLinkStatus,
  TAB_AUDIO_REQUIRED,
  type SpotifyLinkStatus,
} from "@/lib/studioSpotify";
import { StudioJukeboxPanel, type JukeboxNowInfo } from "@/components/StudioJukeboxPanel";
import {
  listTtsVoices,
  loadTtsPrefs,
  saveTtsPrefs,
  skipStudioTts,
  speakStudioAlert,
  type StudioTtsPrefs,
} from "@/lib/studioTts";
import {
  cancelAlert,
  clearAlertQueue,
  createEmptyAlertQueue,
  enqueueAlert,
  markAlertDone,
  markAlertPlaying,
  peekNextAlert,
  pendingAlertCount,
  setAlertQueuePaused,
  type StudioAlertQueueState,
} from "@/lib/studioAlertQueue";
import {
  loadGiftAlertMap,
  resolveGiftSting,
  saveGiftAlertMap,
  type GiftAlertMapPrefs,
} from "@/lib/studioGiftAlertMap";
import {
  STUDIO_FEATURE_MATRIX,
  matrixStatusCounts,
  type StudioMatrixPillarId,
} from "@/lib/studioFeatureMatrix";
import {
  subscribeStudioDeckCommands,
  type StudioDeckCommand,
} from "@/lib/studioDeckBus";
import { loadOverlayThemeCss } from "@/lib/studioOverlayTheme";
import { StudioRailSlot } from "@/components/StudioRailSlot";
import {
  LEFT_RAIL_IDS,
  LEFT_RAIL_LABELS,
  RIGHT_RAIL_IDS,
  RIGHT_RAIL_LABELS,
  loadLeftRailOrder,
  loadRightRailOrder,
  moveRailId,
  saveLeftRailOrder,
  saveRightRailOrder,
  type LeftRailId,
  type RightRailId,
} from "@/lib/studioRailOrder";
import {
  STING_PAD,
  studioAudio,
  type MusicBedId,
  type StingId,
} from "@/components/BlypStudio/audio/StudioAudioEngine";
import { BombStrikeStage } from "@/components/BlypStudio/fx/BombStrikeLayer";
import { playBombStrike } from "@/components/BlypStudio/fx/bombStrikeBus";
import { GiftCinemaLayer } from "@/components/GiftCinemaLayer";
import { makeGiftCinemaCue, type GiftCinemaCue } from "@/lib/giftCinemaClips";
import { StudioProgramOverlays } from "@/components/StudioProgramOverlays";
import { TeamDashboard } from "@/components/teams/TeamDashboard";
import { getFirebaseAuth } from "@/lib/firebase";
import {
  loadMyTeam,
  loadMyTeamViaApi,
  type TeamBundle,
} from "@/lib/teams";
import "./command-center.css";

function initialPortraitStudioLayout(): StageLayoutId {
  if (typeof window === "undefined") return PORTRAIT_DEFAULT_LAYOUT;
  return portraitLayoutOnLoad(readOverlayFeed().layoutPortrait);
}

type StudioBoothMode = "portrait" | "landscape" | "team-desk";
const STUDIO_BOOTH_CYCLE: StudioBoothMode[] = [
  "portrait",
  "landscape",
  "team-desk",
];

type JukeboxTrack = { id: string; name: string; file: File };

/** Cycles 0..8 for LIVE Studio Nuke when Host+9 / Grid 3×3 is active. */
let liveTestStrikeCursor = 0;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable=true]"),
  );
}

function pendingRequests(rows: GuestRequestRow[]): GuestRequestRow[] {
  return rows.filter((r) => isPendingGuest(r.status));
}

function invitedOrLive(rows: GuestRequestRow[]): GuestRequestRow[] {
  return rows.filter((r) => isSeatedGuest(r.status));
}

/** Prefer @handle over raw Cognito UUID in guest lists. */
function formatGuestLabel(
  userId: string,
  labels: Record<string, string>,
): string {
  const hit = labels[userId]?.trim();
  if (hit) return hit.startsWith("@") ? hit : `@${hit}`;
  if (userId.length > 14) return `${userId.slice(0, 8)}…`;
  return userId;
}

function isAlreadyOnStageError(msg: string): boolean {
  return /guest session already active|already (on stage|invited|live)/i.test(
    msg,
  );
}

function isPendingGuest(status: unknown): boolean {
  return ["PENDING", "REQUESTED", "WAITING"].includes(
    String(status || "").toUpperCase(),
  );
}

function isSeatedGuest(status: unknown): boolean {
  return ["INVITED", "LIVE", "ACCEPTED"].includes(
    String(status || "").toUpperCase(),
  );
}

/** Old /guest/requests only returned REQUESTED. Keep accepted seats across that poll. */
function mergeGuestPanel(
  prev: GuestRequestRow[],
  polled: GuestRequestRow[],
): GuestRequestRow[] {
  const polledSeated = polled.filter((r) => isSeatedGuest(r.status));
  if (polledSeated.length > 0) return polled;
  const seated = prev.filter((r) => isSeatedGuest(r.status));
  if (seated.length === 0) return polled;
  const seatedIds = new Set(seated.map((r) => r.userId));
  return [
    ...polled.filter((r) => !seatedIds.has(r.userId)),
    ...seated,
  ];
}

type FanoutSnap = {
  tiktokReady: boolean;
  tiktokRtmpUrl: string;
  tiktokStreamKey: string;
  youtubeReady: boolean;
  youtubeRtmpUrl: string;
  youtubeStreamKey: string;
  twitchReady: boolean;
  twitchRtmpUrl: string;
  twitchStreamKey: string;
  facebookReady: boolean;
  facebookRtmpUrl: string;
  facebookStreamKey: string;
  kickReady: boolean;
  kickRtmpUrl: string;
  kickStreamKey: string;
};

function collectFanoutDests(input: FanoutSnap): BroadcastPrepareDest[] {
  const dests: BroadcastPrepareDest[] = [];
  const push = (
    ready: boolean,
    platform: BroadcastPrepareDest["platform"],
    rtmpUrl: string,
    streamKey: string,
  ) => {
    const url = String(rtmpUrl || "").trim();
    const key = String(streamKey || "").trim();
    if (!ready || !url || !key) return;
    dests.push({ platform, rtmpUrl: url, streamKey: key });
  };
  push(input.tiktokReady, "tiktok", input.tiktokRtmpUrl, input.tiktokStreamKey);
  push(input.youtubeReady, "youtube", input.youtubeRtmpUrl, input.youtubeStreamKey);
  push(input.twitchReady, "twitch", input.twitchRtmpUrl, input.twitchStreamKey);
  push(
    input.facebookReady,
    "facebook",
    input.facebookRtmpUrl,
    input.facebookStreamKey,
  );
  push(input.kickReady, "custom_rtmp", input.kickRtmpUrl, input.kickStreamKey);
  return dests;
}

function EmptyGuestSlot({
  label,
  bombCell,
  strikeArmed,
  inviteOpen,
  inviteQuery,
  inviteBusy,
  onToggleInvite,
  onInviteQuery,
  onCopyLink,
  onSendInvite,
  onNuke,
}: {
  label: string;
  bombCell?: number;
  strikeArmed: boolean;
  inviteOpen: boolean;
  inviteQuery: string;
  inviteBusy: boolean;
  onToggleInvite: () => void;
  onInviteQuery: (value: string) => void;
  onCopyLink: () => void;
  onSendInvite: () => void;
  onNuke?: () => void;
}) {
  return (
    <div
      data-bomb-cell={bombCell}
      className={
        inviteOpen
          ? "tls-guest-tile tls-guest-tile-empty tls-guest-invite-open"
          : "tls-guest-tile tls-guest-tile-empty"
      }
      onClick={
        strikeArmed && onNuke
          ? (e) => {
              if (
                (e.target as HTMLElement).closest(
                  ".tls-guest-invite, .tls-guest-invite-pop",
                )
              ) {
                return;
              }
              onNuke();
            }
          : undefined
      }
    >
      {inviteOpen ? (
        <form
          className="tls-guest-invite-pop"
          onClick={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            onSendInvite();
          }}
        >
          <p className="tls-guest-invite-pop-title">Invite · {label}</p>
          <button
            type="button"
            className="tls-guest-invite tls-guest-invite-copy"
            onClick={onCopyLink}
          >
            Copy join link
          </button>
          <input
            type="text"
            value={inviteQuery}
            onChange={(e) => onInviteQuery(e.target.value)}
            placeholder="@username"
            autoComplete="off"
            spellCheck={false}
            aria-label={`Blyp username for ${label}`}
          />
          <div className="tls-guest-invite-pop-row">
            <button type="submit" className="tls-guest-invite" disabled={inviteBusy}>
              {inviteBusy ? "…" : "Send"}
            </button>
            <button
              type="button"
              className="tls-guest-invite-cancel"
              onClick={onToggleInvite}
            >
              Close
            </button>
          </div>
        </form>
      ) : (
        <>
          <span className="tls-guest-slot-mark" aria-hidden />
          <span className="tls-guest-tile-id">{label}</span>
          <button
            type="button"
            className="tls-guest-invite"
            onClick={(e) => {
              e.stopPropagation();
              onToggleInvite();
            }}
          >
            Invite
          </button>
        </>
      )}
    </div>
  );
}

function OccupiedGuestTile({
  label,
  bombCell,
  strikeArmed,
  stream,
  onNuke,
}: {
  label: string;
  bombCell: number | undefined;
  strikeArmed: boolean;
  stream: MediaStream | null;
  onNuke?: () => void;
}) {
  const videoEl = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoEl.current;
    if (!el) return;
    if (stream) {
      if (el.srcObject !== stream) el.srcObject = stream;
      el.muted = true;
      el.playsInline = true;
      void el.play().catch(() => undefined);
    } else if (el.srcObject) {
      el.srcObject = null;
    }
  }, [stream]);

  return (
    <button
      type="button"
      data-bomb-cell={bombCell}
      aria-label={label}
      title={strikeArmed ? "Nuke this cell" : label}
      className="tls-guest-tile"
      onClick={onNuke}
    >
      <video
        ref={videoEl}
        className="tls-guest-video"
        muted
        playsInline
        autoPlay
      />
      <span className="tls-guest-tile-id">{label}</span>
    </button>
  );
}

export function LiveStudioClient() {
  const { session, loading, requireAuth } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const publishRef = useRef<IvsHostPublishHandle | null>(null);
  const mediaRef = useRef<DeskMediaHandle | null>(null);
  const publishInFlightRef = useRef(false);
  const micMutedRef = useRef(false);
  const autoPreviewStartedRef = useRef(false);
  const gesturePreviewArmedRef = useRef(false);
  /** Monotonic id so overlapping startPreview calls discard stale results. */
  const previewOpenGenRef = useRef(0);
  const startPreviewRef = useRef<
    (mode?: DeskMediaMode, orient?: DeskOrientation) => Promise<void>
  >(async () => undefined);

  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gumDebug, setGumDebug] = useState<GumDebugInfo>({ status: "idle" });
  const [toast, setToast] = useState<string | null>(null);
  const [active, setActive] = useState<LiveHostSession | null>(null);
  const [publishState, setPublishState] = useState<
    "idle" | "publishing" | "live" | "error"
  >("idle");
  const [guestRows, setGuestRows] = useState<GuestRequestRow[]>([]);
  const [guestLabels, setGuestLabels] = useState<Record<string, string>>({});
  const [guestPollError, setGuestPollError] = useState<string | null>(null);
  const [mediaMode, setMediaMode] = useState<DeskMediaMode>("camera");
  /** Director overlay/layout aspect — both portrait and landscape stay live for viewers. */
  const [orientation, setOrientation] = useState<DeskOrientation>("portrait");
  /** Booth chrome cycle: Portrait → Landscape → Team/battle desk → Portrait. */
  const [boothMode, setBoothMode] = useState<StudioBoothMode>("portrait");
  const [studioTeam, setStudioTeam] = useState<TeamBundle | null>(null);
  const [studioTeamBusy, setStudioTeamBusy] = useState(false);
  const [studioTeamError, setStudioTeamError] = useState<string | null>(null);
  const [viewerLayout, setViewerLayout] = useState<StageLayoutId>(
    initialPortraitStudioLayout,
  );
  const [overlayState, setOverlayState] = useState<OverlayState>(loadOverlayState);
  const [overlayMaps, setOverlayMaps] = useState<OverlayPositionsByAspect>(() => ({
    portrait: { ...DEFAULT_OVERLAY_POSITIONS },
    landscape: { ...DEFAULT_OVERLAY_POSITIONS },
  }));
  const overlayPositions = overlayMaps[orientation];
  const [overlayPosReady, setOverlayPosReady] = useState(false);
  const [leftRailOrder, setLeftRailOrder] = useState<LeftRailId[]>(() => [
    ...LEFT_RAIL_IDS,
  ]);
  const [rightRailOrder, setRightRailOrder] = useState<RightRailId[]>(() => [
    ...RIGHT_RAIL_IDS,
  ]);
  const [railOrderReady, setRailOrderReady] = useState(false);
  const [studioPresets, setStudioPresets] = useState<StudioPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [goalTarget, setGoalTarget] = useState(10_000);
  const [liveStartedAt, setLiveStartedAt] = useState<number | null>(null);
  const [timerLabel, setTimerLabel] = useState("00:00:00");
  const [feedEvents, setFeedEvents] = useState<OverlayFeedEvent[]>([]);
  const [giftCinemaCue, setGiftCinemaCue] = useState<GiftCinemaCue | null>(null);
  const [jukeboxQueue, setJukeboxQueue] = useState<JukeboxTrack[]>([]);
  const [jukeboxNow, setJukeboxNow] = useState("Queue empty");
  const [jukeboxArt, setJukeboxArt] = useState<string | null>(null);
  const [jukeboxTitle, setJukeboxTitle] = useState("");
  const [jukeboxArtist, setJukeboxArtist] = useState("");
  const [jukeboxNext, setJukeboxNext] = useState("");
  const [jukeboxPos, setJukeboxPos] = useState(0);
  const [jukeboxDur, setJukeboxDur] = useState(0);
  const [jukeboxPaused, setJukeboxPaused] = useState(true);
  const [activeBed, setActiveBed] = useState<MusicBedId | "file" | null>(null);
  const jukeboxFileRef = useRef<HTMLInputElement | null>(null);
  const customStingRef = useRef<HTMLInputElement | null>(null);
  const lastGiftCoinsRef = useRef(0);
  const lastChatIdRef = useRef<string | null>(null);
  const lastGuestCountRef = useRef(0);
  const seenTikTokGiftIdsRef = useRef<Set<string>>(new Set());
  const tiktokGiftBootRef = useRef(false);
  const topGiftersRef = useRef<Record<string, { coins: number; name: string }>>(
    {},
  );
  const [guestsOpen, setGuestsOpen] = useState(true);
  const [guestMuted, setGuestMuted] = useState<Record<string, boolean>>({});
  const [guestCamOff, setGuestCamOff] = useState<Record<string, boolean>>({});
  const [guestMedia, setGuestMedia] = useState<Record<string, MediaStream>>({});
  const [inviteSlotKey, setInviteSlotKey] = useState<string | null>(null);
  const [inviteQuery, setInviteQuery] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [chat, setChat] = useState<LiveChatComment[]>([]);
  const [gifts, setGifts] = useState<StreamGiftSummary | null>(null);
  const [topGifters, setTopGifters] = useState<TopGifterRow[]>([]);
  const [gifterSourceNote, setGifterSourceNote] = useState("");
  const [mirror, setMirror] = useState<LiveStudioMirror | null>(null);
  const [previewOn, setPreviewOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  micMutedRef.current = micMuted;
  const [camOff, setCamOff] = useState(false);
  const [videoDevices, setVideoDevices] = useState<VideoInputDevice[]>([]);
  const [cameraDeviceId, setCameraDeviceId] = useState<string | null>(null);
  const [micVol, setMicVol] = useState(80);
  const [musicVol, setMusicVol] = useState(45);
  const [alertsVol, setAlertsVol] = useState(70);
  const [hearAlertsLocal, setHearAlertsLocal] = useState(true);
  const [leftPillar, setLeftPillar] =
    useState<StudioMatrixPillarId | "caps">("compositing");
  const [alertQueue, setAlertQueue] = useState<StudioAlertQueueState>(
    createEmptyAlertQueue,
  );
  const [giftAlertMap, setGiftAlertMap] =
    useState<GiftAlertMapPrefs>(loadGiftAlertMap);
  const [sceneXfade, setSceneXfade] = useState(false);
  const [healthFps, setHealthFps] = useState(0);
  const [healthIngest, setHealthIngest] = useState<"idle" | "ok" | "warn">(
    "idle",
  );
  const [mainMenuOpen, setMainMenuOpen] = useState(false);
  const [pipMenuOpen, setPipMenuOpen] = useState(false);
  const [teamMenuOpen, setTeamMenuOpen] = useState(false);
  const [headerGuestsOpen, setHeaderGuestsOpen] = useState(false);
  const [pipOn, setPipOn] = useState(false);
  const [mainSource, setMainSource] = useState<
    "laptop" | "phone" | "screen" | "other"
  >("laptop");
  const [pipSource, setPipSource] = useState<
    "laptop" | "phone" | "screen" | "other"
  >("laptop");
  /** Restore framing when flipping orientation via deck / top presets. */
  const lastLandscapeLayoutRef = useRef<StageLayoutId>(
    defaultLayoutFor("landscape"),
  );
  const lastPortraitLayoutRef = useRef<StageLayoutId>(
    PORTRAIT_DEFAULT_LAYOUT,
  );
  const overlayFeedSnapRef = useRef<OverlayFeedSnapshot | null>(null);
  const overlayRemoteDebounceRef = useRef<number | null>(null);
  const overlayRemoteMaxWaitRef = useRef<number | null>(null);
  const overlayRemoteSessionRef = useRef<{
    sessionId: string;
    idToken: string;
  } | null>(null);
  const boothRootRef = useRef<HTMLDivElement | null>(null);
  const maximizeNativeRef = useRef(false);
  const [studioMaximized, setStudioMaximized] = useState(false);

  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyLinkStatus | null>(
    null,
  );

  const [ttsPrefs, setTtsPrefs] = useState<StudioTtsPrefs>(loadTtsPrefs);
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);

  const [programScenes, setProgramScenes] = useState<ProgramScene[]>([]);
  const [sceneName, setSceneName] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [themeCss, setThemeCss] = useState("");
  const [overlaySyncNote, setOverlaySyncNote] = useState(
    "Same-browser OBS uses localStorage. Add ?session= when LIVE for remote PC.",
  );
  const [tiktokEnabled, setTiktokEnabled] = useState(false);
  const [tiktokPreflightReady, setTiktokPreflightReady] = useState(false);
  const [tiktokRtmpUrl, setTiktokRtmpUrl] = useState("");
  const [tiktokStreamKey, setTiktokStreamKey] = useState("");
  const [tiktokUniqueId, setTiktokUniqueId] = useState("");
  const [youtubeEnabled, setYoutubeEnabled] = useState(false);
  const [youtubePreflightReady, setYoutubePreflightReady] = useState(false);
  const [youtubeRtmpUrl, setYoutubeRtmpUrl] = useState(YOUTUBE_DEFAULT_RTMP);
  const [youtubeStreamKey, setYoutubeStreamKey] = useState("");
  const [twitchEnabled, setTwitchEnabled] = useState(false);
  const [twitchPreflightReady, setTwitchPreflightReady] = useState(false);
  const [twitchRtmpUrl, setTwitchRtmpUrl] = useState(TWITCH_DEFAULT_RTMP);
  const [twitchStreamKey, setTwitchStreamKey] = useState("");
  const [facebookEnabled, setFacebookEnabled] = useState(false);
  const [facebookPreflightReady, setFacebookPreflightReady] = useState(false);
  const [facebookRtmpUrl, setFacebookRtmpUrl] = useState(FACEBOOK_DEFAULT_RTMP);
  const [facebookStreamKey, setFacebookStreamKey] = useState("");
  const [kickEnabled, setKickEnabled] = useState(false);
  const [kickPreflightReady, setKickPreflightReady] = useState(false);
  const [kickRtmpUrl, setKickRtmpUrl] = useState(KICK_DEFAULT_RTMP);
  const [kickStreamKey, setKickStreamKey] = useState("");
  const [tiktokChat, setTiktokChat] = useState<LiveChatComment[]>([]);
  const [tiktokRoomStatus, setTiktokRoomStatus] = useState<TikTokRoomStatus | null>(
    null,
  );
  const [broadcastView, setBroadcastView] = useState<BroadcastSessionView | null>(
    null,
  );

  const destSnapRef = useRef<FanoutSnap>({
    tiktokReady: false,
    tiktokRtmpUrl: "",
    tiktokStreamKey: "",
    youtubeReady: false,
    youtubeRtmpUrl: YOUTUBE_DEFAULT_RTMP,
    youtubeStreamKey: "",
    twitchReady: false,
    twitchRtmpUrl: TWITCH_DEFAULT_RTMP,
    twitchStreamKey: "",
    facebookReady: false,
    facebookRtmpUrl: FACEBOOK_DEFAULT_RTMP,
    facebookStreamKey: "",
    kickReady: false,
    kickRtmpUrl: KICK_DEFAULT_RTMP,
    kickStreamKey: "",
  });
  destSnapRef.current = {
    tiktokReady: tiktokEnabled && tiktokPreflightReady,
    tiktokRtmpUrl,
    tiktokStreamKey,
    youtubeReady: youtubeEnabled && youtubePreflightReady,
    youtubeRtmpUrl,
    youtubeStreamKey,
    twitchReady: twitchEnabled && twitchPreflightReady,
    twitchRtmpUrl,
    twitchStreamKey,
    facebookReady: facebookEnabled && facebookPreflightReady,
    facebookRtmpUrl,
    facebookStreamKey,
    kickReady: kickEnabled && kickPreflightReady,
    kickRtmpUrl,
    kickStreamKey,
  };

  useEffect(() => {
    if (loading) return;
    const root = boothRootRef.current;
    if (!root) return;
    if (!consumeStudioFullscreenIntent()) return;
    setStudioMaximizedClass(true, root);
    setStudioMaximized(true);
    void requestStudioFullscreen(root);
  }, [loading]);

  useEffect(() => {
    const syncMaximized = () => {
      const root = boothRootRef.current;
      if (!root) return;
      if (document.fullscreenElement === root) {
        maximizeNativeRef.current = true;
        setStudioMaximizedClass(true, root);
        setStudioMaximized(true);
        return;
      }
      if (maximizeNativeRef.current) {
        maximizeNativeRef.current = false;
        setStudioMaximizedClass(false, root);
        setStudioMaximized(false);
      }
    };
    document.addEventListener("fullscreenchange", syncMaximized);
    return () => document.removeEventListener("fullscreenchange", syncMaximized);
  }, []);

  const toggleStudioMaximize = useCallback(async () => {
    const root = boothRootRef.current;
    if (!root) return;
    const maximized = isStudioMaximized(root);
    if (maximized) {
      maximizeNativeRef.current = false;
      await exitStudioFullscreen(root);
      setStudioMaximized(false);
      return;
    }
    setStudioMaximizedClass(true, root);
    setStudioMaximized(true);
    await requestStudioFullscreen(root);
    maximizeNativeRef.current = document.fullscreenElement === root;
  }, []);

  /** First paint guard — portrait never opens as Solo from stale storage/deck echo. */
  useEffect(() => {
    const boot = initialPortraitStudioLayout();
    setViewerLayout((cur) =>
      orientation === "portrait" && cur === "solo" ? boot : cur,
    );
    lastPortraitLayoutRef.current =
      lastPortraitLayoutRef.current === "solo" ? boot : lastPortraitLayoutRef.current;
  }, []);

  const pushToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const releaseMedia = useCallback((opts?: { keepScreen?: boolean }) => {
    mediaRef.current?.stop(opts);
    mediaRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPreviewOn(false);
  }, []);

  // Listen for a *sibling* Studio tab stealing the camera. Do not post a
  // claim here — that echoed in this same tab and stopped our own tracks.
  useEffect(() => {
    const uninstall = installStudioCamLock({
      onStolen: () => {
        mediaRef.current?.stop();
        mediaRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        studioAudio.attachMic(null);
        setPreviewOn(false);
      },
    });
    return uninstall;
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TIKTOK_HANDLE_KEY) || "";
      if (saved) setTiktokUniqueId(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const liveScreenFromMedia = useCallback((): MediaStream | null => {
    const screen = mediaRef.current?.screenStream ?? null;
    if (!screenStreamIsLive(screen)) return null;
    if (isDisplayCaptureStream(screen)) return screen;
    if (mediaRef.current?.mode === "screen") return screen;
    return null;
  }, []);

  useEffect(() => {
    studioAudio.setMicVolume(micMuted ? 0 : micVol / 100);
    const wantMix = studioAudio.shouldPublishMix();
    publishRef.current?.setAudioMuted(micMuted && !wantMix);
    const mixId = studioAudio.mixAudioTrack()?.id;
    const streams = [
      mediaRef.current?.previewStream,
      mediaRef.current?.publishStream,
    ];
    for (const stream of streams) {
      stream?.getAudioTracks().forEach((t) => {
        if (mixId && t.id === mixId) return;
        // Display/tab/mix tracks have no mic deviceId — Host Mic must not mute YouTube.
        if (!t.getSettings?.()?.deviceId) return;
        t.enabled = !micMuted;
      });
    }
  }, [micVol, micMuted]);

  useEffect(() => {
    studioAudio.setMusicVolume(musicVol / 100);
  }, [musicVol]);

  useEffect(() => {
    studioAudio.setStingVolume(alertsVol / 100);
  }, [alertsVol]);

  useEffect(() => {
    studioAudio.setStingMonitorEnabled(hearAlertsLocal);
  }, [hearAlertsLocal]);

  /** Kill stale toast/error from a previous visit before any open attempt. */
  useEffect(() => {
    setError(null);
    setToast(null);
    setGumDebug({ status: "idle" });
  }, []);

  /** Refresh camera list on permission and when Continuity Camera appears/disappears. */
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    let cancelled = false;
    const refresh = () => {
      void listVideoInputDevices({ warmPermission: false })
        .then((devs) => {
          if (cancelled || !devs.length) return;
          setVideoDevices(devs);
        })
        .catch(() => undefined);
    };
    refresh();
    const md = navigator.mediaDevices;
    md.addEventListener("devicechange", refresh);
    return () => {
      cancelled = true;
      md.removeEventListener("devicechange", refresh);
    };
  }, [previewOn]);

  const { laptop: laptopCam, phone: phoneCam, other: otherCams } = useMemo(
    () => resolveStudioCameras(videoDevices),
    [videoDevices],
  );

  useEffect(() => {
    const restored = loadActiveHostSession();
    if (restored) setActive(restored);
  }, []);

  useEffect(() => {
    if (!title && session?.username) setTitle(`${session.username} LIVE`);
  }, [session?.username, title]);

  useEffect(() => {
    persistActiveHostSession(active);
  }, [active]);

  const stopPublish = useCallback(async () => {
    const handle = publishRef.current;
    publishRef.current = null;
    if (handle) {
      try {
        await handle.leave();
      } catch {
        /* ignore */
      }
    }
    setGuestMedia({});
    setPublishState("idle");
  }, []);

  const applyPublishAudio = useCallback((wantMix: boolean) => {
    const handle = publishRef.current;
    const media = mediaRef.current;
    if (!handle || !media) return;
    const videoSource = media.publishStream || media.previewStream;
    studioAudio.buildPublishStream(videoSource, media.previewStream);
    const mixAudio = studioAudio.mixAudioTrack();
    const gum = studioAudio.nativeAudioTrack(media.previewStream);
    const source = planPublishAudio({
      wantMix,
      mixTrackLive: !!mixAudio && mixAudio.readyState === "live",
      gumTrackLive: !!gum && gum.readyState === "live",
    });
    if (source === "mix" && mixAudio) {
      handle.setAudioTrack(mixAudio, false);
      return;
    }
    const muted = micMutedRef.current;
    if (gum) handle.setAudioTrack(gum, muted);
    else handle.setAudioMuted(muted);
  }, []);

  const beginPublish = useCallback(
    async (
      host: LiveHostSession,
      mode?: DeskMediaMode,
      orient?: DeskOrientation,
    ): Promise<boolean> => {
      if (publishInFlightRef.current) {
        return !!publishRef.current;
      }
      publishInFlightRef.current = true;
      setPublishState("publishing");
      setError(null);
      try {
        const resolved = mode || mediaRef.current?.mode || mediaMode;
        const resolvedOrient = orient || orientation;
        const existing = mediaRef.current;
        const reopenMedia =
          !existing ||
          (mode && existing.mode !== mode) ||
          (existing.mode !== "camera" && existing.orientation !== resolvedOrient);
        if (reopenMedia) {
          existing?.stop();
          mediaRef.current = await openDeskMedia(
            resolved,
            resolvedOrient,
            null,
            cameraDeviceId,
          );
        } else if (existing.orientation !== resolvedOrient) {
          existing.orientation = resolvedOrient;
        }
        const media = mediaRef.current;
        if (!media) {
          throw new Error("Could not open camera or screen");
        }
        if (videoRef.current) {
          void bindProgramVideo(videoRef.current, media.previewStream).catch(
            (err) => {
              setError(`Preview attach failed — ${formatGumError(err, "video.play()")}`);
            },
          );
        }
        setPreviewOn(true);
        setMediaMode(resolved);
        await ensureJukeboxPublishMix({ allowTabCapture: false });
        const videoSource = media.publishStream || media.previewStream;
        const wantMix = studioAudio.shouldPublishMix();
        const publishStream =
          (wantMix
            ? studioAudio.buildPublishStream(videoSource, media.previewStream)
            : studioAudio.buildNativePublishStream(
                videoSource,
                media.previewStream,
              )) || videoSource;
        const liveVideo = nativePublishVideoTrack(publishStream);
        if (!liveVideo) {
          throw new Error("Could not open camera or screen");
        }
        if (resolved === "camera") {
          const settings = liveVideo.getSettings?.() ?? {};
          if (!settings.deviceId) {
            throw new Error(
              "Camera publish requires a getUserMedia video track",
            );
          }
        }
        const handle = await startIvsWebHostPublish({
          participantToken: host.hostToken,
          mediaStream: publishStream,
          retainMediaOnLeave: true,
          subscribeGuests: true,
          onGuestMedia: setGuestMedia,
          audioMuted: micMutedRef.current && !wantMix,
        });
        publishRef.current = handle;
        setPublishState("live");
        applyPublishAudio(studioAudio.shouldPublishMix());
        pushToast(
          resolved === "screen" || resolved === "screen-pip"
            ? "Screen publishing to stage"
            : "Camera publishing to stage",
        );
        return true;
      } catch (e) {
        setPublishState("error");
        setError(
          e instanceof Error
            ? e.message
            : "Failed to publish camera to IVS stage",
        );
        return false;
      } finally {
        publishInFlightRef.current = false;
      }
    },
    [mediaMode, orientation, pushToast, cameraDeviceId, applyPublishAudio],
  );

  // Resume publish after restore / remount when we still have a host token.
  useEffect(() => {
    if (!active?.hostToken) return;
    if (publishRef.current) return;
    if (publishInFlightRef.current) return;
    if (publishState === "publishing" || publishState === "live") return;
    void beginPublish(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when session id changes
  }, [active?.sessionId]);

  // Teardown only on real leave. React Strict Mode runs setup→cleanup→setup;
  // an immediate releaseMedia() there stops a successful cam open and the
  // reopen hits NotReadableError ("Could not start video source").
  useEffect(() => {
    const myGen = ++liveStudioMountGen;
    const onPageHide = () => {
      void stopPublish();
      releaseMedia();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.setTimeout(() => {
        if (liveStudioMountGen !== myGen) return;
        void stopPublish();
        releaseMedia();
      }, 400);
    };
  }, [stopPublish, releaseMedia]);

  useEffect(() => {
    return studioAudio.subscribePublishMix((wantMix) => {
      applyPublishAudio(wantMix);
    });
  }, [applyPublishAudio]);

  useEffect(() => {
    if (!active?.sessionId || !session?.idToken) return;
    const layoutId = coerceLayout(viewerLayout, orientation);
    const tick = async () => {
      try {
        await heartbeatLiveHostSession(session.idToken, active.sessionId, {
          studioOrientation: orientation,
          studioLayout: layoutId,
        });
      } catch {
        /* soft-fail until /api/live/heartbeat is deployed; Dynamo session stays LIVE */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 30_000);
    return () => {
      window.clearInterval(id);
    };
  }, [active?.sessionId, session?.idToken, orientation, viewerLayout]);

  /** Immediate Firestore mirror so /live/:id watchers match host program chrome. */
  useEffect(() => {
    if (!active?.sessionId) return;
    const layoutId = coerceLayout(viewerLayout, orientation);
    void updateLiveSessionMeta(active.sessionId, {
      studioOrientation: orientation,
      studioLayout: layoutId,
    }).catch(() => undefined);
  }, [active?.sessionId, orientation, viewerLayout]);

  useEffect(() => {
    if (!active?.sessionId || !session?.idToken) {
      setGuestRows([]);
      setGuestPollError(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const rows = await fetchGuestRequests(
          session.idToken,
          active.sessionId,
        );
        if (!cancelled) {
          setGuestRows((prev) => mergeGuestPanel(prev, rows));
          setGuestPollError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setGuestPollError(
            e instanceof Error ? e.message : "Failed to list guest requests",
          );
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active?.sessionId, session?.idToken]);

  useEffect(() => {
    if (!active?.sessionId) {
      setChat([]);
      setMirror(null);
      return;
    }
    const unsubChat = subscribeLiveChat(active.sessionId, setChat);
    const unsubMirror = subscribeLiveStudioMirror(active.sessionId, setMirror);
    return () => {
      unsubChat();
      unsubMirror();
    };
  }, [active?.sessionId]);

  useEffect(() => {
    if (!active?.sessionId || !session?.idToken) {
      setGifts(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const summary = await fetchStreamGiftSummary(
        session.idToken,
        active.sessionId,
      );
      if (!cancelled) setGifts(summary);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active?.sessionId, session?.idToken]);

  const pending = useMemo(() => pendingRequests(guestRows), [guestRows]);
  const onStage = useMemo(() => invitedOrLive(guestRows), [guestRows]);

  useEffect(() => {
    const ids = Array.from(
      new Set(guestRows.map((r) => r.userId).filter(Boolean)),
    );
    if (ids.length === 0) {
      setGuestLabels({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const p = await loadMeProfile(id);
            const handle = (p?.username || p?.displayName || "").trim();
            if (handle) next[id] = handle;
          } catch {
            /* keep short id fallback */
          }
        }),
      );
      if (!cancelled) setGuestLabels(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [guestRows]);
  const watchUrl = active ? watchUrlForSession(active.sessionId) : "";
  const phoneLayout = useMemo(
    () => layoutDef(coerceLayout(viewerLayout, orientation)),
    [viewerLayout, orientation],
  );
  const strikeArmed = isStrikeLayout(phoneLayout);
  const phoneLayoutOptions = useMemo(
    () => layoutsForOrientation(orientation),
    [orientation],
  );
  const phoneTiles = useMemo(
    () => buildStageTiles(phoneLayout, onStage),
    [phoneLayout, onStage],
  );

  useEffect(() => {
    setOverlayMaps(loadOverlayPositionsByAspect());
    setOverlayState(loadOverlayState());
    setStudioPresets(loadStudioPresets());
    setProgramScenes(loadProgramScenes());
    setThemeCss(loadOverlayThemeCss());
    setTtsPrefs(loadTtsPrefs());
    setLeftRailOrder(loadLeftRailOrder());
    setRightRailOrder(loadRightRailOrder());
    setRailOrderReady(true);
    setOverlayPosReady(true);
    const refreshVoices = () => setTtsVoices(listTtsVoices());
    refreshVoices();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
  }, [pushToast]);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    void getSpotifyLinkStatus().then((s) => {
      if (!cancelled) setSpotifyStatus(s);
    });
    void completeSpotifyAuthFromUrl().then((r) => {
      if (!r.handled || cancelled) return;
      if (r.error) pushToast(r.error);
      else {
        pushToast("Spotify connected");
        void getSpotifyLinkStatus().then((s) => {
          if (!cancelled) setSpotifyStatus(s);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loading, session?.idToken, pushToast]);

  useEffect(() => {
    if (!overlayPosReady) return;
    saveOverlayPositionsByAspect(overlayMaps);
  }, [overlayMaps, overlayPosReady]);

  useEffect(() => {
    if (!railOrderReady) return;
    saveLeftRailOrder(leftRailOrder);
  }, [leftRailOrder, railOrderReady]);

  useEffect(() => {
    if (!railOrderReady) return;
    saveRightRailOrder(rightRailOrder);
  }, [rightRailOrder, railOrderReady]);

  useEffect(() => {
    if (!overlayPosReady) return;
    saveOverlayState(overlayState);
  }, [overlayState, overlayPosReady]);

  useEffect(() => {
    if (active?.sessionId) {
      setLiveStartedAt((prev) => prev ?? Date.now());
    } else {
      setLiveStartedAt(null);
      setTimerLabel("00:00:00");
    }
  }, [active?.sessionId]);

  useEffect(() => {
    if (liveStartedAt == null) return;
    const tick = () => {
      setTimerLabel(formatSessionTimer(Date.now() - liveStartedAt));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [liveStartedAt]);

  const pushFeedEvent = useCallback((text: string) => {
    const row: OverlayFeedEvent = {
      id: `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      text,
      at: Date.now(),
    };
    setFeedEvents((prev) => [row, ...prev].slice(0, 12));
  }, []);

  const queueStudioAlert = useCallback(
    (partial: {
      kind: "gift" | "chat" | "join" | "manual" | "sfx";
      text: string;
      stingId?: StingId;
    }) => {
      setAlertQueue((prev) => enqueueAlert(prev, partial));
    },
    [],
  );

  useEffect(() => {
    if (!active?.sessionId || !session?.idToken || !tiktokUniqueId) {
      setTiktokChat([]);
      seenTikTokGiftIdsRef.current.clear();
      tiktokGiftBootRef.current = false;
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const out = await fetchTikTokRoomEvents(
          session.idToken,
          active.sessionId,
        );
        if (cancelled) return;
        setTiktokRoomStatus(out.status);
        setTiktokChat(tiktokEventsToComments(out.events || []));

        const giftEvents = (out.events || []).filter((ev) => ev.kind === "gift");
        if (!tiktokGiftBootRef.current) {
          for (const ev of giftEvents) seenTikTokGiftIdsRef.current.add(ev.id);
          tiktokGiftBootRef.current = true;
        } else {
          for (const ev of giftEvents) {
            if (seenTikTokGiftIdsRef.current.has(ev.id)) continue;
            seenTikTokGiftIdsRef.current.add(ev.id);
            const who = ev.displayName || ev.uniqueId;
            const alert = `${who} ${ev.text}`;
            pushFeedEvent(alert);
            queueStudioAlert({
              kind: "gift",
              text: alert,
              stingId: giftAlertMap.defaultSting,
            });
            if (giftAlertMap.flashGiftOverlay) {
              setOverlayState((prev) => ({ ...prev, gifts: true }));
            }
          }
        }
      } catch {
        /* best-effort */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    active?.sessionId,
    session?.idToken,
    tiktokUniqueId,
    pushFeedEvent,
    queueStudioAlert,
    giftAlertMap,
  ]);

  const alertQueueRef = useRef(alertQueue);
  alertQueueRef.current = alertQueue;
  const ttsPrefsRef = useRef(ttsPrefs);
  ttsPrefsRef.current = ttsPrefs;
  const alertBusyRef = useRef(false);

  const alertPendingCount = alertQueue.items.filter(
    (i) => i.status === "pending",
  ).length;
  const alertDoneCount = alertQueue.items.filter(
    (i) => i.status === "done",
  ).length;

  useEffect(() => {
    if (alertQueue.paused || alertBusyRef.current) return;
    const next = peekNextAlert(alertQueueRef.current);
    if (!next) return;
    alertBusyRef.current = true;
    setAlertQueue((prev) => markAlertPlaying(prev, next.id));
    if (next.stingId) studioAudio.playSting(next.stingId as StingId);
    if (next.text) {
      const trigger =
        next.kind === "gift" || next.kind === "chat" || next.kind === "join"
          ? next.kind
          : "manual";
      speakStudioAlert(next.text, ttsPrefsRef.current, trigger);
    }
    const hold = next.text ? 2200 : 600;
    window.setTimeout(() => {
      setAlertQueue((prev) => markAlertDone(prev, next.id));
      alertBusyRef.current = false;
    }, hold);
  }, [alertQueue.paused, alertPendingCount, alertDoneCount]);

  useEffect(() => {
    const n = onStage.length;
    if (n > lastGuestCountRef.current) {
      const text = "Guest joined the stage";
      pushFeedEvent(text);
      queueStudioAlert({ kind: "join", text, stingId: "join" });
    }
    lastGuestCountRef.current = n;
  }, [onStage.length, pushFeedEvent, queueStudioAlert]);

  useEffect(() => {
    if (!gifts) return;
    const coins = gifts.coinsReceived;
    if (coins > lastGiftCoinsRef.current) {
      const delta = coins - lastGiftCoinsRef.current;
      const text = `Gift +${delta.toLocaleString()} coins`;
      pushFeedEvent(text);
      const sting = resolveGiftSting(delta, giftAlertMap);
      if (sting) {
        queueStudioAlert({ kind: "gift", text, stingId: sting });
      } else {
        queueStudioAlert({ kind: "gift", text });
      }
      if (giftAlertMap.flashGiftOverlay) {
        setOverlayState((prev) => ({ ...prev, gifts: true }));
      }
    }
    lastGiftCoinsRef.current = coins;
  }, [gifts, pushFeedEvent, queueStudioAlert, giftAlertMap]);

  useEffect(() => {
    const newest = chat[0];
    if (!newest || newest.id === lastChatIdRef.current) return;
    if (lastChatIdRef.current != null) {
      const who = (newest.displayName || newest.username || "viewer").slice(
        0,
        18,
      );
      pushFeedEvent(`Chat · ${who}`);
      queueStudioAlert({
        kind: "chat",
        text: `${who} said ${newest.text.slice(0, 80)}`,
      });
    }
    lastChatIdRef.current = newest.id;
  }, [chat, pushFeedEvent, queueStudioAlert]);

  useEffect(() => {
    const tick = () => {
      const track =
        mediaRef.current?.publishStream?.getVideoTracks()?.[0] ||
        mediaRef.current?.previewStream?.getVideoTracks()?.[0] ||
        null;
      const settings = track?.getSettings?.() ?? {};
      const fps = Number(settings.frameRate) || (previewOn ? DESK_PUBLISH_FPS : 0);
      setHealthFps(Math.round(fps));
      if (publishState === "live") setHealthIngest("ok");
      else if (publishState === "publishing" || publishState === "error")
        setHealthIngest("warn");
      else setHealthIngest("idle");
    };
    tick();
    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, [previewOn, publishState, mediaMode]);

  // Top gifters: socket senders + engagement coinsSpent + summary fallback.
  useEffect(() => {
    if (!active?.sessionId || !session?.idToken) {
      topGiftersRef.current = {};
      setTopGifters([]);
      setGifterSourceNote("");
      return;
    }
    let cancelled = false;
    let unsubGift: (() => void) | null = null;

    const publishBoard = (note: string) => {
      if (cancelled) return;
      const ranked = rankTopGifters(topGiftersRef.current, 5);
      setTopGifters(ranked);
      setGifterSourceNote(note);
    };

    const bumpSender = (userId: string, coins: number, name?: string) => {
      if (!userId || coins <= 0) return;
      const cur = topGiftersRef.current[userId] || { coins: 0, name: name || userId };
      topGiftersRef.current[userId] = {
        coins: cur.coins + coins,
        name: name || cur.name || userId,
      };
    };

    const hydrate = async () => {
      const eng = await fetchLiveEngagementSession(
        session.idToken,
        active.sessionId,
      );
      if (cancelled) return;
      if (eng) {
        for (const [uid, row] of Object.entries(eng)) {
          if (row.coinsSpent > 0) {
            const cur = topGiftersRef.current[uid];
            topGiftersRef.current[uid] = {
              coins: Math.max(cur?.coins || 0, row.coinsSpent),
              name: cur?.name || uid.slice(0, 8),
            };
          }
        }
      }
      // Receiver totals help when sender board is empty (API gap until gifts land).
      const totals = await fetchStreamGiftTotals(
        session.idToken,
        active.sessionId,
      );
      if (cancelled) return;
      const ranked = rankTopGifters(topGiftersRef.current, 5);
      if (ranked.length > 0) {
        publishBoard("Session senders · gift socket + engagement");
      } else if (totals && Object.keys(totals.byUser).length > 0) {
        const recv = Object.entries(totals.byUser).map(([userId, row]) => ({
          userId,
          name: userId.slice(0, 10),
          coins: row.coins,
        }));
        setTopGifters(
          recv.sort((a, b) => b.coins - a.coins).slice(0, 5),
        );
        setGifterSourceNote(
          "Showing stage receivers (gift-totals) — sender board fills as gifts arrive",
        );
      } else {
        publishBoard("Waiting for gifts");
      }
    };

    void hydrate();
    const poll = window.setInterval(() => void hydrate(), 12_000);

    void subscribeLiveGiftEvents(
      session.idToken,
      active.sessionId,
      (payload) => {
        const uid = payload.sender?.userId || "";
        const name =
          payload.sender?.handle ||
          payload.sender?.userId?.slice(0, 10) ||
          "viewer";
        bumpSender(uid, Number(payload.coinSpent) || 0, name);
        publishBoard("Live gift socket · ranked by coins sent");
        const alert = `${name} sent a gift`;
        pushFeedEvent(alert);
        const coins = Number(payload.coinSpent) || 0;
        const sting = resolveGiftSting(coins, giftAlertMap) || "gift";
        queueStudioAlert({ kind: "gift", text: alert, stingId: sting });
        const cinema = makeGiftCinemaCue(
          String(payload.giftId || ""),
          payload.giftEventId,
        );
        if (cinema) setGiftCinemaCue(cinema);
        if (giftAlertMap.flashGiftOverlay) {
          setOverlayState((prev) => ({ ...prev, gifts: true }));
        }
      },
    ).then((unsub) => {
      if (cancelled) unsub();
      else unsubGift = unsub;
    });

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      try {
        unsubGift?.();
      } catch {
        /* ignore */
      }
    };
  }, [active?.sessionId, session?.idToken, pushFeedEvent, queueStudioAlert, giftAlertMap]);

  const matrixCounts = useMemo(() => matrixStatusCounts(), []);
  const pendingAlerts = pendingAlertCount(alertQueue);

  const goalPct = useMemo(() => {
    const coins = gifts?.coinsReceived ?? 0;
    if (goalTarget <= 0) return 0;
    return Math.min(100, Math.round((coins / goalTarget) * 100));
  }, [gifts?.coinsReceived, goalTarget]);

  const giftsLabel = useMemo(() => {
    if (!gifts) return "Gift alerts";
    return `${gifts.viewerGiftCount} gifts · ${gifts.coinsReceived.toLocaleString()} coins`;
  }, [gifts]);

  const railChat = useMemo(() => {
    const merged = [...chat, ...tiktokChat];
    merged.sort((a, b) => b.createdAt - a.createdAt);
    return merged.slice(0, 40);
  }, [chat, tiktokChat]);

  const chatLines = useMemo(
    () =>
      railChat.slice(0, 6).map((c) => ({
        name: c.displayName || c.username || "viewer",
        text: c.text,
      })),
    [railChat],
  );

  const giftersLines = useMemo(() => {
    if (topGifters.length > 0) {
      return topGifters.map(
        (g, i) => `${i + 1}. ${g.name} · ${g.coins.toLocaleString()}`,
      );
    }
    if (!gifts || gifts.viewerGiftCount <= 0) {
      return ["Waiting…", "—", "—"];
    }
    return [
      `${gifts.viewerGiftCount} gifts (aggregate)`,
      `${gifts.coinsReceived.toLocaleString()} coins`,
      `${gifts.gemsEarned.toLocaleString()} gems`,
    ];
  }, [topGifters, gifts]);

  const overlayRemoteKey = useMemo(
    () =>
      JSON.stringify({
        ready: overlayPosReady,
        overlays: overlayState,
        maps: overlayMaps,
        chat: chatLines,
        giftsLabel,
        giftCinema: giftCinemaCue
          ? `${giftCinemaCue.giftEventId}:${giftCinemaCue.giftId}`
          : "",
        goalPct,
        goalTarget,
        jukeboxNow,
        jukeboxArt,
        jukeboxTitle,
        jukeboxArtist,
        jukeboxNext,
        jukeboxPaused,
        events: feedEvents.map((e) => `${e.id}:${e.text}`),
        watchUrl,
        gifters: giftersLines,
        themeCss,
        sessionId: active?.sessionId || "",
        authed: Boolean(session?.idToken),
      }),
    [
      overlayPosReady,
      overlayState,
      overlayMaps,
      chatLines,
      giftsLabel,
      giftCinemaCue,
      goalPct,
      goalTarget,
      jukeboxNow,
      jukeboxArt,
      jukeboxTitle,
      jukeboxArtist,
      jukeboxNext,
      jukeboxPaused,
      feedEvents,
      watchUrl,
      giftersLines,
      themeCss,
      active?.sessionId,
      session?.idToken,
    ],
  );

  const overlayUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${overlayBrowserSourcePath(active?.sessionId)}`
      : overlayBrowserSourcePath(active?.sessionId);
  const deckUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${deckCompanionPath()}`
      : deckCompanionPath();

  const clearOverlayRemoteTimers = useCallback(() => {
    if (overlayRemoteDebounceRef.current != null) {
      window.clearTimeout(overlayRemoteDebounceRef.current);
      overlayRemoteDebounceRef.current = null;
    }
    if (overlayRemoteMaxWaitRef.current != null) {
      window.clearTimeout(overlayRemoteMaxWaitRef.current);
      overlayRemoteMaxWaitRef.current = null;
    }
  }, []);

  const flushOverlayFeedRemote = useCallback(() => {
    clearOverlayRemoteTimers();
    const snap = overlayFeedSnapRef.current;
    const creds = overlayRemoteSessionRef.current;
    if (!snap || !creds?.sessionId) return;
    const payload: OverlayFeedSnapshot = { ...snap, updatedAt: Date.now() };
    if (creds.idToken) {
      void publishOverlayFeedRemote(creds.sessionId, creds.idToken, payload);
    }
    void updateLiveSessionMeta(creds.sessionId, {
      studioOverlayFeed: payload as unknown as Record<string, unknown>,
    })
      .then(() =>
        setOverlaySyncNote(
          `Mirrored · OBS on another PC: ${overlayBrowserSourcePath(creds.sessionId)}`,
        ),
      )
      .catch(() =>
        setOverlaySyncNote(
          "Mirror write blocked — same-browser overlay still works; remote ?session= needs host Firestore write",
        ),
      );
  }, [clearOverlayRemoteTimers]);

  const scheduleOverlayFeedRemote = useCallback(() => {
    if (!overlayRemoteSessionRef.current?.sessionId) return;
    if (overlayRemoteDebounceRef.current != null) {
      window.clearTimeout(overlayRemoteDebounceRef.current);
    }
    overlayRemoteDebounceRef.current = window.setTimeout(() => {
      overlayRemoteDebounceRef.current = null;
      flushOverlayFeedRemote();
    }, OVERLAY_REMOTE_DEBOUNCE_MS);
    if (overlayRemoteMaxWaitRef.current == null) {
      overlayRemoteMaxWaitRef.current = window.setTimeout(() => {
        overlayRemoteMaxWaitRef.current = null;
        flushOverlayFeedRemote();
      }, OVERLAY_REMOTE_MAX_WAIT_MS);
    }
  }, [flushOverlayFeedRemote]);

  useEffect(() => {
    return () => clearOverlayRemoteTimers();
  }, [clearOverlayRemoteTimers]);

  useEffect(() => {
    if (!overlayPosReady) return;
    const snap: OverlayFeedSnapshot = {
      v: 1,
      overlays: overlayState,
      positions: overlayPositions,
      positionsPortrait: overlayMaps.portrait,
      positionsLandscape: overlayMaps.landscape,
      layoutPortrait:
        orientation === "portrait"
          ? coerceLayout(viewerLayout, "portrait")
          : lastPortraitLayoutRef.current,
      layoutLandscape:
        orientation === "landscape"
          ? coerceLayout(viewerLayout, "landscape")
          : lastLandscapeLayoutRef.current,
      chatLines,
      giftsLabel,
      giftCinema: giftCinemaCue,
      goalPct,
      goalLabel: `Goal ${goalPct}% · ${goalTarget.toLocaleString()}`,
      jukeboxNow,
      jukeboxArt,
      jukeboxTitle,
      jukeboxArtist,
      jukeboxNext,
      jukeboxPos,
      jukeboxDur,
      jukeboxPaused,
      events: feedEvents,
      timerLabel,
      viewers: mirror?.viewerCount ?? 0,
      watchUrl,
      gifters: giftersLines,
      themeCss,
      sessionId: active?.sessionId || "",
      updatedAt: Date.now(),
    };
    overlayFeedSnapRef.current = snap;
    writeOverlayFeed(snap);
    if (active?.sessionId) scheduleOverlayFeedRemote();
  }, [
    overlayPosReady,
    overlayState,
    overlayPositions,
    overlayMaps,
    chatLines,
    giftsLabel,
    giftCinemaCue,
    goalPct,
    goalTarget,
    jukeboxNow,
    jukeboxArt,
    jukeboxTitle,
    jukeboxArtist,
    jukeboxNext,
    jukeboxPos,
    jukeboxDur,
    jukeboxPaused,
    feedEvents,
    timerLabel,
    mirror?.viewerCount,
    watchUrl,
    giftersLines,
    themeCss,
    active?.sessionId,
    orientation,
    viewerLayout,
    scheduleOverlayFeedRemote,
  ]);

  useEffect(() => {
    overlayRemoteSessionRef.current = active?.sessionId
      ? { sessionId: active.sessionId, idToken: session?.idToken || "" }
      : null;
    if (!active?.sessionId) {
      clearOverlayRemoteTimers();
      setOverlaySyncNote(
        "Same-browser OBS · go LIVE to mirror overlay for another PC (?session=)",
      );
      return undefined;
    }
    if (!overlayPosReady) return undefined;
    scheduleOverlayFeedRemote();
    return undefined;
  }, [
    overlayRemoteKey,
    active?.sessionId,
    session?.idToken,
    overlayPosReady,
    clearOverlayRemoteTimers,
    scheduleOverlayFeedRemote,
  ]);

  useEffect(() => {
    if (!active?.sessionId || !overlayPosReady) return undefined;
    overlayRemoteSessionRef.current = {
      sessionId: active.sessionId,
      idToken: session?.idToken || "",
    };
    const id = window.setInterval(() => {
      flushOverlayFeedRemote();
    }, OVERLAY_REMOTE_MAX_WAIT_MS);
    return () => window.clearInterval(id);
  }, [
    active?.sessionId,
    overlayPosReady,
    session?.idToken,
    flushOverlayFeedRemote,
  ]);

  const playPad = useCallback(
    (id: StingId) => {
      studioAudio.playSting(id);
      const name = STING_PAD.find((s) => s.id === id)?.name || id;
      pushFeedEvent(`SFX · ${name}`);
      pushToast(`${name} sting`);
    },
    [pushFeedEvent, pushToast],
  );

  /** Nukemonkey bomb-strike: play when Grid/Host+9 armed; otherwise arm Grid 3×3. */
  const playNukeOrArm = useCallback(() => {
    if (!isStrikeLayout(phoneLayout)) {
      const next = coerceLayout("grid-3x3", orientation);
      setViewerLayout(next);
      if (orientation === "landscape") {
        lastLandscapeLayoutRef.current = next;
      } else {
        lastPortraitLayoutRef.current = next;
      }
      pushToast("Grid 3×3 armed — click a cell or Nuke again");
      pushFeedEvent("Nuke · armed Grid 3×3");
      return;
    }
    const i = liveTestStrikeCursor % 9;
    liveTestStrikeCursor += 1;
    playBombStrike(i);
    pushFeedEvent(`Nuke · cell ${i}`);
    pushToast(`Nuke → cell ${i}`);
  }, [phoneLayout, orientation, pushFeedEvent, pushToast]);

  const playJukeboxFile = useCallback(
    async (track: JukeboxTrack) => {
      const ok = await studioAudio.playFile(track.file);
      if (ok) {
        setActiveBed("file");
        setJukeboxNow(track.name);
        setJukeboxTitle(track.name);
        setJukeboxArtist("Local audio");
        setJukeboxArt(null);
        setOverlayState((prev) =>
          prev.jukebox ? prev : { ...prev, jukebox: true },
        );
        pushFeedEvent(`Now playing · ${track.name}`);
        pushToast(`Playing ${track.name}`);
      } else {
        pushToast("Could not play that file — click once to unlock audio");
      }
    },
    [pushFeedEvent, pushToast],
  );

  const onAddJukeboxFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const added: JukeboxTrack[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files.item(i);
        if (!file || !file.type.startsWith("audio/")) continue;
        added.push({
          id: `trk-${Date.now().toString(36)}-${i}`,
          name: file.name.replace(/\.[^.]+$/, "").slice(0, 40),
          file,
        });
      }
      if (!added.length) {
        pushToast("Pick an audio file (mp3 / wav / m4a)");
        return;
      }
      setJukeboxQueue((prev) => [...prev, ...added].slice(0, 20));
      setOverlayState((prev) =>
        prev.jukebox ? prev : { ...prev, jukebox: true },
      );
      pushToast(`Added ${added.length} to jukebox`);
      if (!studioAudio.isMusicPlaying()) {
        void playJukeboxFile(added[0]);
      }
    },
    [playJukeboxFile, pushToast],
  );

  const copyOverlayUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      pushToast("Overlay URL copied — paste into OBS Browser Source");
    } catch {
      pushToast(overlayUrl);
    }
  }, [overlayUrl, pushToast]);

  const copyDeckUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(deckUrl);
      pushToast("Deck URL copied — Stream Deck Website action");
    } catch {
      pushToast(deckUrl);
    }
  }, [deckUrl, pushToast]);

  const saveCurrentScene = useCallback(() => {
    const name = sceneName.trim() || `Scene ${programScenes.length + 1}`;
    const next = upsertProgramScene(programScenes, {
      name,
      mediaMode,
      mainSource,
      pipOn,
      pipSource,
      orientation,
      layout: coerceLayout(viewerLayout, orientation),
      overlays: overlayState,
      positions: overlayPositions,
    });
    setProgramScenes(next);
    saveProgramScenes(next);
    setSelectedSceneId(next[0]?.id || "");
    setSceneName("");
    pushToast(`Scene “${name}” saved`);
  }, [
    sceneName,
    programScenes,
    mediaMode,
    mainSource,
    pipOn,
    pipSource,
    orientation,
    viewerLayout,
    overlayState,
    overlayPositions,
    pushToast,
  ]);

  const removeSelectedScene = useCallback(() => {
    if (!selectedSceneId) return;
    const next = deleteProgramScene(programScenes, selectedSceneId);
    setProgramScenes(next);
    saveProgramScenes(next);
    setSelectedSceneId("");
    pushToast("Scene removed");
  }, [selectedSceneId, programScenes, pushToast]);

  const saveCurrentPreset = useCallback(() => {
    const name = presetName.trim() || `Studio ${studioPresets.length + 1}`;
    const next = upsertStudioPreset(studioPresets, {
      name,
      orientation,
      layout: coerceLayout(viewerLayout, orientation),
      overlays: overlayState,
      positions: overlayPositions,
    });
    setStudioPresets(next);
    saveStudioPresets(next);
    setSelectedPresetId(next[0]?.id || "");
    setPresetName("");
    pushToast(`Saved “${name}”`);
  }, [
    presetName,
    studioPresets,
    orientation,
    viewerLayout,
    overlayState,
    overlayPositions,
    pushToast,
  ]);

  const removeSelectedPreset = useCallback(() => {
    if (!selectedPresetId) return;
    const next = deleteStudioPreset(studioPresets, selectedPresetId);
    setStudioPresets(next);
    saveStudioPresets(next);
    setSelectedPresetId("");
    pushToast("Preset removed");
  }, [selectedPresetId, studioPresets, pushToast]);

  const toggleOverlay = (id: keyof OverlayState) => {
    setOverlayState((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const setOverlayPositions = useCallback(
    (next: OverlayPositions | ((prev: OverlayPositions) => OverlayPositions)) => {
      setOverlayMaps((prev) => {
        const cur = prev[orientation];
        const resolved = typeof next === "function" ? next(cur) : next;
        return { ...prev, [orientation]: resolved };
      });
    },
    [orientation],
  );

  const setOverlayPos = useCallback(
    (id: StudioOverlayId, next: OverlayPos) => {
      setOverlayPositions((prev) => ({ ...prev, [id]: next }));
    },
    [setOverlayPositions],
  );

  const resetOverlayPositions = useCallback(() => {
    setOverlayPositions({ ...DEFAULT_OVERLAY_POSITIONS });
    pushToast("Overlay positions reset");
  }, [pushToast, setOverlayPositions]);

  const onJukeboxPlayhead = useCallback((position: number, duration: number) => {
    setJukeboxPos(position);
    setJukeboxDur(duration);
  }, []);

  const jukeboxMetaSigRef = useRef("");
  const onJukeboxNow = useCallback(
    (info: JukeboxNowInfo) => {
      const title = info.title || "";
      const artist = info.artist || "";
      const art = info.art ?? null;
      const next = info.nextTitle || "";
      const paused = typeof info.paused === "boolean" ? info.paused : false;
      const label = info.label;
      if (typeof info.position === "number") setJukeboxPos(info.position);
      if (typeof info.duration === "number") setJukeboxDur(info.duration);
      const sig = `${label}\n${title}\n${artist}\n${art || ""}\n${next}\n${paused}`;
      if (jukeboxMetaSigRef.current === sig) return;
      jukeboxMetaSigRef.current = sig;
      setJukeboxNow(label);
      setJukeboxTitle(title);
      setJukeboxArtist(artist);
      setJukeboxArt(art);
      setJukeboxNext(next);
      setJukeboxPaused(paused);
      if (title) {
        setOverlayState((prev) =>
          prev.jukebox ? prev : { ...prev, jukebox: true },
        );
      }
    },
    [],
  );

  const setOverlayScale = useCallback((id: StudioOverlayId, scale: number) => {
    setOverlayPositions((prev) => ({
      ...prev,
      [id]: { ...prev[id], scale: clampOverlayScale(scale) },
    }));
  }, [setOverlayPositions]);

  const visibleLeftIds = useMemo(
    () =>
      leftRailOrder.filter(
        (id) => id !== "dest" || boothMode !== "team-desk",
      ),
    [leftRailOrder, boothMode],
  );

  const leftSlotProps = (id: LeftRailId) => {
    const i = visibleLeftIds.indexOf(id);
    return {
      title: LEFT_RAIL_LABELS[id],
      order: i < 0 ? 99 : i,
      canUp: i > 0,
      canDown: i >= 0 && i < visibleLeftIds.length - 1,
      onUp: () => setLeftRailOrder((o) => moveRailId(o, id, -1)),
      onDown: () => setLeftRailOrder((o) => moveRailId(o, id, 1)),
    };
  };

  const rightSlotProps = (id: RightRailId) => {
    const i = rightRailOrder.indexOf(id);
    return {
      title: RIGHT_RAIL_LABELS[id],
      order: i < 0 ? 99 : i,
      canUp: i > 0,
      canDown: i >= 0 && i < rightRailOrder.length - 1,
      onUp: () => setRightRailOrder((o) => moveRailId(o, id, -1)),
      onDown: () => setRightRailOrder((o) => moveRailId(o, id, 1)),
    };
  };

  const onStart = async () => {
    if (!session?.idToken) {
      requireAuth("Log in to go LIVE");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // AuthProvider only refreshes on mount — force a Cognito refresh before
      // /api/live/start so a long Studio tab does not send a dead JWT.
      const stored = loadStoredSession();
      const fresh = stored?.refreshToken
        ? (await forceRefreshSession(stored)) ||
          (await refreshSessionIfNeeded(stored))
        : null;
      const idToken = fresh?.idToken || session.idToken;
      const sub = fresh?.sub || session.sub;
      const username = fresh?.username || session.username;
      if (!idToken) {
        requireAuth(SESSION_EXPIRED_MSG);
        setError(SESSION_EXPIRED_MSG);
        return;
      }
      const tabAudioOk = await armSpotifyTabAudioForLive();
      if (isStudioSpotifyLinked() && !tabAudioOk) {
        setError(TAB_AUDIO_REQUIRED);
        return;
      }
      await ensureFirebaseFromCognito({
        cognitoIdToken: idToken,
        uid: sub,
      });
      const host = await startLiveHostSession(
        idToken,
        title.trim() || `${username || "Host"} LIVE`,
      );
      setActive(host);
      const published = await beginPublish(host, mediaMode);
      if (!published) {
        return;
      }
      try {
        await heartbeatLiveHostSession(idToken, host.sessionId, {
          studioOrientation: orientation,
          studioLayout: coerceLayout(viewerLayout, orientation),
        });
      } catch {
        /* first heartbeat best-effort until live-service deploy lands */
      }

      const fanoutDests = collectFanoutDests(destSnapRef.current);
      if (fanoutDests.length > 0) {
        try {
          await prepareBroadcast(
            idToken,
            host.sessionId,
            fanoutDests,
          );
          const fanout = await startBroadcastFanoutWhenReady(
            idToken,
            host.sessionId,
          );
          setBroadcastView(fanout.view);
          if (fanout.view.phase === "provisioning") {
            pushToast(
              fanout.view.message ||
                "Provisioning broadcast servers (~45s)…",
            );
          } else if (fanout.view.phase === "live") {
            pushToast(
              `${fanoutDests.map((d) => fanoutDestLabel(d.platform)).join(" + ")} connected`,
            );
          }
        } catch (fanoutErr) {
          const msg =
            fanoutErr instanceof Error ? fanoutErr.message : "Fan-out failed";
          pushToast(`Extra destination: ${msg} — Blyp LIVE continues`);
          setBroadcastView({
            sessionId: host.sessionId,
            phase: "failed",
            region: host.region || "",
            workerAssigned: false,
            provisioningEtaSeconds: null,
            message: null,
            errorDetail: msg,
            destinations: [],
            updatedAt: new Date().toISOString(),
          });
        }
      }

      if (tiktokUniqueId) {
        try {
          const room = await startTikTokRoom(
            idToken,
            host.sessionId,
            tiktokUniqueId,
          );
          setTiktokRoomStatus(room.status);
        } catch (roomErr) {
          const msg =
            roomErr instanceof Error ? roomErr.message : "TikTok chat failed";
          pushToast(`TikTok comments: ${msg}`);
        }
      }

      pushToast("Session live — publishing from this browser");
    } catch (e) {
      const raw = e instanceof Error ? e.message : "Failed to start LIVE";
      const msg = formatLiveAuthError(raw);
      if (msg === SESSION_EXPIRED_MSG) {
        requireAuth(SESSION_EXPIRED_MSG);
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;

  const onEnd = async () => {
    if (!session?.idToken || !active?.sessionId) return;
    setBusy(true);
    setError(null);
    try {
      try {
        await stopTikTokRoom(session.idToken, active.sessionId);
      } catch {
        /* best-effort */
      }
      await stopPublish();
      releaseMedia();
      await endLiveHostSession(session.idToken, active.sessionId);
      setActive(null);
      setGuestRows([]);
      setChat([]);
      setGifts(null);
      setMirror(null);
      setBroadcastView(null);
      setTiktokEnabled(false);
      setTiktokPreflightReady(false);
      setTiktokRtmpUrl("");
      setTiktokStreamKey("");
      setYoutubeEnabled(false);
      setYoutubePreflightReady(false);
      setYoutubeRtmpUrl(YOUTUBE_DEFAULT_RTMP);
      setYoutubeStreamKey("");
      setTwitchEnabled(false);
      setTwitchPreflightReady(false);
      setTwitchRtmpUrl(TWITCH_DEFAULT_RTMP);
      setTwitchStreamKey("");
      setFacebookEnabled(false);
      setFacebookPreflightReady(false);
      setFacebookRtmpUrl(FACEBOOK_DEFAULT_RTMP);
      setFacebookStreamKey("");
      setKickEnabled(false);
      setKickPreflightReady(false);
      setKickRtmpUrl(KICK_DEFAULT_RTMP);
      setKickStreamKey("");
      setTiktokChat([]);
      setTiktokRoomStatus(null);
      pushToast("LIVE ended");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to end LIVE");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (
      !session?.idToken ||
      !active?.sessionId ||
      (!tiktokEnabled &&
        !youtubeEnabled &&
        !twitchEnabled &&
        !facebookEnabled &&
        !kickEnabled) ||
      broadcastView?.phase !== "provisioning"
    ) {
      return;
    }
    let alive = true;
    const poll = window.setInterval(() => {
      void fetchBroadcastStatus(session.idToken, active.sessionId)
        .then((out) => {
          if (!alive) return;
          setBroadcastView(out.view);
          if (out.view.phase === "live") {
            pushToast("Extra destinations live");
          }
        })
        .catch(() => {
          /* best-effort */
        });
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(poll);
    };
  }, [
    session?.idToken,
    active?.sessionId,
    tiktokEnabled,
    youtubeEnabled,
    twitchEnabled,
    facebookEnabled,
    kickEnabled,
    broadcastView?.phase,
    pushToast,
  ]);

  const handlePrimaryLiveAction = useCallback(() => {
    if (!session) {
      requireAuth("Log in to go LIVE");
      return;
    }
    void onStartRef.current();
  }, [session, requireAuth]);

  const prepareLiveFanout = useCallback(
    async (dests: BroadcastPrepareDest[]) => {
      if (!session?.idToken || !active?.sessionId || dests.length === 0) {
        return;
      }
      try {
        await prepareBroadcast(
          session.idToken,
          active.sessionId,
          dests,
        );
        const started = await startBroadcastFanoutWhenReady(
          session.idToken,
          active.sessionId,
        );
        setBroadcastView(started.view);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Prepare failed";
        pushToast(`Destinations: ${msg}`);
      }
    },
    [session?.idToken, active?.sessionId, pushToast],
  );

  const commitFanout = useCallback(
    (overrides: Partial<FanoutSnap>) => {
      const dests = collectFanoutDests({ ...destSnapRef.current, ...overrides });
      if (dests.length === 0) setBroadcastView(null);
      else void prepareLiveFanout(dests);
    },
    [prepareLiveFanout],
  );

  const handleDisableTikTok = useCallback(() => {
    setTiktokEnabled(false);
    setTiktokPreflightReady(false);
    setTiktokRtmpUrl("");
    setTiktokStreamKey("");
    setTiktokChat([]);
    setTiktokRoomStatus(null);
    commitFanout({ tiktokReady: false, tiktokRtmpUrl: "", tiktokStreamKey: "" });
  }, [commitFanout]);

  const handleDisableYouTube = useCallback(() => {
    setYoutubeEnabled(false);
    setYoutubePreflightReady(false);
    setYoutubeRtmpUrl(YOUTUBE_DEFAULT_RTMP);
    setYoutubeStreamKey("");
    commitFanout({
      youtubeReady: false,
      youtubeRtmpUrl: YOUTUBE_DEFAULT_RTMP,
      youtubeStreamKey: "",
    });
  }, [commitFanout]);

  const handleDisableTwitch = useCallback(() => {
    setTwitchEnabled(false);
    setTwitchPreflightReady(false);
    setTwitchRtmpUrl(TWITCH_DEFAULT_RTMP);
    setTwitchStreamKey("");
    commitFanout({
      twitchReady: false,
      twitchRtmpUrl: TWITCH_DEFAULT_RTMP,
      twitchStreamKey: "",
    });
  }, [commitFanout]);

  const handleDisableFacebook = useCallback(() => {
    setFacebookEnabled(false);
    setFacebookPreflightReady(false);
    setFacebookRtmpUrl(FACEBOOK_DEFAULT_RTMP);
    setFacebookStreamKey("");
    commitFanout({
      facebookReady: false,
      facebookRtmpUrl: FACEBOOK_DEFAULT_RTMP,
      facebookStreamKey: "",
    });
  }, [commitFanout]);

  const handleDisableKick = useCallback(() => {
    setKickEnabled(false);
    setKickPreflightReady(false);
    setKickRtmpUrl(KICK_DEFAULT_RTMP);
    setKickStreamKey("");
    commitFanout({
      kickReady: false,
      kickRtmpUrl: KICK_DEFAULT_RTMP,
      kickStreamKey: "",
    });
  }, [commitFanout]);

  const handleTikTokSaved = useCallback(
    (input: { rtmpUrl: string; streamKey: string; uniqueId: string }) => {
      setTiktokRtmpUrl(input.rtmpUrl);
      setTiktokStreamKey(input.streamKey);
      setTiktokUniqueId(input.uniqueId);
      setTiktokEnabled(true);
      setTiktokPreflightReady(true);
      try {
        window.localStorage.setItem(TIKTOK_HANDLE_KEY, input.uniqueId);
      } catch {
        /* ignore */
      }
      pushToast("TikTok ready — included when you GO LIVE");
      commitFanout({
        tiktokReady: true,
        tiktokRtmpUrl: input.rtmpUrl,
        tiktokStreamKey: input.streamKey,
      });
      if (active?.sessionId && session?.idToken) {
        seenTikTokGiftIdsRef.current.clear();
        tiktokGiftBootRef.current = false;
        void startTikTokRoom(session.idToken, active.sessionId, input.uniqueId)
          .then((room) => setTiktokRoomStatus(room.status))
          .catch((roomErr) => {
            const msg =
              roomErr instanceof Error ? roomErr.message : "TikTok chat failed";
            pushToast(`TikTok comments: ${msg}`);
          });
      }
    },
    [active?.sessionId, session?.idToken, pushToast, commitFanout],
  );

  const handleYouTubeSaved = useCallback(
    (input: { rtmpUrl: string; streamKey: string }) => {
      setYoutubeRtmpUrl(input.rtmpUrl);
      setYoutubeStreamKey(input.streamKey);
      setYoutubeEnabled(true);
      setYoutubePreflightReady(true);
      pushToast("YouTube ready — included when you GO LIVE");
      commitFanout({
        youtubeReady: true,
        youtubeRtmpUrl: input.rtmpUrl,
        youtubeStreamKey: input.streamKey,
      });
    },
    [pushToast, commitFanout],
  );

  const handleTwitchSaved = useCallback(
    (input: { rtmpUrl: string; streamKey: string }) => {
      setTwitchRtmpUrl(input.rtmpUrl);
      setTwitchStreamKey(input.streamKey);
      setTwitchEnabled(true);
      setTwitchPreflightReady(true);
      pushToast("Twitch ready — included when you GO LIVE");
      commitFanout({
        twitchReady: true,
        twitchRtmpUrl: input.rtmpUrl,
        twitchStreamKey: input.streamKey,
      });
    },
    [pushToast, commitFanout],
  );

  const handleFacebookSaved = useCallback(
    (input: { rtmpUrl: string; streamKey: string }) => {
      setFacebookRtmpUrl(input.rtmpUrl);
      setFacebookStreamKey(input.streamKey);
      setFacebookEnabled(true);
      setFacebookPreflightReady(true);
      pushToast("Facebook ready — included when you GO LIVE");
      commitFanout({
        facebookReady: true,
        facebookRtmpUrl: input.rtmpUrl,
        facebookStreamKey: input.streamKey,
      });
    },
    [pushToast, commitFanout],
  );

  const handleKickSaved = useCallback(
    (input: { rtmpUrl: string; streamKey: string }) => {
      setKickRtmpUrl(input.rtmpUrl);
      setKickStreamKey(input.streamKey);
      setKickEnabled(true);
      setKickPreflightReady(true);
      pushToast("Kick ready — included when you GO LIVE");
      commitFanout({
        kickReady: true,
        kickRtmpUrl: input.rtmpUrl,
        kickStreamKey: input.streamKey,
      });
    },
    [pushToast, commitFanout],
  );

  const attachPreview = useCallback((media: DeskMediaHandle) => {
    const stream = media.previewStream;
    const live = mediaStreamHasLiveVideo(stream);
    // gum already succeeded — never leave the "No preview" overlay.
    if (live) setPreviewOn(true);
    setError(null);

    const tryBind = (attempt: number) => {
      const el = videoRef.current;
      if (!el) {
        if (attempt < 12) {
          window.requestAnimationFrame(() => tryBind(attempt + 1));
        } else if (live) {
          setError("MediaStreamTrack: live, but program <video> was not mounted");
        }
        return;
      }
      void bindProgramVideo(el, stream).catch((err) => {
        const named = formatGumError(err, "video.play()");
        if (live) {
          setError(`Preview attach failed — ${named}`);
        }
      });
      const pipEl = pipVideoRef.current;
      const pip = media.pipPreviewStream;
      if (pipEl && pip && mediaStreamHasLiveVideo(pip)) {
        void bindProgramVideo(pipEl, pip).catch(() => undefined);
      } else if (pipEl) {
        pipEl.srcObject = null;
      }
    };
    tryBind(0);
  }, []);

  useEffect(() => {
    if (!mediaRef.current) return;
    const id = window.requestAnimationFrame(() => {
      if (mediaRef.current) attachPreview(mediaRef.current);
    });
    return () => window.cancelAnimationFrame(id);
  }, [phoneLayout.id, phoneLayout.hostInGrid, attachPreview, pipOn]);

  const armGesturePreview = useCallback(
    (mode: DeskMediaMode, orient: DeskOrientation) => {
      if (gesturePreviewArmedRef.current) return;
      gesturePreviewArmedRef.current = true;
      const run = () => {
        window.removeEventListener("pointerdown", run, true);
        window.removeEventListener("keydown", run, true);
        gesturePreviewArmedRef.current = false;
        void startPreviewRef.current(mode, orient);
      };
      window.addEventListener("pointerdown", run, true);
      window.addEventListener("keydown", run, true);
    },
    [],
  );

  const startPreview = useCallback(
    async (mode?: DeskMediaMode, orient?: DeskOrientation) => {
      const resolved = mode || mediaMode;
      const resolvedOrient = orient || orientation;
      const openGen = ++previewOpenGenRef.current;
      setBusy(true);
      setError(null);
      setGumDebug({ status: "idle" });
      setCamOff(false);
      setMicMuted(false);
      if (resolved === "camera") {
        setMainSource((prev) =>
          prev === "phone" || prev === "other" || prev === "screen"
            ? prev
            : "laptop",
        );
        setMediaMode("camera");
      }
      try {
        let next: DeskMediaHandle;
        if (resolved === "camera") {
          const prev = mediaRef.current;
          if (
            liveCameraMatchesDevice(prev, cameraDeviceId) &&
            prev?.orientation === resolvedOrient
          ) {
            next = prev!;
            next.previewStream.getTracks().forEach((t) => {
              t.enabled = true;
            });
          } else {
            if (prev) {
              try {
                prev.stop({
                  keepCamera: prev.orientation === resolvedOrient,
                });
              } catch {
                /* ignore */
              }
              mediaRef.current = null;
            }
            next = await openDeskMedia(
              "camera",
              resolvedOrient,
              null,
              cameraDeviceId,
            );
          }
        } else {
          next = await openDeskMedia(resolved, resolvedOrient, null, null);
        }
        if (openGen !== previewOpenGenRef.current) {
          // Newer open owns preview — do not stop a live cam we just acquired.
          return;
        }
        const prev = mediaRef.current;
        mediaRef.current = next;
        if (prev && prev !== next && prev.mode !== "camera") {
          try {
            prev.stop({ keepCamera: true });
          } catch {
            /* ignore */
          }
        }
        attachPreview(next);
        setMediaMode(resolved);
        const liveId = next.previewStream.getVideoTracks()[0]?.getSettings()
          ?.deviceId;
        if (liveId) setCameraDeviceId(liveId);
        if (resolved === "camera") {
          setMainSource((prev) =>
            prev === "phone" || prev === "other" ? prev : "laptop",
          );
          setPipOn(false);
        }
        setMicMuted(false);
        setCamOff(false);
        setError(null);
        setGumDebug(getLastGumDebug());
        studioAudio.attachMic(next.previewStream);
        autoPreviewStartedRef.current = true;
      } catch (e) {
        if (openGen !== previewOpenGenRef.current) return;
        setGumDebug(getLastGumDebug());
        const dbg = getLastGumDebug();
        const name =
          dbg.name ||
          (e instanceof DOMException ? e.name : "") ||
          (e instanceof Error ? e.name : "Error");
        const raw =
          e instanceof Error ? e.message : "Could not open camera or screen";
        const banner = formatStudioCamOpenError(e);
        setCamOff(false);
        if (resolved === "camera") {
          setMainSource("laptop");
        }
        if (name === "NotAllowedError" || /Permission|NotAllowed/i.test(raw)) {
          setError(`${banner} — tap anywhere to enable the camera`);
          armGesturePreview(resolved, resolvedOrient);
          autoPreviewStartedRef.current = true;
        } else {
          setError(banner);
          autoPreviewStartedRef.current = false;
        }
      } finally {
        if (openGen === previewOpenGenRef.current) {
          setBusy(false);
        }
      }
    },
    [armGesturePreview, attachPreview, cameraDeviceId, mediaMode, orientation],
  );

  startPreviewRef.current = startPreview;

  const applyTopPreset = useCallback(
    (presetId: string) => {
      const p = TOP_LAYOUT_PRESETS.find((x) => x.id === presetId);
      if (!p) return;
      const nextOrient = p.orientation;
      const nextLayout = coerceLayout(p.layout as StageLayoutId, nextOrient);
      if (orientation === "landscape" && nextOrient === "portrait") {
        lastLandscapeLayoutRef.current = viewerLayout;
      } else if (orientation === "portrait" && nextOrient === "landscape") {
        lastPortraitLayoutRef.current = viewerLayout;
      }
      if (nextOrient === "landscape") {
        lastLandscapeLayoutRef.current = nextLayout;
      } else {
        lastPortraitLayoutRef.current = nextLayout;
      }
      setBoothMode(nextOrient);
      setOrientation(nextOrient);
      setViewerLayout(nextLayout);
    },
    [orientation, viewerLayout],
  );

  const loadPresetById = useCallback(
    (id: string) => {
      const p = studioPresets.find((x) => x.id === id);
      if (!p) return;
      setSelectedPresetId(id);
      const nextOrient = p.orientation;
      const nextLayout = coerceLayout(p.layout as StageLayoutId, nextOrient);
      setBoothMode(nextOrient);
      setOrientation(nextOrient);
      setViewerLayout(nextLayout);
      setOverlayState({ ...p.overlays });
      setOverlayPositions(normalizeOverlayPositions(p.positions));
      pushToast(`Loaded “${p.name}”`);
    },
    [studioPresets, pushToast, setOverlayPositions],
  );

  /** Host+9 portrait default + simple getUserMedia preview on mount (desktop only). */
  useEffect(() => {
    if (loading) return;
    if (previewOn || mediaRef.current) return;
    // Phone UA only — never bail on (pointer: coarse); touch Windows laptops
    // must still auto-open the USB webcam.
    if (typeof navigator !== "undefined") {
      const ua = navigator.userAgent || "";
      if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) {
        autoPreviewStartedRef.current = true;
        return;
      }
    }
    if (autoPreviewStartedRef.current) return;

    autoPreviewStartedRef.current = true;
    setBoothMode("portrait");
    setViewerLayout(initialPortraitStudioLayout());
    setMainSource("laptop");
    setPipOn(false);
    setPipSource("laptop");
    setMediaMode("camera");
    setOrientation("portrait");
    setCamOff(false);
    setMicMuted(false);
    // Isolated getUserMedia({ video: true }) then attach <video>.
    void startPreviewRef.current("camera", "portrait");

    // Do not reset autoPreviewStartedRef on Strict Mode cleanup — that double-fired
    // openCamera, stopped the live stream, and left Cam off + NotReadableError.
  }, [loading, previewOn]);

  const setTrackEnabled = (kind: "audio" | "video", enabled: boolean) => {
    const streams = [
      mediaRef.current?.previewStream,
      mediaRef.current?.publishStream,
    ];
    for (const stream of streams) {
      stream
        ?.getTracks()
        .filter((t) => t.kind === kind)
        .forEach((t) => {
          t.enabled = enabled;
        });
    }
  };

  const trackIsLive = (kind: "audio" | "video") =>
    !!mediaRef.current?.previewStream
      ?.getTracks()
      .some((t) => t.kind === kind && t.readyState === "live");

  const trackIsEnabled = (kind: "audio" | "video") =>
    !!mediaRef.current?.previewStream
      ?.getTracks()
      .some((t) => t.kind === kind && t.readyState === "live" && t.enabled);

  const toggleCam = useCallback(() => {
    if (!trackIsLive("video")) {
      setError(null);
      setCamOff(false);
      setMainSource("laptop");
      setPipOn(false);
      void startPreview("camera", orientation);
      return;
    }
    const currentlyOff = camOff || !trackIsEnabled("video");
    if (currentlyOff) {
      setCamOff(false);
      setTrackEnabled("video", true);
      return;
    }
    setCamOff(true);
    setTrackEnabled("video", false);
  }, [camOff, orientation, startPreview]);

  const toggleMic = useCallback(() => {
    if (!trackIsLive("audio")) {
      setError(null);
      setCamOff(false);
      setMainSource("laptop");
      void startPreview("camera", orientation);
      return;
    }
    setMicMuted((prev) => !prev);
  }, [orientation, startPreview]);

  const deviceFor = useCallback(
    (kind: "laptop" | "phone" | "screen" | "other") => {
      if (kind === "screen") return null;
      if (kind === "phone") return phoneCam?.deviceId ?? null;
      if (kind === "other") {
        return (
          otherCams.find((d) => d.deviceId === cameraDeviceId)?.deviceId ??
          otherCams[0]?.deviceId ??
          null
        );
      }
      return laptopCam?.deviceId ?? cameraDeviceId;
    },
    [phoneCam, laptopCam, otherCams, cameraDeviceId],
  );

  const applyProgram = useCallback(
    async (args: {
      main: "laptop" | "phone" | "screen" | "other";
      pip: boolean;
      pipKind: "laptop" | "phone" | "screen" | "other";
      /** Explicit camera device (laptop / phone / other). */
      deviceId?: string | null;
      /**
       * Screen-as-main: opens the share picker as the stage.
       * Camera-as-main: opens the share picker for the corner overlay only.
       */
      forceCapture?: boolean;
    }) => {
      let { main, pipKind } = args;
      const pip = args.pip;
      const forceCapture = !!args.forceCapture;
      const preferredDevice = args.deviceId ?? null;
      setMainMenuOpen(false);
      setPipMenuOpen(false);

      const desk = mediaRef.current;
      const liveCameraMain =
        desk?.mode === "camera" || desk?.mode === "camera-pip";
      const uiCameraMain =
        mainSource === "laptop" ||
        mainSource === "phone" ||
        mainSource === "other";
      const keepCameraAsMain =
        liveCameraMain ||
        (uiCameraMain &&
          desk?.mode !== "screen" &&
          desk?.mode !== "screen-pip");

      const phoneDistinct =
        !!phoneCam?.deviceId &&
        !!laptopCam?.deviceId &&
        phoneCam.deviceId !== laptopCam.deviceId;
      if (
        (main === "phone" || (pip && pipKind === "phone")) &&
        !phoneDistinct
      ) {
        if (main === "phone") main = "laptop";
        if (pip && pipKind === "phone") {
          if (keepCameraAsMain) {
            pushToast(PIP_SAME_CAM_TOAST);
            return;
          }
          pipKind = "laptop";
        }
        if (!pip) {
          pushToast("No second camera — Main stays on laptop");
          if (
            mediaRef.current?.mode === "camera" &&
            mediaStreamHasLiveVideo(mediaRef.current.previewStream)
          ) {
            setMainSource("laptop");
            setPipOn(false);
            setPipSource("laptop");
            attachPreview(mediaRef.current);
            return;
          }
        }
      }

      let mode: DeskMediaMode = "camera";
      let deviceId: string | null = preferredDevice;
      let reuseScreen: MediaStream | null = null;
      let pipRequest: DeskPipRequest | null = null;

      if (pip && keepCameraAsMain) {
        if (main === "screen") {
          main =
            mainSource === "phone" ||
            mainSource === "other" ||
            mainSource === "laptop"
              ? mainSource
              : "laptop";
        }
        const mainCamKind: "laptop" | "phone" | "other" =
          main === "phone" || main === "other" ? main : "laptop";
        const mainId =
          cameraDeviceId ||
          deviceFor(mainCamKind) ||
          (desk?.mode === "camera"
            ? streamDeviceId(desk.previewStream)
            : null);
        const wantScreenOverlay = forceCapture || pipKind === "screen";

        if (wantScreenOverlay) {
          const existingDisplay = liveScreenFromMedia();
          mode = "camera-pip";
          pipKind = "screen";
          deviceId = mainId;
          reuseScreen = existingDisplay;
          pipRequest = { kind: "screen", existing: existingDisplay };
        } else {
          const camKind: "laptop" | "phone" | "other" =
            pipKind === "phone" || pipKind === "laptop" || pipKind === "other"
              ? pipKind
              : mainCamKind;
          const pipId = preferredDevice ?? deviceFor(camKind);
          if (!pipId || (mainId && pipId === mainId)) {
            pushToast(PIP_SAME_CAM_TOAST);
            return;
          }
          mode = "camera-pip";
          pipKind = camKind;
          deviceId = mainId;
          reuseScreen = null;
          pipRequest = { kind: "camera", deviceId: pipId };
        }
      } else if (pip) {
        const existingDisplay = liveScreenFromMedia();
        const camKind: "laptop" | "phone" | "other" =
          pipKind === "phone" || pipKind === "laptop" || pipKind === "other"
            ? pipKind
            : main === "phone" || main === "other"
              ? main
              : "laptop";

        deviceId = preferredDevice ?? deviceFor(camKind);
        pipKind = camKind;
        mode = "screen-pip";
        main = "screen";
        reuseScreen = existingDisplay && !forceCapture ? existingDisplay : null;
      } else if (main === "screen") {
        mode = "screen";
        reuseScreen = liveScreenFromMedia();
      } else {
        mode = "camera";
        deviceId = preferredDevice ?? deviceFor(main);
      }

      setMainSource(main);
      setPipOn(pip);
      setPipSource(pipKind);
      setMediaMode(mode);

      const openNext = async () => {
        previewOpenGenRef.current += 1;
        const safeId =
          mode === "screen" ? null : await resolveLiveVideoDeviceId(deviceId);
        if (safeId) setCameraDeviceId(safeId);
        else if (mode === "camera") setCameraDeviceId(null);
        let pipArg = pipRequest;
        if (pipArg?.kind === "camera") {
          const safePip = await resolveLiveVideoDeviceId(pipArg.deviceId);
          if (!safePip || (safeId && safePip === safeId)) {
            throw new Error(PIP_SAME_CAM_TOAST);
          }
          pipArg = { kind: "camera", deviceId: safePip };
        }
        mediaRef.current = await openDeskMedia(
          mode,
          orientation,
          reuseScreen,
          safeId,
          pipArg,
        );
        attachPreview(mediaRef.current);
        studioAudio.attachMic(mediaRef.current.previewStream);
        setError(null);
        setGumDebug(getLastGumDebug());
      };

      if (!active) {
        setBusy(true);
        setError(null);
        try {
          const live = mediaRef.current;
          const keepCam = mode === "camera" || mode === "camera-pip";
          if (
            mode === "camera" &&
            live &&
            liveCameraMatchesDevice(live, deviceId)
          ) {
            attachPreview(live);
          } else {
            if (live) {
              try {
                live.stop({
                  keepCamera: keepCam,
                  keepScreen: !!reuseScreen,
                });
              } catch {
                /* ignore */
              }
              mediaRef.current = null;
            }
            await openNext();
          }
          setMicMuted(false);
          setCamOff(false);
        } catch (e) {
          setGumDebug(getLastGumDebug());
          setError(formatStudioCamOpenError(e));
          setPipOn(false);
          if (!mediaRef.current) {
            try {
              await startPreview("camera", orientation);
            } catch {
              /* already reported */
            }
          }
        } finally {
          setBusy(false);
        }
        return;
      }

      if (!session) {
        requireAuth("Log in to go live with this program");
        return;
      }

      setBusy(true);
      setError(null);
      try {
        await stopPublish();
        const live = mediaRef.current;
        const keepCam = mode === "camera" || mode === "camera-pip";
        if (
          mode === "camera" &&
          live &&
          liveCameraMatchesDevice(live, deviceId)
        ) {
          attachPreview(live);
        } else {
          if (live) {
            try {
              live.stop({
                keepCamera: keepCam,
                keepScreen: !!reuseScreen,
              });
            } catch {
              /* ignore */
            }
            mediaRef.current = null;
          }
          await openNext();
        }
        await beginPublish(active, mode, orientation);
      } catch (e) {
        setGumDebug(getLastGumDebug());
        setError(formatStudioCamOpenError(e));
        setPipOn(false);
        if (!mediaRef.current) {
          try {
            await startPreview("camera", orientation);
          } catch {
            /* already reported */
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [
      active,
      attachPreview,
      beginPublish,
      cameraDeviceId,
      deviceFor,
      laptopCam,
      liveScreenFromMedia,
      mainSource,
      orientation,
      phoneCam,
      pushToast,
      requireAuth,
      session,
      startPreview,
      stopPublish,
    ],
  );

  const loadSceneById = useCallback(
    (id: string) => {
      const s = programScenes.find((x) => x.id === id);
      if (!s) return;
      setSelectedSceneId(id);
      setSceneXfade(true);
      window.setTimeout(() => setSceneXfade(false), 420);
      setOrientation(s.orientation);
      setViewerLayout(coerceLayout(s.layout as StageLayoutId, s.orientation));
      setOverlayState({ ...s.overlays });
      setOverlayPositions(normalizeOverlayPositions(s.positions));
      void applyProgram({
        main: s.mainSource,
        pip: s.pipOn,
        pipKind: s.pipSource,
        forceCapture:
          (s.mediaMode === "screen" ||
            s.mediaMode === "screen-pip" ||
            (s.pipOn && s.pipSource === "screen")) &&
          !liveScreenFromMedia(),
      });
      pushToast(`Scene “${s.name}”`);
    },
    [programScenes, applyProgram, pushToast, liveScreenFromMedia],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key >= "1" && e.key <= "6" && !e.shiftKey) {
        const pad = STING_PAD[Number(e.key) - 1];
        if (pad) {
          e.preventDefault();
          playPad(pad.id);
        }
        return;
      }

      if (e.key === "0" && !e.shiftKey) {
        e.preventDefault();
        studioAudio.stopMusic();
        void pauseSpotifyPlayback();
        setActiveBed(null);
        setJukeboxNow("Queue empty");
        setJukeboxTitle("");
        setJukeboxArtist("");
        setJukeboxArt(null);
        pushToast("Music stopped");
        return;
      }

      if (/^F[1-5]$/.test(e.key)) {
        e.preventDefault();
        const idx = Number(e.key.slice(1)) - 1;
        const preset = TOP_LAYOUT_PRESETS[idx];
        if (preset) applyTopPreset(preset.id);
        return;
      }

      if (
        e.shiftKey &&
        (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3")
      ) {
        e.preventDefault();
        if (e.code === "Digit1") {
          void applyProgram({ main: "laptop", pip: false, pipKind: pipSource });
        } else if (e.code === "Digit2") {
          void applyProgram({
            main: "screen",
            pip: false,
            pipKind: pipSource === "screen" ? "laptop" : pipSource,
          });
        } else {
          void applyProgram({
            main: mainSource,
            pip: true,
            pipKind: mainSource === "screen" ? "laptop" : "screen",
            forceCapture: true,
          });
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    playPad,
    pushToast,
    applyTopPreset,
    applyProgram,
    pipSource,
    liveScreenFromMedia,
    mainSource,
  ]);

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    const handleDeck = (cmd: StudioDeckCommand) => {
      switch (cmd.type) {
        case "sting": {
          const pad = STING_PAD.find((s) => s.id === cmd.id);
          if (pad) playPad(pad.id);
          break;
        }
        case "stop-music":
          studioAudio.stopMusic();
          void pauseSpotifyPlayback();
          setActiveBed(null);
          setJukeboxNow("Queue empty");
          setJukeboxTitle("");
          setJukeboxArtist("");
          setJukeboxArt(null);
          pushToast("Music stopped");
          break;
        case "scene":
          if (cmd.scene === "camera") {
            void applyProgram({ main: "laptop", pip: false, pipKind: pipSource });
          } else if (cmd.scene === "screen") {
            void applyProgram({
              main: "screen",
              pip: false,
              pipKind: pipSource === "screen" ? "laptop" : pipSource,
            });
          } else {
            void applyProgram({
              main: "screen",
              pip: true,
              pipKind: "laptop",
              forceCapture: !liveScreenFromMedia(),
            });
          }
          break;
        case "layout": {
          const preset = TOP_LAYOUT_PRESETS[cmd.presetIndex];
          if (preset) applyTopPreset(preset.id);
          break;
        }
        case "overlay-toggle":
          if (cmd.id in overlayState) {
            toggleOverlay(cmd.id as keyof OverlayState);
          }
          break;
        case "mic-toggle": {
          toggleMic();
          break;
        }
        case "cam-toggle": {
          toggleCam();
          break;
        }
        case "go-live":
          if (!active && session) void onStartRef.current();
          break;
        case "end-live":
          if (active) void onEndRef.current();
          break;
        default:
          break;
      }
    };
    return subscribeStudioDeckCommands(handleDeck);
  }, [
    playPad,
    pushToast,
    applyProgram,
    applyTopPreset,
    pipSource,
    liveScreenFromMedia,
    overlayState,
    toggleMic,
    toggleCam,
    active,
    session,
  ]);

  /** Broadcast aspect — recomposes capture; layout via top presets / deck icons. */
  const onSwitchViewerOrientation = useCallback(
    (next: DeskOrientation) => {
      setBoothMode(next);
      if (next === orientation) return;
      if (orientation === "landscape") {
        lastLandscapeLayoutRef.current = viewerLayout;
      } else {
        lastPortraitLayoutRef.current = viewerLayout;
      }
      const restored =
        next === "landscape"
          ? coerceLayout(lastLandscapeLayoutRef.current, "landscape")
          : coerceLayout(lastPortraitLayoutRef.current, "portrait");
      setOrientation(next);
      setViewerLayout(restored);
    },
    [orientation, viewerLayout],
  );

  const refreshStudioTeam = useCallback(async () => {
    if (!session?.sub || !session.idToken) {
      setStudioTeam(null);
      setStudioTeamError("Sign in to open your team · battle diary desk");
      return;
    }
    setStudioTeamBusy(true);
    setStudioTeamError(null);
    try {
      const bridged = await ensureFirebaseFromCognito({
        cognitoIdToken: session.idToken,
        uid: session.sub,
      });
      const firebaseUid = getFirebaseAuth().currentUser?.uid;
      if (bridged && firebaseUid === session.sub) {
        try {
          const bundle = await loadMyTeam(session.sub);
          setStudioTeam(bundle);
          if (!bundle) {
            setStudioTeamError("No team yet — create or join one on /teams");
          }
          return;
        } catch {
          /* fall through to API */
        }
      }
      const viaApi = await loadMyTeamViaApi(session.idToken);
      setStudioTeam(viaApi);
      if (!viaApi) {
        setStudioTeamError("No team yet — create or join one on /teams");
      }
    } catch (e) {
      setStudioTeam(null);
      setStudioTeamError(
        e instanceof Error ? e.message : "Could not load team desk",
      );
    } finally {
      setStudioTeamBusy(false);
    }
  }, [session?.sub, session?.idToken]);

  const applyBoothMode = useCallback(
    (mode: StudioBoothMode) => {
      if (mode === "team-desk") {
        setBoothMode("team-desk");
        void refreshStudioTeam();
        pushToast("Team · battle diary · ← / → cycle");
        return;
      }
      onSwitchViewerOrientation(mode);
      pushToast(
        mode === "portrait"
          ? "Portrait · phone watch chrome (one stream)"
          : "Landscape · PC/tablet watch chrome (one stream)",
      );
    },
    [onSwitchViewerOrientation, pushToast, refreshStudioTeam],
  );

  const cycleBoothMode = useCallback(
    (dir: 1 | -1) => {
      const idx = STUDIO_BOOTH_CYCLE.indexOf(boothMode);
      const next =
        STUDIO_BOOTH_CYCLE[
          (idx + dir + STUDIO_BOOTH_CYCLE.length) % STUDIO_BOOTH_CYCLE.length
        ];
      applyBoothMode(next);
    },
    [applyBoothMode, boothMode],
  );

  useEffect(() => {
    const onArrow = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        cycleBoothMode(1);
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        cycleBoothMode(-1);
      }
    };
    window.addEventListener("keydown", onArrow);
    return () => window.removeEventListener("keydown", onArrow);
  }, [cycleBoothMode]);

  useEffect(() => {
    if (!mainMenuOpen && !pipMenuOpen && !teamMenuOpen && !headerGuestsOpen) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".tls-flyout")) return;
      setMainMenuOpen(false);
      setPipMenuOpen(false);
      setTeamMenuOpen(false);
      setHeaderGuestsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [mainMenuOpen, pipMenuOpen, teamMenuOpen, headerGuestsOpen]);

  useEffect(() => {
    setInviteSlotKey(null);
  }, [phoneLayout.id]);

  useEffect(() => {
    if (!inviteSlotKey) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".tls-guest-tile-empty")) return;
      setInviteSlotKey(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [inviteSlotKey]);

  const onGuestAction = async (
    action: "accept" | "reject",
    guestUserId: string,
  ) => {
    if (!session?.idToken || !active?.sessionId) return;
    if (action === "accept" && !guestsOpen) {
      pushToast("Guest requests are closed");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (action === "accept") {
        try {
          const invited = await inviteGuest(
            session.idToken,
            active.sessionId,
            guestUserId,
          );
          setGuestRows((prev) => {
            const next = prev.map((r) =>
              r.userId === guestUserId
                ? {
                    ...r,
                    status: "INVITED",
                    slotIndex:
                      typeof invited.slotIndex === "number"
                        ? invited.slotIndex
                        : r.slotIndex,
                  }
                : r,
            );
            if (!next.some((r) => r.userId === guestUserId)) {
              next.push({
                userId: guestUserId,
                status: "INVITED",
                slotIndex:
                  typeof invited.slotIndex === "number" ? invited.slotIndex : null,
              });
            }
            return next;
          });
          try {
            publishRef.current?.refreshStrategy?.();
          } catch {
            /* ignore */
          }
          pushToast("Guest accepted — waiting for them on stage");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Already seated: treat as success so Accept isn't a red failure loop.
          if (!isAlreadyOnStageError(msg)) throw e;
          pushToast("Guest already on stage");
        }
      } else {
        await rejectGuest(session.idToken, active.sessionId, guestUserId);
        pushToast("Guest rejected");
      }
      const rows = await fetchGuestRequests(
        session.idToken,
        active.sessionId,
      );
      setGuestRows((prev) => {
        const base =
          action === "reject"
            ? prev.filter((r) => r.userId !== guestUserId)
            : prev;
        return mergeGuestPanel(base, rows);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guest action failed");
    } finally {
      setBusy(false);
    }
  };

  const copyGuestInviteLink = useCallback(async () => {
    if (!watchUrl) {
      pushToast("Go live first — then Invite copies a join link");
      return;
    }
    const text = liveGuestInviteBlurb({
      title: title.trim() || "LIVE",
      watchUrl,
    });
    try {
      await navigator.clipboard.writeText(text);
      pushToast("Guest invite copied");
    } catch {
      pushToast("Copy failed");
    }
  }, [pushToast, title, watchUrl]);

  const sendHostGuestInvite = useCallback(async () => {
    if (!session?.idToken || !active?.sessionId) {
      pushToast("Go live first to invite someone onto the stage");
      return;
    }
    const raw = inviteQuery.trim().replace(/^@/, "");
    if (!raw) {
      pushToast("Add a Blyp @username");
      return;
    }
    setInviteBusy(true);
    try {
      let uid = raw;
      const looksLikeId =
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(raw) ||
        (/^[A-Za-z0-9]{20,}$/.test(raw) && !raw.includes(" "));
      if (!looksLikeId) {
        const hits = await searchUsers(raw, 8);
        const q = raw.toLowerCase();
        const exact =
          hits.find((h) => h.username.toLowerCase() === q) ||
          hits.find((h) => h.displayName.toLowerCase() === q) ||
          hits[0];
        if (!exact) {
          pushToast("No Blyp user found");
          return;
        }
        uid = exact.id;
      }
      await hostInviteGuestByUid(session.idToken, active.sessionId, uid);
      pushToast("Invite sent — they join from the app");
      setInviteSlotKey(null);
      setInviteQuery("");
      const rows = await fetchGuestRequests(session.idToken, active.sessionId);
      setGuestRows((prev) => mergeGuestPanel(prev, rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed");
    } finally {
      setInviteBusy(false);
    }
  }, [active?.sessionId, inviteQuery, pushToast, session?.idToken]);

  const onGuestMute = async (guestUserId: string) => {
    if (!session?.idToken || !active?.sessionId) return;
    const next = !guestMuted[guestUserId];
    setBusy(true);
    try {
      await muteGuest(session.idToken, active.sessionId, guestUserId, next);
      setGuestMuted((prev) => ({ ...prev, [guestUserId]: next }));
      pushToast(next ? "Guest mic muted" : "Guest mic unmuted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guest mute failed");
    } finally {
      setBusy(false);
    }
  };

  const onGuestCamera = async (guestUserId: string) => {
    if (!session?.idToken || !active?.sessionId) return;
    const next = !guestCamOff[guestUserId];
    setBusy(true);
    try {
      await setGuestCamera(
        session.idToken,
        active.sessionId,
        guestUserId,
        next,
      );
      setGuestCamOff((prev) => ({ ...prev, [guestUserId]: next }));
      pushToast(next ? "Guest camera off" : "Guest camera on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guest camera failed");
    } finally {
      setBusy(false);
    }
  };

  const onGuestKick = async (guestUserId: string) => {
    if (!session?.idToken || !active?.sessionId) return;
    setBusy(true);
    try {
      await kickGuest(session.idToken, active.sessionId, guestUserId);
      setGuestMuted((prev) => {
        const next = { ...prev };
        delete next[guestUserId];
        return next;
      });
      setGuestCamOff((prev) => {
        const next = { ...prev };
        delete next[guestUserId];
        return next;
      });
      const rows = await fetchGuestRequests(
        session.idToken,
        active.sessionId,
      );
      setGuestRows((prev) =>
        mergeGuestPanel(
          prev.filter((r) => r.userId !== guestUserId),
          rows,
        ),
      );
      pushToast("Guest removed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guest kick failed");
    } finally {
      setBusy(false);
    }
  };

  const renderGuestTile = (
    tile: StageTile | undefined,
    guestIdx: number,
    bombCell: number | undefined,
  ) => {
    const empty = !!tile?.empty;
    const label = tile?.label ?? `Guest ${guestIdx + 1}`;
    const key = tile?.key ?? `g-${guestIdx}`;
    if (empty) {
      return (
        <EmptyGuestSlot
          key={key}
          label={label}
          bombCell={bombCell}
          strikeArmed={strikeArmed}
          inviteOpen={inviteSlotKey === key}
          inviteQuery={inviteQuery}
          inviteBusy={inviteBusy}
          onToggleInvite={() =>
            setInviteSlotKey((cur) => (cur === key ? null : key))
          }
          onInviteQuery={setInviteQuery}
          onCopyLink={() => void copyGuestInviteLink()}
          onSendInvite={() => void sendHostGuestInvite()}
          onNuke={bombCell != null ? () => playBombStrike(bombCell) : undefined}
        />
      );
    }
    return (
      <OccupiedGuestTile
        key={key}
        label={label}
        bombCell={bombCell}
        strikeArmed={strikeArmed}
        stream={guestMedia[key] ?? null}
        onNuke={bombCell != null ? () => playBombStrike(bombCell) : undefined}
      />
    );
  };

  if (loading) {
    return (
      <div className="tls-booth tls-booth-theater">
        <p className="tls-loading">Loading studio…</p>
      </div>
    );
  }

  const isLive = !!active && publishState === "live";
  const viewerCount = mirror?.viewerCount ?? 0;
  const hasLiveVideo = !!mediaRef.current?.previewStream
    ?.getVideoTracks()
    .some((t) => t.readyState === "live" && t.enabled);
  const hasLiveAudio = !!mediaRef.current?.previewStream
    ?.getAudioTracks()
    .some((t) => t.readyState === "live" && t.enabled);
  const camLooksOn = previewOn && !camOff && hasLiveVideo;
  const micLooksOn = previewOn && !micMuted && hasLiveAudio;
  const camShownOff = camOff;
  const micShownOff = micMuted;

  const tiktokStatusMessage =
    broadcastView?.message ||
    (broadcastView?.phase === "provisioning"
      ? "Provisioning broadcast servers (~45s)…"
      : null);

  const studioPhase = active ? "broadcast" : "setup";
  const confidencePreviewStream = previewOn
    ? mediaRef.current?.previewStream ?? null
    : null;
  const goLiveSummary = !active
    ? setupGoLiveSummary({
        tiktokReady: tiktokPreflightReady,
        youtubeReady: youtubePreflightReady,
        twitchReady: twitchPreflightReady,
        facebookReady: facebookPreflightReady,
        kickReady: kickPreflightReady,
      })
    : liveGoLiveSummary({
        tiktokReady: tiktokPreflightReady,
        youtubeReady: youtubePreflightReady,
        twitchReady: twitchPreflightReady,
        facebookReady: facebookPreflightReady,
        kickReady: kickPreflightReady,
        broadcastPhase: broadcastView?.phase ?? null,
        broadcastMessage: tiktokStatusMessage,
      });

  return (
    <div
      ref={boothRootRef}
      className={
        (boothMode === "team-desk"
          ? "tls-booth tls-booth-theater tls-booth-team-desk"
          : orientation === "portrait"
            ? "tls-booth tls-booth-theater tls-booth-portrait"
            : "tls-booth tls-booth-theater tls-booth-landscape") +
        (studioMaximized ? ` ${STUDIO_MAXIMIZED_CLASS}` : "")
      }
    >
      <header className="tls-top">
        <Link
          href="/"
          className="tls-logo"
          aria-label="blyp home"
          onClick={() => {
            void exitStudioFullscreen(boothRootRef.current);
            setStudioMaximized(false);
          }}
        >
          <span className="tls-logo-word">blyp</span>
          <span className="tls-logo-dot" aria-hidden />
        </Link>
        <span className="tls-top-label">LIVE Studio</span>
        <button
          type="button"
          className={
            studioMaximized
              ? "tls-pill tls-top-maximize tls-top-maximize-on"
              : "tls-pill tls-top-maximize"
          }
          aria-pressed={studioMaximized}
          title={
            studioMaximized
              ? "Exit full screen (Esc)"
              : "Maximize studio to full screen"
          }
          onClick={() => void toggleStudioMaximize()}
        >
          {studioMaximized ? "Exit full screen" : "Maximize"}
        </button>
        <span className={isLive ? "tls-badge tls-badge-live" : "tls-badge"}>
          {isLive ? "LIVE" : "Offline"}
        </span>
        <div
          className="tls-orient-seg"
          role="group"
          aria-label="Program aspect"
          title="← / → cycle booth"
        >
          <button
            type="button"
            className={
              boothMode === "portrait"
                ? "tls-orient-seg-btn tls-orient-seg-on"
                : "tls-orient-seg-btn"
            }
            aria-pressed={boothMode === "portrait"}
            onClick={() => applyBoothMode("portrait")}
          >
            PORTRAIT
          </button>
          <button
            type="button"
            className={
              boothMode === "landscape"
                ? "tls-orient-seg-btn tls-orient-seg-on"
                : "tls-orient-seg-btn"
            }
            aria-pressed={boothMode === "landscape"}
            onClick={() => applyBoothMode("landscape")}
          >
            LANDSCAPE
          </button>
          {boothMode === "team-desk" ? (
            <span className="tls-orient-seg-note">Team desk</span>
          ) : null}
        </div>
        <div className="tls-health" aria-label="Connection health">
          <span className="tls-health-item">
            {healthFps || "—"}
            <abbr title="Frames per second">fps</abbr>
          </span>
          <span className="tls-health-item">
            {PUBLISH_MAX_BITRATE_KBPS}
            <abbr title="Target max bitrate">kbps</abbr>
          </span>
          <span
            className={
              healthIngest === "ok"
                ? "tls-health-item tls-health-ok"
                : healthIngest === "warn"
                  ? "tls-health-item tls-health-warn"
                  : "tls-health-item"
            }
          >
            {publishState === "live"
              ? "ingest ok"
              : publishState === "publishing"
                ? "connecting"
                : publishState === "error"
                  ? "ingest err"
                  : "idle"}
          </span>
          {pendingAlerts > 0 || alertQueue.paused ? (
            <span className="tls-health-item">
              {alertQueue.paused ? "alerts paused" : `${pendingAlerts} queued`}
            </span>
          ) : null}
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Stream title"
          maxLength={80}
          disabled={!!active}
          className="tls-title"
        />
        <span className="tls-viewers">{viewerCount} watching</span>
        <div className="tls-flyout tls-top-guests">
          <button
            type="button"
            className={
              pending.length > 0
                ? "tls-pill tls-top-guests-btn tls-top-guests-hot"
                : "tls-pill tls-top-guests-btn"
            }
            aria-expanded={headerGuestsOpen}
            onClick={() => {
              setHeaderGuestsOpen((v) => !v);
              setMainMenuOpen(false);
              setPipMenuOpen(false);
              setTeamMenuOpen(false);
            }}
          >
            Guests · {pending.length}
            {onStage.length ? ` · ${onStage.length} live` : ""}
          </button>
          {headerGuestsOpen ? (
            <div className="tls-flyout-menu tls-top-guests-menu" role="menu">
              {!guestsOpen ? (
                <p className="tls-empty">Guest requests closed.</p>
              ) : null}
              {guestPollError ? (
                <p className="tls-error-inline">{guestPollError}</p>
              ) : null}
              {pending.length === 0 && onStage.length === 0 ? (
                <p className="tls-empty">No requests yet.</p>
              ) : (
                <ul className="tls-guests tls-guests-hand">
                  {pending.map((g) => (
                    <li key={`top-p-${g.userId}`}>
                      <span className="tls-guest-id" title={g.userId}>
                        {formatGuestLabel(g.userId, guestLabels)}
                      </span>
                      <span className="tls-guest-actions">
                        <button
                          type="button"
                          disabled={busy || !guestsOpen}
                          onClick={() => void onGuestAction("accept", g.userId)}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onGuestAction("reject", g.userId)}
                        >
                          Reject
                        </button>
                      </span>
                    </li>
                  ))}
                  {onStage.map((g) => (
                    <li key={`top-s-${g.userId}`}>
                      <span className="tls-guest-id" title={g.userId}>
                        {formatGuestLabel(g.userId, guestLabels)}
                      </span>
                      <span className="tls-guest-actions">
                        <button
                          type="button"
                          disabled={busy || !active}
                          onClick={() => void onGuestMute(g.userId)}
                        >
                          {guestMuted[g.userId] ? "Unmute" : "Mute"}
                        </button>
                        <button
                          type="button"
                          disabled={busy || !active}
                          onClick={() => void onGuestCamera(g.userId)}
                        >
                          {guestCamOff[g.userId] ? "Cam on" : "Cam off"}
                        </button>
                        <button
                          type="button"
                          disabled={busy || !active}
                          onClick={() => void onGuestKick(g.userId)}
                        >
                          Kick
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
        {strikeArmed ? (
          <span className="tls-monitor-armed" role="status">
            Nuke armed
          </span>
        ) : null}
        <p className="tls-go-summary" role="status">
          {goLiveSummary}
        </p>
        {active ? (
          <button
            type="button"
            disabled={busy}
            className="tls-go tls-end tls-top-go"
            onClick={() => void onEnd()}
          >
            {busy ? "Ending…" : "END"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="tls-go tls-top-go"
            onClick={handlePrimaryLiveAction}
          >
            {busy ? "…" : "GO LIVE"}
          </button>
        )}
        {watchUrl ? (
          <button
            type="button"
            className="tls-pill"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(watchUrl);
                pushToast("Watch URL copied");
              } catch {
                pushToast("Copy failed");
              }
            }}
          >
            Copy link
          </button>
        ) : null}
        {toast ? (
          <p className="tls-toast tls-toast-bar" role="status">
            {toast}
          </p>
        ) : null}
      </header>

      {error ? <p className="tls-error" role="alert">{error}</p> : null}

      <div className="tls-body">
        <aside className="tls-left">
          {boothMode !== "team-desk" ? (
            <StudioRailSlot {...leftSlotProps("dest")}>
            <DestinationDock
              busy={busy}
              tiktokReady={tiktokPreflightReady}
              youtubeReady={youtubePreflightReady}
              twitchReady={twitchPreflightReady}
              facebookReady={facebookPreflightReady}
              kickReady={kickPreflightReady}
              initialTikTokRtmpUrl={tiktokRtmpUrl}
              initialTikTokStreamKey={tiktokStreamKey}
              initialTikTokUniqueId={tiktokUniqueId}
              initialYouTubeRtmpUrl={youtubeRtmpUrl}
              initialYouTubeStreamKey={youtubeStreamKey}
              initialTwitchRtmpUrl={twitchRtmpUrl}
              initialTwitchStreamKey={twitchStreamKey}
              initialFacebookRtmpUrl={facebookRtmpUrl}
              initialFacebookStreamKey={facebookStreamKey}
              initialKickRtmpUrl={kickRtmpUrl}
              initialKickStreamKey={kickStreamKey}
              onDisableTikTok={handleDisableTikTok}
              onDisableYouTube={handleDisableYouTube}
              onDisableTwitch={handleDisableTwitch}
              onDisableFacebook={handleDisableFacebook}
              onDisableKick={handleDisableKick}
              onTikTokSaved={handleTikTokSaved}
              onYouTubeSaved={handleYouTubeSaved}
              onTwitchSaved={handleTwitchSaved}
              onFacebookSaved={handleFacebookSaved}
              onKickSaved={handleKickSaved}
            />
            </StudioRailSlot>
          ) : null}
          {studioPhase === "broadcast" && boothMode !== "team-desk" ? (
            <ConfidenceRail
              previewStream={
                publishState === "live" || publishState === "publishing"
                  ? null
                  : confidencePreviewStream
              }
              tiktokReady={tiktokPreflightReady}
              broadcastPhase={broadcastView?.phase ?? null}
              broadcastMessage={tiktokStatusMessage}
              publishState={publishState}
            />
          ) : null}
          <StudioRailSlot {...leftSlotProps("program")}>
          <section className="tls-section tls-host-hand-sources">
          <p className="tls-panel-label">Program source</p>
          <div className="tls-rail-deck" aria-label="Program source">
            <div className="tls-deck-row tls-deck-row-main">
              <div className="tls-flyout tls-flyout-stretch">
                <button
                  type="button"
                  disabled={busy}
                  className={
                    !pipOn
                      ? "tls-deck-btn tls-deck-btn-main tls-deck-btn-on"
                      : "tls-deck-btn tls-deck-btn-main"
                  }
                  aria-expanded={mainMenuOpen}
                  onClick={() => {
                    setMainMenuOpen((v) => !v);
                    setPipMenuOpen(false);
                    setTeamMenuOpen(false);
                    setHeaderGuestsOpen(false);
                  }}
                >
                  <span
                    className="tls-cam-icon"
                    data-role={mainSource}
                    aria-hidden
                  />
                  Main ·{" "}
                  {mainSource === "screen"
                    ? "Screen"
                    : mainSource === "phone"
                      ? "Phone"
                      : mainSource === "other"
                        ? "Other cam"
                        : "Laptop"}
                  <span className="tls-flyout-caret" aria-hidden>
                    ▾
                  </span>
                </button>
                {mainMenuOpen ? (
                  <div className="tls-flyout-menu" role="menu">
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={mainSource === "laptop" && !pipOn}
                      className={
                        mainSource === "laptop" && !pipOn
                          ? "tls-flyout-item-on"
                          : undefined
                      }
                      disabled={busy}
                      onClick={() =>
                        void applyProgram({
                          main: "laptop",
                          pip: false,
                          pipKind: pipSource === "screen" ? "laptop" : pipSource,
                          deviceId: laptopCam?.deviceId ?? null,
                        })
                      }
                    >
                      <strong>
                        <span className="tls-cam-icon" data-role="laptop" aria-hidden />{" "}
                        Laptop
                      </strong>
                      <span>
                        This PC ·{" "}
                        {laptopCam
                          ? shortDeviceLabel(laptopCam.label)
                          : "Built-in / user-facing cam"}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={mainSource === "phone" && !pipOn}
                      className={
                        mainSource === "phone" && !pipOn
                          ? "tls-flyout-item-on"
                          : undefined
                      }
                      disabled={busy}
                      onClick={() =>
                        void applyProgram({
                          main: "phone",
                          pip: false,
                          pipKind: pipSource === "screen" ? "phone" : pipSource,
                          deviceId: phoneCam?.deviceId ?? null,
                        })
                      }
                    >
                      <strong>
                        <span className="tls-cam-icon" data-role="phone" aria-hidden />{" "}
                        Phone
                      </strong>
                      <span>
                        {phoneCam
                          ? `Cam · ${shortDeviceLabel(phoneCam.label)}`
                          : "Second cam / Continuity / Camo / USB"}
                      </span>
                    </button>
                    {otherCams.map((dev) => (
                      <button
                        key={dev.deviceId}
                        type="button"
                        role="menuitemradio"
                        aria-checked={
                          mainSource === "other" &&
                          !pipOn &&
                          cameraDeviceId === dev.deviceId
                        }
                        className={
                          mainSource === "other" &&
                          !pipOn &&
                          cameraDeviceId === dev.deviceId
                            ? "tls-flyout-item-on"
                            : undefined
                        }
                        disabled={busy}
                        onClick={() =>
                          void applyProgram({
                            main: "other",
                            pip: false,
                            pipKind:
                              pipSource === "screen" ? "other" : pipSource,
                            deviceId: dev.deviceId,
                          })
                        }
                      >
                        <strong>
                          <span className="tls-cam-icon" data-role="other" aria-hidden />{" "}
                          Other cam
                        </strong>
                        <span>{shortDeviceLabel(dev.label)}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={mainSource === "screen" && !pipOn}
                      className={
                        mainSource === "screen" && !pipOn
                          ? "tls-flyout-item-on"
                          : undefined
                      }
                      disabled={busy}
                      onClick={() =>
                        void applyProgram({
                          main: "screen",
                          pip: false,
                          pipKind:
                            pipSource === "screen" ? "laptop" : pipSource,
                        })
                      }
                    >
                      <strong>
                        <span className="tls-cam-icon" data-role="screen" aria-hidden />{" "}
                        Screen / game / window
                      </strong>
                      <span>Opens the system share picker</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="tls-deck-row tls-deck-row-aux">
              <div className="tls-flyout tls-flyout-stretch">
                <button
                  type="button"
                  disabled={busy}
                  className={
                    pipOn
                      ? "tls-deck-btn tls-deck-btn-aux tls-deck-btn-on"
                      : "tls-deck-btn tls-deck-btn-aux"
                  }
                  aria-expanded={pipMenuOpen}
                  onClick={() => {
                    setPipMenuOpen((v) => !v);
                    setMainMenuOpen(false);
                    setTeamMenuOpen(false);
                    setHeaderGuestsOpen(false);
                  }}
                >
                  <span
                    className="tls-cam-icon"
                    data-role={pipOn ? pipSource : "off"}
                    aria-hidden
                  />
                  PIP ·{" "}
                  {pipOn
                    ? pipSource === "phone"
                      ? "Phone"
                      : pipSource === "other"
                        ? "Other"
                        : pipSource === "screen"
                          ? "Screen"
                          : "Laptop"
                    : "Off"}
                  <span className="tls-flyout-caret" aria-hidden>
                    ▾
                  </span>
                </button>
                {pipMenuOpen ? (
                  <div className="tls-flyout-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() =>
                        void applyProgram({
                          main: mainSource,
                          pip: false,
                          pipKind: pipSource,
                          deviceId:
                            mainSource === "screen"
                              ? null
                              : cameraDeviceId,
                        })
                      }
                    >
                      <strong>PIP off</strong>
                      <span>Full program only</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() =>
                        void applyProgram({
                          main: mainSource,
                          pip: true,
                          pipKind: "laptop",
                          deviceId: laptopCam?.deviceId ?? null,
                        })
                      }
                    >
                      <strong>
                        <span className="tls-cam-icon" data-role="laptop" aria-hidden />{" "}
                        PIP · Laptop
                      </strong>
                      <span>
                        This PC ·{" "}
                        {laptopCam
                          ? shortDeviceLabel(laptopCam.label)
                          : "Built-in cam"}
                        {" · corner overlay"}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() =>
                        void applyProgram({
                          main: mainSource,
                          pip: true,
                          pipKind: "phone",
                          deviceId: phoneCam?.deviceId ?? null,
                        })
                      }
                    >
                      <strong>
                        <span className="tls-cam-icon" data-role="phone" aria-hidden />{" "}
                        PIP · Phone
                      </strong>
                      <span>
                        {phoneCam
                          ? `Cam · ${shortDeviceLabel(phoneCam.label)}`
                          : "Second cam / Continuity / Camo / USB"}
                      </span>
                    </button>
                    {otherCams.map((dev) => (
                      <button
                        key={`pip-${dev.deviceId}`}
                        type="button"
                        role="menuitem"
                        disabled={busy}
                        onClick={() =>
                          void applyProgram({
                            main: mainSource,
                            pip: true,
                            pipKind: "other",
                            deviceId: dev.deviceId,
                          })
                        }
                      >
                        <strong>
                          <span className="tls-cam-icon" data-role="other" aria-hidden />{" "}
                          PIP · Other cam
                        </strong>
                        <span>{shortDeviceLabel(dev.label)}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={busy}
                      onClick={() => {
                        if (mainSource === "screen") {
                          void applyProgram({
                            main: "screen",
                            pip: true,
                            pipKind:
                              pipSource === "phone" || pipSource === "other"
                                ? pipSource
                                : "laptop",
                            deviceId:
                              pipSource === "phone"
                                ? phoneCam?.deviceId ?? null
                                : pipSource === "other"
                                  ? cameraDeviceId
                                  : laptopCam?.deviceId ?? null,
                            forceCapture: true,
                          });
                          return;
                        }
                        void applyProgram({
                          main: mainSource,
                          pip: true,
                          pipKind: "screen",
                          deviceId: cameraDeviceId,
                          forceCapture: true,
                        });
                      }}
                    >
                      <strong>
                        <span className="tls-cam-icon" data-role="screen" aria-hidden />{" "}
                        PIP · screen + cam
                      </strong>
                      <span>
                        {mainSource === "screen"
                          ? "Opens share picker · camera in the corner"
                          : "Screen / window in the corner · camera stays Main"}
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                className={
                  boothMode === "portrait"
                    ? "tls-deck-icon tls-deck-btn-on"
                    : "tls-deck-icon"
                }
                title="Portrait · phone watch chrome · one stream (← → cycle)"
                aria-label="Portrait phone watch chrome"
                onClick={() => applyBoothMode("portrait")}
              >
                <span className="tls-orient-portrait" aria-hidden />
              </button>
              <button
                type="button"
                className={
                  boothMode === "landscape"
                    ? "tls-deck-icon tls-deck-btn-on"
                    : "tls-deck-icon"
                }
                title="Landscape · PC/tablet watch chrome · one stream (← → cycle)"
                aria-label="Landscape PC tablet watch chrome"
                onClick={() => applyBoothMode("landscape")}
              >
                <span className="tls-orient-landscape" aria-hidden />
              </button>
            </div>
            <div className="tls-chip-row tls-deck-cam-row">
              <button
                type="button"
                className={
                  camShownOff
                    ? "tls-chip tls-chip-warn"
                    : camLooksOn
                      ? "tls-chip tls-chip-on"
                      : "tls-chip"
                }
                onClick={toggleCam}
              >
                {camShownOff ? "Cam off" : "Cam on"}
              </button>
              <button
                type="button"
                className={
                  micShownOff
                    ? "tls-chip tls-chip-warn"
                    : micLooksOn
                      ? "tls-chip tls-chip-on"
                      : "tls-chip"
                }
                onClick={toggleMic}
              >
                {micShownOff ? "Mic off" : "Mic on"}
              </button>
              <button
                type="button"
                className={
                  guestsOpen ? "tls-chip tls-chip-on" : "tls-chip tls-chip-warn"
                }
                onClick={() => {
                  setGuestsOpen((v) => !v);
                  pushToast(
                    !guestsOpen
                      ? "Guest requests open"
                      : "Guest requests closed",
                  );
                }}
              >
                {guestsOpen ? "Accepting guests" : "Guests closed"}
              </button>
            </div>
            <p
              className="tls-empty"
              style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}
              data-testid="cam-gum-debug-inline"
            >
              Cam debug:{" "}
              {gumDebug.status === "ok"
                ? `gum: ok ${gumDebug.constraints || "{video:true}"}`
                : gumDebug.status === "fail"
                  ? `gum: ${gumDebug.name || "Error"}: ${gumDebug.message || ""} ${gumDebug.constraints || ""}`
                  : "gum: idle"}
            </p>
          </div>
          </section>
          </StudioRailSlot>
          <StudioRailSlot {...leftSlotProps("layouts")}>
          <details className="tls-fold">
            <summary>
              Layouts
              <span className="tls-fold-current">{phoneLayout.label}</span>
            </summary>
            <div className="tls-fold-body">
          <div
            className={`tls-layout-picker tls-layout-picker-grid tls-layout-orient-${
              orientation === "landscape" ? "landscape" : "portrait"
            }`}
            role="listbox"
            aria-label="Stage layouts"
          >
            {phoneLayoutOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={phoneLayout.id === opt.id}
                title={opt.blurb}
                className={
                  phoneLayout.id === opt.id
                    ? "tls-layout-tile tls-layout-tile-on"
                    : "tls-layout-tile"
                }
                onClick={() => {
                  setViewerLayout(opt.id);
                  if (orientation === "landscape") {
                    lastLandscapeLayoutRef.current = opt.id;
                  } else {
                    lastPortraitLayoutRef.current = opt.id;
                  }
                }}
              >
                <span
                  className={`tls-layout-glyph tls-lg-${opt.id}`}
                  aria-hidden
                >
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <span className="tls-layout-tile-label">{opt.label}</span>
              </button>
            ))}
          </div>
            </div>
          </details>
          </StudioRailSlot>

          <StudioRailSlot {...leftSlotProps("more")}>
          <nav className="tls-pillar-nav" aria-label="Studio pillars">
            {(
              [
                ["compositing", "Scenes"],
                ["triggers", "Alerts"],
                ["broadcast", "Broadcast"],
                ["audio", "Audio"],
                ["caps", "Caps"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={
                  leftPillar === id
                    ? "tls-pillar-tab tls-pillar-tab-on"
                    : "tls-pillar-tab"
                }
                onClick={() => setLeftPillar(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {leftPillar === "compositing" ? (
            <>
          <section className="tls-section">
            <details className="tls-advanced">
              <summary className="tls-advanced-summary">Advanced</summary>
              <p className="tls-panel-label">Saved studios</p>
              <div className="tls-preset-box">
                <select
                  className="tls-preset-select"
                  value={selectedPresetId}
                  aria-label="Load saved studio"
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) loadPresetById(id);
                  }}
                >
                  <option value="">Load preset…</option>
                  {studioPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  className="tls-preset-name"
                  placeholder="Name this studio"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <div className="tls-chip-row">
                  <button type="button" className="tls-chip" onClick={saveCurrentPreset}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="tls-chip"
                    disabled={!selectedPresetId}
                    onClick={removeSelectedPreset}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="tls-panel-label">Browser source / OBS</p>
              <button type="button" className="tls-source" onClick={() => void copyOverlayUrl()}>
                <span className="tls-source-name">Copy overlay URL</span>
                <span className="tls-source-hint">
                  OBS · {overlayBrowserSourcePath(active?.sessionId)}
                </span>
              </button>
              <a
                className="tls-overlay-open"
                href={overlayBrowserSourcePath(active?.sessionId)}
                target="_blank"
                rel="noreferrer"
              >
                Open clean feed
              </a>
              <p className="tls-empty tls-sync-note">{overlaySyncNote}</p>
              <button type="button" className="tls-source" onClick={() => void copyDeckUrl()}>
                <span className="tls-source-name">Copy Studio Deck URL</span>
                <span className="tls-source-hint">
                  Stream Deck Website · {deckCompanionPath()}
                </span>
              </button>
              <a
                className="tls-overlay-open"
                href={deckCompanionPath()}
                target="_blank"
                rel="noreferrer"
              >
                Open Studio Deck
              </a>
            </details>
          </section>

          <section className="tls-section tls-section-fold">
            <details className="tls-fold">
              <summary>
                Saved scenes
                <span className="tls-fold-current">
                  {programScenes.length
                    ? `${programScenes.length} saved`
                    : "none"}
                </span>
              </summary>
              <div className="tls-fold-body">
            <div className="tls-preset-box">
              <select
                className="tls-preset-select"
                value={selectedSceneId}
                aria-label="Load program scene"
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) loadSceneById(id);
                }}
              >
                <option value="">Load scene…</option>
                {programScenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <input
                className="tls-preset-name"
                placeholder="Name this scene"
                value={sceneName}
                onChange={(e) => setSceneName(e.target.value)}
              />
              <div className="tls-chip-row">
                <button type="button" className="tls-chip" onClick={saveCurrentScene}>
                  Save scene
                </button>
                <button
                  type="button"
                  className="tls-chip"
                  disabled={!selectedSceneId}
                  onClick={removeSelectedScene}
                >
                  Delete
                </button>
              </div>
            </div>
            {programScenes.length > 0 ? (
              <div className="tls-scene-switcher" role="group" aria-label="Switch scene">
                {programScenes.slice(0, 6).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={
                      selectedSceneId === s.id
                        ? "tls-chip tls-chip-on"
                        : "tls-chip"
                    }
                    onClick={() => loadSceneById(s.id)}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="tls-empty">
                Save a scene for one-click crossfade switch. Use Program source
                above for main feed, camera, and PIP.
              </p>
            )}
            <p className="tls-empty tls-coming">
              Coming online: chroma / AI background removal · freeform crop builder
            </p>
              </div>
            </details>
          </section>

          <section className="tls-section tls-section-fold">
          <details className="tls-fold tls-fold-bare">
          <summary>
            Overlays
          </summary>
          <div className="tls-fold-body">
          <p className="tls-empty">
            Size each widget with S/M/L (Jukebox starts Small). Drag on the
            preview to move. Reset restores sizes and positions.
          </p>
          <div className="tls-overlay-toggles">
            {STUDIO_OVERLAYS.map((o) => {
              const scale = overlayPositions[o.id]?.scale ?? 1;
              const near = (n: number) => Math.abs(scale - n) < 0.08;
              return (
                <div key={o.id} className="tls-overlay-row">
                  <label className="tls-overlay-toggle">
                    <span>{o.label}</span>
                    <input
                      type="checkbox"
                      checked={overlayState[o.id]}
                      onChange={() => toggleOverlay(o.id)}
                    />
                  </label>
                  <div
                    className="tls-overlay-scale"
                    role="group"
                    aria-label={`${o.label} size`}
                  >
                    <span>Size</span>
                    <button
                      type="button"
                      className={near(OVERLAY_SCALE_PRESETS.S) ? "tls-chip-on" : undefined}
                      onClick={() => setOverlayScale(o.id, OVERLAY_SCALE_PRESETS.S)}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      className={near(OVERLAY_SCALE_PRESETS.M) ? "tls-chip-on" : undefined}
                      onClick={() => setOverlayScale(o.id, OVERLAY_SCALE_PRESETS.M)}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      className={near(OVERLAY_SCALE_PRESETS.L) ? "tls-chip-on" : undefined}
                      onClick={() => setOverlayScale(o.id, OVERLAY_SCALE_PRESETS.L)}
                    >
                      L
                    </button>
                    <input
                      type="range"
                      min={40}
                      max={160}
                      value={Math.round(scale * 100)}
                      aria-label={`${o.label} scale`}
                      onChange={(e) =>
                        setOverlayScale(o.id, Number(e.target.value) / 100)
                      }
                    />
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="tls-overlay-reset"
              onClick={resetOverlayPositions}
            >
              Reset overlays
            </button>
          </div>
          </div>
          </details>
          </section>
            </>
          ) : null}

          {leftPillar === "triggers" ? (
            <>
          <section className="tls-section">
          <p className="tls-panel-label">Alert queue</p>
          <div className="tls-chip-row">
            <button
              type="button"
              className={alertQueue.paused ? "tls-chip tls-chip-warn" : "tls-chip"}
              onClick={() =>
                setAlertQueue((prev) =>
                  setAlertQueuePaused(prev, !prev.paused),
                )
              }
            >
              {alertQueue.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              className="tls-chip"
              onClick={() => {
                skipStudioTts();
                alertBusyRef.current = false;
                const playing = alertQueue.items.find(
                  (i) => i.status === "playing",
                );
                if (playing) {
                  setAlertQueue((prev) => markAlertDone(prev, playing.id));
                }
              }}
            >
              Skip
            </button>
            <button
              type="button"
              className="tls-chip"
              disabled={!alertQueue.lastPlayed}
              onClick={() => {
                const last = alertQueue.lastPlayed;
                if (!last) return;
                queueStudioAlert({
                  kind: last.kind,
                  text: last.text,
                  stingId: last.stingId as StingId | undefined,
                });
              }}
            >
              Replay last
            </button>
            <button
              type="button"
              className="tls-chip"
              onClick={() => {
                skipStudioTts();
                alertBusyRef.current = false;
                setAlertQueue((prev) => clearAlertQueue(prev));
              }}
            >
              Clear
            </button>
          </div>
          {pendingAlerts === 0 && !alertQueue.items.some((i) => i.status === "playing") ? (
            <p className="tls-empty">Queue empty · gifts / chat / joins land here</p>
          ) : (
            <ul className="tls-alert-queue">
              {alertQueue.items
                .filter((i) => i.status === "pending" || i.status === "playing")
                .slice(0, 8)
                .map((i) => (
                  <li key={i.id}>
                    <span>
                      {i.status === "playing" ? "▶ " : ""}
                      {i.kind}: {i.text.slice(0, 48) || i.stingId || "SFX"}
                    </span>
                    {i.status === "pending" ? (
                      <button
                        type="button"
                        className="tls-chip"
                        onClick={() =>
                          setAlertQueue((prev) => cancelAlert(prev, i.id))
                        }
                      >
                        Cancel
                      </button>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
          </section>

          <section className="tls-section">
          <p className="tls-panel-label">Gift → SFX map</p>
          <div className="tls-tts-box">
            <label className="tls-goal-target">
              <span>Default sting</span>
              <select
                className="tls-preset-select"
                value={giftAlertMap.defaultSting}
                onChange={(e) => {
                  const next = {
                    ...giftAlertMap,
                    defaultSting: e.target.value as GiftAlertMapPrefs["defaultSting"],
                  };
                  setGiftAlertMap(next);
                  saveGiftAlertMap(next);
                }}
              >
                {STING_PAD.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="tls-goal-target">
              <span>High-tier coins</span>
              <input
                type="number"
                min={1}
                step={50}
                value={giftAlertMap.highTierCoins}
                onChange={(e) => {
                  const next = {
                    ...giftAlertMap,
                    highTierCoins: Math.max(1, Number(e.target.value) || 500),
                  };
                  setGiftAlertMap(next);
                  saveGiftAlertMap(next);
                }}
              />
            </label>
            <label className="tls-goal-target">
              <span>High-tier sting</span>
              <select
                className="tls-preset-select"
                value={giftAlertMap.highTierSting}
                onChange={(e) => {
                  const next = {
                    ...giftAlertMap,
                    highTierSting: e.target.value as GiftAlertMapPrefs["highTierSting"],
                  };
                  setGiftAlertMap(next);
                  saveGiftAlertMap(next);
                }}
              >
                {STING_PAD.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="tls-overlay-toggle">
              <span>Flash gifts overlay</span>
              <input
                type="checkbox"
                checked={giftAlertMap.flashGiftOverlay}
                onChange={(e) => {
                  const next = {
                    ...giftAlertMap,
                    flashGiftOverlay: e.target.checked,
                  };
                  setGiftAlertMap(next);
                  saveGiftAlertMap(next);
                }}
              />
            </label>
            <p className="tls-empty tls-coming">
              Coming online: per-SKU video / GIF alert library
            </p>
          </div>
          </section>

          <section className="tls-section">
          <p className="tls-panel-label">TTS alerts</p>
          <div className="tls-tts-box">
            <label className="tls-overlay-toggle">
              <span>Master TTS</span>
              <input
                type="checkbox"
                checked={ttsPrefs.enabled}
                onChange={(e) => {
                  const next = { ...ttsPrefs, enabled: e.target.checked };
                  setTtsPrefs(next);
                  saveTtsPrefs(next);
                }}
              />
            </label>
            <label className="tls-overlay-toggle">
              <span>Gifts</span>
              <input
                type="checkbox"
                checked={ttsPrefs.speakGifts}
                onChange={(e) => {
                  const next = { ...ttsPrefs, speakGifts: e.target.checked };
                  setTtsPrefs(next);
                  saveTtsPrefs(next);
                }}
              />
            </label>
            <label className="tls-overlay-toggle">
              <span>Chat</span>
              <input
                type="checkbox"
                checked={ttsPrefs.speakChat}
                onChange={(e) => {
                  const next = { ...ttsPrefs, speakChat: e.target.checked };
                  setTtsPrefs(next);
                  saveTtsPrefs(next);
                }}
              />
            </label>
            <label className="tls-overlay-toggle">
              <span>Joins</span>
              <input
                type="checkbox"
                checked={ttsPrefs.speakJoins}
                onChange={(e) => {
                  const next = { ...ttsPrefs, speakJoins: e.target.checked };
                  setTtsPrefs(next);
                  saveTtsPrefs(next);
                }}
              />
            </label>
            <label className="tls-goal-target">
              <span>Rate</span>
              <input
                type="range"
                min={0.5}
                max={1.8}
                step={0.1}
                value={ttsPrefs.rate}
                onChange={(e) => {
                  const next = {
                    ...ttsPrefs,
                    rate: Number(e.target.value) || 1,
                  };
                  setTtsPrefs(next);
                  saveTtsPrefs(next);
                }}
              />
            </label>
            <label className="tls-goal-target">
              <span>Voice</span>
              <select
                className="tls-preset-select"
                value={ttsPrefs.voiceURI}
                onChange={(e) => {
                  const next = { ...ttsPrefs, voiceURI: e.target.value };
                  setTtsPrefs(next);
                  saveTtsPrefs(next);
                }}
              >
                <option value="">Default</option>
                {ttsVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
            <label className="tls-goal-target">
              <span>Ban words</span>
              <textarea
                value={ttsPrefs.banWords}
                placeholder="comma or newline separated"
                rows={2}
                onChange={(e) => {
                  const next = { ...ttsPrefs, banWords: e.target.value };
                  setTtsPrefs(next);
                  saveTtsPrefs(next);
                }}
              />
            </label>
            <div className="tls-chip-row">
              <button
                type="button"
                className="tls-chip"
                onClick={() =>
                  speakStudioAlert("Blyp studio voice check", {
                    ...ttsPrefs,
                    enabled: true,
                  }, "manual")
                }
              >
                Test voice
              </button>
              <button
                type="button"
                className="tls-chip"
                onClick={() => skipStudioTts()}
              >
                Skip TTS
              </button>
            </div>
            <p className="tls-empty tls-coming">
              Coming online: !commands · outbound webhooks
            </p>
          </div>
          </section>
            </>
          ) : null}

          {leftPillar === "broadcast" ? (
            <>
          <section className="tls-section">
            <p className="tls-panel-label">Destinations</p>
            <p className="tls-empty">
              Blyp is always on. Click the grey TikTok or YouTube logo, paste
              the stream URL and key, then OK. Lit logos are included when you
              GO LIVE.
            </p>
          </section>

          <section className="tls-section">
            <p className="tls-panel-label">Guests</p>
            <p className="tls-empty">
              Accepting guests, requests, mute / cam / kick live in the Host
              controls above (always visible).
            </p>
          </section>

          <section className="tls-section">
            <p className="tls-panel-label">Stream metadata</p>
            <p className="tls-empty">
              Title is in the top bar (pre-flight). Category, tags, and cover —
              coming online.
            </p>
          </section>

          <section className="tls-section">
            <p className="tls-panel-label">Moderation</p>
            <p className="tls-empty tls-coming">
              Ban / timeout / pin — blocked on live-service web host APIs
            </p>
          </section>

          <section className="tls-section">
            <p className="tls-panel-label">Recording</p>
            <p className="tls-empty tls-coming">
              Cloud / local VOD — not claimed (no fake record button)
            </p>
          </section>
            </>
          ) : null}

          {leftPillar === "audio" ? (
            <>
          <section className="tls-section">
            <p className="tls-panel-label">Mute / cam</p>
            <p className="tls-empty">
              Cam on/off and Mic on/off live in Host · ready above.
            </p>
          </section>
          <section className="tls-section">
            <p className="tls-panel-label">Mixer · GO LIVE</p>
            <div className="tls-rail-deck" aria-label="Mixer and publish">
              <div className="tls-deck-row tls-deck-mix">
                <label className="tls-mix">
                  <span>Mic</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={micVol}
                    onChange={(e) => setMicVol(Number(e.target.value))}
                  />
                </label>
                <label className="tls-mix">
                  <span>Music</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={musicVol}
                    onChange={(e) => setMusicVol(Number(e.target.value))}
                  />
                </label>
                <label className="tls-mix">
                  <span>Alerts</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={alertsVol}
                    onChange={(e) => setAlertsVol(Number(e.target.value))}
                  />
                </label>
                <label className="tls-mix tls-mix-check">
                  <span>Hear alerts</span>
                  <input
                    type="checkbox"
                    checked={hearAlertsLocal}
                    onChange={(e) => setHearAlertsLocal(e.target.checked)}
                  />
                </label>
                {active ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="tls-go tls-end"
                    onClick={() => void onEnd()}
                  >
                    {busy ? "Ending…" : "END STREAM"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    className="tls-go"
                    onClick={handlePrimaryLiveAction}
                  >
                    {busy ? "Starting…" : "GO LIVE"}
                  </button>
                )}
              </div>
            </div>
            <p className="tls-empty tls-coming">
              Coming online: noise gate · ducking · separate desktop bus
            </p>
          </section>
          <section className="tls-section">
            <p className="tls-panel-label">Soundboard · Nuke</p>
            <div
              className="tls-rail-deck"
              aria-label="Soundboard"
            >
              <div className="tls-deck-row tls-soundboard" role="group">
                <button
                  type="button"
                  className={
                    strikeArmed
                      ? "tls-ctrl tls-ctrl-nuke tls-ctrl-nuke-armed"
                      : "tls-ctrl tls-ctrl-nuke"
                  }
                  title={
                    strikeArmed
                      ? "Cycle Nukemonkey strike on cells 0–8"
                      : "Arm Grid 3×3 for Nukemonkey, then Nuke or click a cell"
                  }
                  onClick={playNukeOrArm}
                >
                  Nuke
                  <span className="tls-ctrl-hint">
                    {strikeArmed ? "💣 cell" : "arm grid"}
                  </span>
                </button>
                {STING_PAD.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="tls-ctrl"
                    title={`${s.name} (${s.hint})`}
                    onClick={() => playPad(s.id)}
                  >
                    {s.name}
                    <span className="tls-ctrl-hint">{s.hint}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="tls-ctrl"
                  onClick={() => customStingRef.current?.click()}
                >
                  Custom
                </button>
                <input
                  ref={customStingRef}
                  type="file"
                  accept="audio/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    void studioAudio.playCustomSting(file).then((ok) => {
                      if (ok) {
                        pushFeedEvent(`SFX · ${file.name.slice(0, 24)}`);
                        pushToast("Custom sting");
                      } else {
                        pushToast("Custom sting failed");
                      }
                    });
                  }}
                />
              </div>
            </div>
          </section>
            </>
          ) : null}

          {leftPillar === "caps" ? (
            <section className="tls-section tls-caps">
              <p className="tls-panel-label">Capabilities</p>
              <p className="tls-empty">
                Matrix SoT · DONE {matrixCounts.DONE} · PARTIAL{" "}
                {matrixCounts.PARTIAL} · MISSING {matrixCounts.MISSING} ·
                BLOCKED {matrixCounts.BLOCKED}
              </p>
              {STUDIO_FEATURE_MATRIX.map((pillar) => (
                <div key={pillar.id} className="tls-caps-pillar">
                  <p className="tls-caps-title">{pillar.title}</p>
                  <p className="tls-empty">{pillar.blurb}</p>
                  <ul className="tls-caps-list">
                    {pillar.items.map((item) => (
                      <li key={item.id}>
                        <span
                          className={`tls-caps-status tls-caps-${item.status.toLowerCase()}`}
                        >
                          {item.status}
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <em>{item.note}</em>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}
          </StudioRailSlot>
        </aside>

        <section className="tls-center">
          {boothMode === "team-desk" ? (
            <div className="tls-team-desk" aria-label="Team battle diary desk">
              <div className="tls-team-desk-bar">
                <p className="tls-panel-label">
                  Team · battle diary · ← Portrait · → Landscape
                </p>
                <div className="tls-chip-row">
                  <button
                    type="button"
                    className="tls-chip"
                    onClick={() => applyBoothMode("portrait")}
                  >
                    Back to Portrait
                  </button>
                  <button
                    type="button"
                    className="tls-chip"
                    disabled={studioTeamBusy}
                    onClick={() => void refreshStudioTeam()}
                  >
                    {studioTeamBusy ? "Refreshing…" : "Refresh desk"}
                  </button>
                  <Link href="/teams" className="tls-chip tls-chip-link">
                    Open /teams
                  </Link>
                </div>
              </div>
              {studioTeamError && !studioTeam ? (
                <p className="tls-empty tls-team-desk-empty">{studioTeamError}</p>
              ) : null}
              {studioTeamBusy && !studioTeam ? (
                <p className="tls-empty">Loading team desk…</p>
              ) : null}
              {studioTeam ? (
                <TeamDashboard
                  team={studioTeam}
                  onRefresh={() => void refreshStudioTeam()}
                  busy={studioTeamBusy}
                />
              ) : !studioTeamBusy && !studioTeamError ? (
                <p className="tls-empty">No team loaded.</p>
              ) : null}
            </div>
          ) : (
          <div className="tls-center-program">
          <div className="tls-stage-wrap">
            <div
              className={
                orientation === "portrait"
                  ? "tls-device tls-device-phone"
                  : "tls-device tls-device-tablet"
              }
            >
              <div className="tls-device-island" aria-hidden />
              <div className="tls-device-screen" data-program-root>
            <BombStrikeStage className={stageFrameClass(orientation, phoneLayout.id)}>
              <GiftCinemaLayer cue={giftCinemaCue} />
              {!phoneLayout.hostInGrid ? (
                <div className="tls-program-host">
                  <video
                    ref={videoRef}
                    className={
                      sceneXfade ? "tls-program tls-program-xfade" : "tls-program"
                    }
                    muted
                    playsInline
                    autoPlay
                  />
                  {pipOn ? (
                    <video
                      ref={pipVideoRef}
                      className="tls-program-pip"
                      muted
                      playsInline
                      autoPlay
                    />
                  ) : null}
                  {camOff ? (
                    <div className="tls-cam-off-veil" aria-hidden>
                      Camera off
                    </div>
                  ) : null}
                  <StudioProgramOverlays
                      overlayState={overlayState}
                      overlayPositions={overlayPositions}
                      movable
                      onPosChange={setOverlayPos}
                      gifters={giftersLines}
                      goalPct={goalPct}
                      goalLabel={`Goal ${goalPct}%`}
                      jukeboxNow={jukeboxNow}
                      jukeboxArt={jukeboxArt}
                      jukeboxTitle={jukeboxTitle}
                      jukeboxArtist={jukeboxArtist}
                      jukeboxNext={jukeboxNext}
                      jukeboxPos={jukeboxPos}
                      jukeboxDur={jukeboxDur}
                      jukeboxPaused={jukeboxPaused}
                      giftsLabel={giftsLabel}
                      chatLines={chatLines}
                      events={feedEvents}
                      timerLabel={timerLabel}
                      viewers={viewerCount}
                      watchUrl={watchUrl}
                    />
                  {!previewOn ? (
                    <div className="tls-preview-empty">
                      <p>{busy ? "Opening camera…" : "No preview"}</p>
                      <button
                        type="button"
                        className="tls-preview-btn"
                        onClick={() => {
                          setError(null);
                          setCamOff(false);
                          setMainSource("laptop");
                          setPipOn(false);
                          void startPreview("camera", orientation);
                        }}
                      >
                        Start preview
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {phoneLayout.guestSlots > 0 || phoneLayout.hostInGrid ? (
                <div className="tls-guest-strip" data-layout={phoneLayout.id}>
                  {phoneLayout.hostInGrid
                    ? Array.from({ length: 9 }, (_, i) => {
                        const hostIndex = 4;
                        if (i === hostIndex) {
                          return (
                            <button
                              type="button"
                              key="host-cell"
                              data-bomb-cell={i}
                              className="tls-guest-tile tls-guest-tile-host"
                              aria-label="Host cell"
                              title={
                                strikeArmed ? "Nuke this cell" : "Host"
                              }
                              onClick={() => playBombStrike(i)}
                            >
                              <video
                                ref={videoRef}
                                className="tls-program"
                                muted
                                playsInline
                                autoPlay
                              />
                              {camOff ? (
                                <div className="tls-cam-off-veil" aria-hidden>
                                  Camera off
                                </div>
                              ) : null}
                            </button>
                          );
                        }
                        const guestIdx = i < hostIndex ? i : i - 1;
                        return renderGuestTile(phoneTiles[guestIdx], guestIdx, i);
                      })
                    : phoneTiles.map((tile, i) =>
                        renderGuestTile(
                          tile,
                          i,
                          phoneLayout.guestSlots === 9 ? i : undefined,
                        ),
                      )}
                </div>
              ) : null}
              {phoneLayout.hostInGrid ? (
                <StudioProgramOverlays
                  overlayState={overlayState}
                  overlayPositions={overlayPositions}
                  movable
                  onPosChange={setOverlayPos}
                  gifters={giftersLines}
                  goalPct={goalPct}
                  goalLabel={`Goal ${goalPct}%`}
                  jukeboxNow={jukeboxNow}
                  jukeboxArt={jukeboxArt}
                  jukeboxTitle={jukeboxTitle}
                  jukeboxArtist={jukeboxArtist}
                  jukeboxNext={jukeboxNext}
                  jukeboxPos={jukeboxPos}
                  jukeboxDur={jukeboxDur}
                  jukeboxPaused={jukeboxPaused}
                  giftsLabel={giftsLabel}
                  chatLines={chatLines}
                  events={feedEvents}
                  timerLabel={timerLabel}
                  viewers={viewerCount}
                  watchUrl={watchUrl}
                />
              ) : null}
            </BombStrikeStage>
              </div>
            </div>
          </div>
          </div>
          )}
        </section>

        <aside className="tls-right">
          <StudioRailSlot {...rightSlotProps("goal")}>
          <section className="tls-rail tls-rail-goal" aria-label="Live goal">
            <h2>Live goal</h2>
            <div className="tls-goal-card">
              <div className="tls-goal-meter" aria-hidden>
                <i style={{ width: `${goalPct}%` }} />
              </div>
              <div className="tls-goal-nums">
                <strong>
                  {(gifts?.coinsReceived ?? 0).toLocaleString()} coins
                </strong>
                <span>{goalPct}%</span>
              </div>
              <label className="tls-goal-target">
                <span>Target</span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={goalTarget}
                  onChange={(e) =>
                    setGoalTarget(Math.max(100, Number(e.target.value) || 100))
                  }
                />
              </label>
              <p className="tls-empty">
                {gifts
                  ? `${gifts.viewerGiftCount} gifts this stream`
                  : "Waiting for the first gift"}
              </p>
            </div>
          </section>
          </StudioRailSlot>
          <StudioRailSlot {...rightSlotProps("team")}>
          <section className="tls-rail tls-rail-team" aria-label="Team desk">
            <div className="tls-flyout tls-flyout-stretch">
              <button
                type="button"
                className={
                  boothMode === "team-desk"
                    ? "tls-deck-btn tls-deck-btn-block tls-deck-btn-on"
                    : "tls-deck-btn tls-deck-btn-block"
                }
                aria-expanded={teamMenuOpen}
                onClick={() => {
                  setTeamMenuOpen((v) => !v);
                  setMainMenuOpen(false);
                  setPipMenuOpen(false);
                  setHeaderGuestsOpen(false);
                }}
              >
                Team desk
                {studioTeam?.name ? ` · ${studioTeam.name}` : ""}
                <span className="tls-flyout-caret" aria-hidden>
                  ▾
                </span>
              </button>
              {teamMenuOpen ? (
                <div className="tls-flyout-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={
                      boothMode === "team-desk" ? "tls-flyout-item-on" : undefined
                    }
                    onClick={() => {
                      applyBoothMode("team-desk");
                      setTeamMenuOpen(false);
                    }}
                  >
                    <strong>Open desk</strong>
                    <span>Battle diary, roster, money</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={boothMode !== "team-desk"}
                    onClick={() => {
                      applyBoothMode("portrait");
                      setTeamMenuOpen(false);
                    }}
                  >
                    <strong>Back to studio</strong>
                    <span>Return to the program preview</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={studioTeamBusy}
                    onClick={() => {
                      void refreshStudioTeam();
                      setTeamMenuOpen(false);
                    }}
                  >
                    <strong>{studioTeamBusy ? "Refreshing…" : "Refresh desk"}</strong>
                    <span>Reload roster and battles</span>
                  </button>
                  <Link
                    href="/teams"
                    className="tls-flyout-link"
                    onClick={() => setTeamMenuOpen(false)}
                  >
                    <strong>Open /teams</strong>
                    <span>Full team page</span>
                  </Link>
                </div>
              ) : null}
            </div>
          </section>
          </StudioRailSlot>
          <StudioRailSlot {...rightSlotProps("jukebox")}>
          <section className="tls-rail tls-rail-jukebox jbx-rail" aria-label="Jukebox">
            <h2>Audio · Jukebox</h2>
            <div className="jbx-cabinet">
            <StudioJukeboxPanel
              status={spotifyStatus}
              onStatus={(s) => {
                rememberSpotifyLinkStatus(s);
                setSpotifyStatus(s);
              }}
              onToast={pushToast}
              onNowPlaying={onJukeboxNow}
              onPlayhead={onJukeboxPlayhead}
              onFeed={pushFeedEvent}
              requireAuth={requireAuth}
            />
            <details className="jbx-house">
              <summary>This computer</summary>
              <div className="jbx-house-body">
            <button
              type="button"
              className="jbx-key"
              onClick={() => jukeboxFileRef.current?.click()}
            >
              Play a file from this computer
            </button>
            <input
              ref={jukeboxFileRef}
              type="file"
              accept="audio/*"
              multiple
              hidden
              onChange={(e) => {
                onAddJukeboxFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {activeBed === "file" ? (
              <button
                type="button"
                className="jbx-key"
                onClick={() => {
                  studioAudio.stopMusic();
                  setActiveBed(null);
                  setJukeboxNow("Queue empty");
                  setJukeboxTitle("");
                  setJukeboxArtist("");
                  setJukeboxArt(null);
                }}
              >
                Stop computer audio
              </button>
            ) : null}
            {jukeboxQueue.length > 0 ? (
              <ul className="jbx-strips">
                {jukeboxQueue.map((t) => (
                  <li key={t.id} className="jbx-strip">
                    <button type="button" className="jbx-strip-body" onClick={() => void playJukeboxFile(t)}>
                      <strong>{t.name}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
              </div>
            </details>
            </div>
          </section>
          </StudioRailSlot>
          <StudioRailSlot {...rightSlotProps("chat")}>
          <section className="tls-rail tls-rail-chat">
            <h2>Broadcast · Chat</h2>
            {tiktokRoomStatus?.message ? (
              <p className="tls-empty">
                TikTok · {tiktokRoomStatus.phase} · {tiktokRoomStatus.message}
              </p>
            ) : null}
            {railChat.length === 0 ? (
              <p className="tls-empty">
                Blyp watch comments and TikTok live chat land here.
              </p>
            ) : (
              <ul className="tls-chat">
                {railChat.map((c) => (
                  <li key={c.id} className={c.kind === "gift" ? "tls-chat-gift-row" : undefined}>
                    {c.source === "tiktok" ? (
                      <span className="tls-chat-src">TikTok</span>
                    ) : null}
                    {c.kind === "gift" ? (
                      <span className="tls-chat-gift">Gift</span>
                    ) : null}
                    <strong>{c.displayName || c.username}</strong> {c.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
          </StudioRailSlot>
          <StudioRailSlot {...rightSlotProps("guests")}>
          <section className="tls-rail">
            <h2>Broadcast · Guests {guestsOpen ? "" : "· closed"}</h2>
            {!guestsOpen ? (
              <p className="tls-empty">
                Not accepting new guests. Toggle Accepting guests on the left.
              </p>
            ) : null}
            {guestPollError ? (
              <p className="tls-error-inline">{guestPollError}</p>
            ) : null}
            {guestsOpen && pending.length === 0 && onStage.length === 0 ? (
              <p className="tls-empty">No requests yet.</p>
            ) : null}
            {(pending.length > 0 || onStage.length > 0) && (
              <ul className="tls-guests">
                {pending.map((g) => (
                  <li key={`p-${g.userId}`}>
                    <span className="tls-guest-id" title={g.userId}>
                      {formatGuestLabel(g.userId, guestLabels)}
                    </span>
                    <span className="tls-guest-actions">
                      <button
                        type="button"
                        disabled={busy || !guestsOpen}
                        onClick={() => void onGuestAction("accept", g.userId)}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onGuestAction("reject", g.userId)}
                      >
                        Reject
                      </button>
                    </span>
                  </li>
                ))}
                {onStage.map((g) => (
                  <li key={`s-${g.userId}`}>
                    <span className="tls-guest-id" title={g.userId}>
                      {formatGuestLabel(g.userId, guestLabels)}
                    </span>
                    <span className="tls-muted">{g.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </StudioRailSlot>
          <StudioRailSlot {...rightSlotProps("gifts")}>
          <section className="tls-rail tls-rail-gifts">
            <h2>Alerts · Gifts</h2>
            <p className="tls-empty">
              {gifts
                ? `${gifts.coinsReceived.toLocaleString()} coins · ${gifts.gemsEarned.toLocaleString()} gems · ${gifts.viewerGiftCount} gifts`
                : "Waiting for the first gift…"}
            </p>
            <p className="tls-panel-label">Top gifters</p>
            {topGifters.length === 0 ? (
              <p className="tls-empty">
                {gifterSourceNote || "Ranked names appear as gifts land"}
              </p>
            ) : (
              <ol className="tls-top-gifters">
                {topGifters.map((g) => (
                  <li key={g.userId}>
                    <strong>{g.name}</strong>
                    <span>{g.coins.toLocaleString()} coins</span>
                  </li>
                ))}
              </ol>
            )}
            {gifterSourceNote ? (
              <p className="tls-empty">{gifterSourceNote}</p>
            ) : null}
          </section>
          </StudioRailSlot>
        </aside>
      </div>
    </div>
  );
}
