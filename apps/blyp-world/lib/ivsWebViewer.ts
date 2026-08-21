/**
 * Subscribe-only IVS Real-Time join for /live/[id] watchers.
 * Do not use HLS composition here — that copy is what stall-then-jumped
 * while Studio preview (local gum) looked fine.
 */

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
};

export type IvsWebViewerHandle = {
  leave: () => Promise<void>;
};

function isHost(participant: StageParticipantLike): boolean {
  const role = String(participant.attributes?.role || "").toLowerCase();
  const featured = String(participant.attributes?.featured || "").toLowerCase();
  return role === "host" || featured === "true";
}

export async function startIvsWebViewerSubscribe(opts: {
  participantToken: string;
  videoEl: HTMLVideoElement;
  muted: boolean;
  onFirstFrame?: () => void;
}): Promise<IvsWebViewerHandle> {
  if (typeof window === "undefined") {
    throw new Error("IVS Web Broadcast only runs in the browser");
  }
  const ivs = (await import("amazon-ivs-web-broadcast")) as {
    Stage: new (token: string, strategy: unknown) => StageLike;
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
  const { Stage, SubscribeType, StageEvents, ConnectionState } = ivs;

  const videoEl = opts.videoEl;
  videoEl.muted = opts.muted;
  videoEl.playsInline = true;
  videoEl.autoplay = true;

  const media = new MediaStream();
  videoEl.srcObject = media;
  let first = false;
  const markFirst = () => {
    if (first) return;
    if (videoEl.videoWidth > 0 || videoEl.readyState >= 2) {
      first = true;
      opts.onFirstFrame?.();
    }
  };
  videoEl.addEventListener("playing", markFirst);
  videoEl.addEventListener("timeupdate", markFirst);

  const audioByUser = new Map<string, MediaStreamTrack>();
  const videoByUser = new Map<string, MediaStreamTrack>();

  const rebuild = () => {
    const keep = new Set<MediaStreamTrack>();
    const hostVideo =
      [...videoByUser.entries()].find(([id]) => {
        const p = participants.get(id);
        return p ? isHost(p) : false;
      })?.[1] || [...videoByUser.values()][0];
    if (hostVideo) keep.add(hostVideo);
    audioByUser.forEach((t) => keep.add(t));
    media.getTracks().forEach((t) => {
      if (!keep.has(t)) media.removeTrack(t);
    });
    keep.forEach((t) => {
      if (!media.getTracks().includes(t)) media.addTrack(t);
    });
    void videoEl.play().catch(() => undefined);
    markFirst();
  };

  const participants = new Map<string, StageParticipantLike>();
  const pid = (p: StageParticipantLike) =>
    String(p.userId || "").trim() || "unknown";

  const strategy = {
    stageStreamsToPublish: () => [],
    shouldPublishParticipant: () => false,
    shouldSubscribeToParticipant: (participant: StageParticipantLike) =>
      participant.isLocal ? SubscribeType.NONE : SubscribeType.AUDIO_VIDEO,
  };
  const stage = new Stage(opts.participantToken, strategy);

  stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (...args: unknown[]) => {
    const participant = (args[0] || {}) as StageParticipantLike;
    const streams = (args[1] || []) as StageStreamLike[];
    if (participant.isLocal) return;
    const id = pid(participant);
    participants.set(id, participant);
    for (const stream of streams) {
      const track = stream.mediaStreamTrack;
      if (!track || track.readyState !== "live") continue;
      const kind = stream.streamType || track.kind;
      if (kind === "video" || track.kind === "video") videoByUser.set(id, track);
      if (kind === "audio" || track.kind === "audio") audioByUser.set(id, track);
    }
    rebuild();
  });
  stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_REMOVED, (...args: unknown[]) => {
    const participant = (args[0] || {}) as StageParticipantLike;
    const streams = (args[1] || []) as StageStreamLike[];
    const id = pid(participant);
    for (const stream of streams) {
      const kind = stream.streamType || stream.mediaStreamTrack?.kind;
      if (kind === "video") videoByUser.delete(id);
      if (kind === "audio") audioByUser.delete(id);
    }
    rebuild();
  });
  stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (...args: unknown[]) => {
    const id = pid((args[0] || {}) as StageParticipantLike);
    videoByUser.delete(id);
    audioByUser.delete(id);
    participants.delete(id);
    rebuild();
  });

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
    leave: async () => {
      videoEl.removeEventListener("playing", markFirst);
      videoEl.removeEventListener("timeupdate", markFirst);
      try {
        await stage.leave();
      } catch {
        /* best-effort */
      }
      media.getTracks().forEach((t) => {
        try {
          media.removeTrack(t);
        } catch {
          /* ignore */
        }
      });
      videoEl.srcObject = null;
    },
  };
}
