import { isNativePublishVideoTrack } from "@/lib/studioDeskMedia";

/**
 * IVS Real-Time host publish for desktop Chrome/Edge.
 * Amazon web-broadcast host pattern: one camera video + one mic audio
 * LocalStageStream from getUserMedia. Do not publish a canvas captureStream
 * on the camera path — phones then get audio + a still frame.
 */

export type IvsHostPublishHandle = {
  localStream: MediaStream;
  leave: () => Promise<void>;
  /** Swap the published audio track (gum ↔ mix dest). Video stays put. */
  setAudioTrack: (track: MediaStreamTrack, muted?: boolean) => void;
  setAudioMuted: (muted: boolean) => void;
};

type StageParticipantLike = {
  isLocal?: boolean;
  userId?: string;
  attributes?: Record<string, unknown>;
};

type StageStreamLike = {
  streamType?: string;
  mediaStreamTrack?: MediaStreamTrack;
};

type StageLike = {
  join: () => Promise<void>;
  leave: () => Promise<void> | void;
  on: (event: string | number, cb: (...args: unknown[]) => void) => void;
  refreshStrategy?: () => void;
};

type LocalStageStreamLike = {
  setMuted?: (muted: boolean) => void;
};

type VideoTrackWithHint = MediaStreamTrack & {
  contentHint?: string;
};

/**
 * Phone IVS RT subscriber is built for native host ~600kbps / 15fps.
 * 1800/30 + default web simulcast layer-ramps: stall then jump on the phone.
 * Encoder ceiling only — do not applyConstraints on the camera track.
 */
const PUBLISH_MAX_FPS = 24;

/** Target encode ceiling — surfaced in LIVE Studio health strip. */
export const PUBLISH_MAX_BITRATE_KBPS = 900;

async function hardenPublishVideoTrack(track: MediaStreamTrack): Promise<void> {
  try {
    const settings = track.getSettings?.() ?? {};
    const isDisplay =
      settings.displaySurface != null ||
      /screen|display|web-contents|window/i.test(track.label || "");
    (track as VideoTrackWithHint).contentHint = isDisplay ? "detail" : "motion";
    // Never applyConstraints here. Camera: native fps. Canvas: constrain mutes.
    // Display already requested fps at getDisplayMedia. Extra frameRate max
    // starved the encoder (stall, then jump).
  } catch {
    /* ignore */
  }
}

export async function startIvsWebHostPublish(opts: {
  participantToken: string;
  videoEl?: HTMLVideoElement | null;
  /**
   * Prebuilt MediaStream (LIVE Studio camera/screen). Camera mode must be
   * getUserMedia tracks — not a canvas captureStream.
   */
  mediaStream?: MediaStream | null;
  /**
   * When true, leave() does not stop media tracks (shared preview / canvas).
   * Defaults to true when mediaStream is provided, false otherwise.
   */
  retainMediaOnLeave?: boolean;
  /**
   * Subscribe to Blyp guests so LIVE Studio can composite their tiles
   * into the program canvas. App Real-Time guests still publish themselves.
   */
  subscribeGuests?: boolean;
  onGuestMedia?: (guests: Record<string, MediaStream>) => void;
  /** Mute the published audio LocalStageStream at join (gum mic off). */
  audioMuted?: boolean;
}): Promise<IvsHostPublishHandle> {
  if (typeof window === "undefined") {
    throw new Error("IVS Web Broadcast only runs in the browser");
  }
  const ivs = (await import("amazon-ivs-web-broadcast")) as {
    Stage: new (token: string, strategy: unknown) => StageLike;
    LocalStageStream: new (
      track: MediaStreamTrack,
      config?: Record<string, unknown>,
    ) => unknown;
    SubscribeType: { NONE: unknown; AUDIO_VIDEO: unknown };
    StageEvents: {
      STAGE_CONNECTION_STATE_CHANGED: string | number;
      ERROR: string | number;
      STAGE_PARTICIPANT_STREAMS_ADDED: string | number;
      STAGE_PARTICIPANT_STREAMS_REMOVED: string | number;
      STAGE_PARTICIPANT_LEFT: string | number;
    };
    ConnectionState: { CONNECTED: unknown; DISCONNECTED: unknown };
  };
  const {
    Stage,
    LocalStageStream,
    SubscribeType,
    StageEvents,
    ConnectionState,
  } = ivs;
  const ownsMedia = !opts.mediaStream;
  const retain =
    opts.retainMediaOnLeave ?? Boolean(opts.mediaStream);
  const media =
    opts.mediaStream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    }));
  if (opts.videoEl) {
    opts.videoEl.srcObject = media;
    opts.videoEl.muted = true;
    opts.videoEl.playsInline = true;
    void opts.videoEl.play().catch(() => undefined);
  }
  const audioTrack = media.getAudioTracks()[0];
  const videoTrack =
    media.getVideoTracks().find(isNativePublishVideoTrack) ??
    media.getVideoTracks()[0];
  if (!videoTrack) {
    if (ownsMedia) media.getTracks().forEach((t) => t.stop());
    throw new Error("Video track missing");
  }
  if (!isNativePublishVideoTrack(videoTrack)) {
    if (ownsMedia) media.getTracks().forEach((t) => t.stop());
    throw new Error("Stage video must be the camera or screen — not a canvas");
  }
  // IVS Real-Time requires an audio track; publish silence if capture had none.
  let publishAudio = audioTrack;
  let silentAudio: MediaStreamTrack | null = null;
  if (!publishAudio) {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    } catch {
      ctx = new AudioContext();
    }
    const dest = ctx.createMediaStreamDestination();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const constant = ctx.createConstantSource();
    constant.offset.value = 0;
    constant.connect(gain);
    gain.connect(dest);
    constant.start();
    void ctx.resume().catch(() => undefined);
    silentAudio = dest.stream.getAudioTracks()[0];
    publishAudio = silentAudio;
  }
  await hardenPublishVideoTrack(videoTrack);
  const videoConfig = {
    maxFramerate: PUBLISH_MAX_FPS,
    maxBitrate: PUBLISH_MAX_BITRATE_KBPS,
    simulcast: { enabled: false },
  };
  const audioConfig = {
    stereo: false,
    maxAudioBitrateKbps: 64,
  };
  let audioMuted = !!opts.audioMuted;
  let audioLss = new LocalStageStream(
    publishAudio,
    audioConfig,
  ) as LocalStageStreamLike;
  const videoLss = new LocalStageStream(videoTrack, videoConfig);
  audioLss.setMuted?.(audioMuted);
  const guestVideo = new Map<string, MediaStreamTrack>();
  const guestAudioEls = new Map<string, HTMLAudioElement>();

  const emitGuests = () => {
    if (!opts.onGuestMedia) return;
    const next: Record<string, MediaStream> = {};
    guestVideo.forEach((track, userId) => {
      if (track.readyState === "live") next[userId] = new MediaStream([track]);
    });
    opts.onGuestMedia(next);
  };

  const dropGuest = (userId: string) => {
    guestVideo.delete(userId);
    const audio = guestAudioEls.get(userId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      guestAudioEls.delete(userId);
    }
    emitGuests();
  };

  const guestUserId = (participant: StageParticipantLike): string =>
    String(participant.userId || "").trim();

  const isGuest = (participant: StageParticipantLike): boolean => {
    if (participant.isLocal) return false;
    return String(participant.attributes?.role || "") === "guest";
  };

  const attachGuestStreams = (
    participant: StageParticipantLike,
    streams: StageStreamLike[],
  ) => {
    if (!isGuest(participant)) return;
    const userId = guestUserId(participant);
    if (!userId) return;
    for (const stream of streams) {
      const track = stream.mediaStreamTrack;
      if (!track) continue;
      const kind = stream.streamType || track.kind;
      if (kind === "video") {
        guestVideo.set(userId, track);
      } else if (kind === "audio") {
        let el = guestAudioEls.get(userId);
        if (!el) {
          el = new Audio();
          el.autoplay = true;
          guestAudioEls.set(userId, el);
        }
        el.srcObject = new MediaStream([track]);
        void el.play().catch(() => undefined);
      }
    }
    emitGuests();
  };

  const strategy = {
    stageStreamsToPublish: () => [audioLss, videoLss],
    shouldPublishParticipant: () => true,
    shouldSubscribeToParticipant: (participant: StageParticipantLike) => {
      if (!opts.subscribeGuests) return SubscribeType.NONE;
      return isGuest(participant)
        ? SubscribeType.AUDIO_VIDEO
        : SubscribeType.NONE;
    },
  };
  const stage = new Stage(opts.participantToken, strategy);
  if (opts.subscribeGuests) {
    stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (...args: unknown[]) => {
      attachGuestStreams(
        (args[0] || {}) as StageParticipantLike,
        (args[1] || []) as StageStreamLike[],
      );
    });
    stage.on(
      StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED,
      (...args: unknown[]) => {
        const participant = (args[0] || {}) as StageParticipantLike;
        const streams = (args[1] || []) as StageStreamLike[];
        const userId = guestUserId(participant);
        if (!userId) return;
        for (const stream of streams) {
          const kind = stream.streamType || stream.mediaStreamTrack?.kind;
          if (kind === "video") guestVideo.delete(userId);
          if (kind === "audio") {
            const audio = guestAudioEls.get(userId);
            if (audio) {
              audio.pause();
              audio.srcObject = null;
              guestAudioEls.delete(userId);
            }
          }
        }
        emitGuests();
      },
    );
    stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (...args: unknown[]) => {
      const userId = guestUserId((args[0] || {}) as StageParticipantLike);
      if (userId) dropGuest(userId);
    });
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const failTimer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Timed out joining IVS stage"));
    }, 20_000);
    stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: unknown) => {
      if (settled) return;
      if (state === ConnectionState.CONNECTED) {
        settled = true;
        window.clearTimeout(failTimer);
        resolve();
      } else if (state === ConnectionState.DISCONNECTED) {
        // ignore pre-join disconnect noise
      }
    });
    stage.on(StageEvents.ERROR, (err: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(failTimer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
    stage.join().catch((err) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(failTimer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
  return {
    localStream: media,
    setAudioTrack: (track: MediaStreamTrack, muted?: boolean) => {
      if (!track || track.kind !== "audio" || track.readyState !== "live") return;
      if (muted != null) audioMuted = muted;
      if (publishAudio === track) {
        audioLss.setMuted?.(audioMuted);
        return;
      }
      publishAudio = track;
      audioLss = new LocalStageStream(
        track,
        audioConfig,
      ) as LocalStageStreamLike;
      audioLss.setMuted?.(audioMuted);
      try {
        stage.refreshStrategy?.();
      } catch {
        /* strategy refresh is best-effort */
      }
    },
    setAudioMuted: (muted: boolean) => {
      audioMuted = muted;
      audioLss.setMuted?.(muted);
    },
    leave: async () => {
      try {
        await stage.leave();
      } catch {
        /* best-effort */
      }
      silentAudio?.stop();
      guestVideo.clear();
      guestAudioEls.forEach((el) => {
        el.pause();
        el.srcObject = null;
      });
      guestAudioEls.clear();
      opts.onGuestMedia?.({});
      if (!retain) {
        media.getTracks().forEach((t) => t.stop());
      }
      if (opts.videoEl && ownsMedia) opts.videoEl.srcObject = null;
    },
  };
}
