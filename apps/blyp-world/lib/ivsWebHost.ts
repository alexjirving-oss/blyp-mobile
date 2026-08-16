/**
 * IVS Real-Time host publish for desktop Chrome/Edge.
 * Uses amazon-ivs-web-broadcast Stage + LocalStageStream with the hostToken
 * returned from POST /api/live/start.
 *
 * Optional `mediaStream` lets BlypStudio publish a Clean Feed composite
 * instead of opening a second getUserMedia. LiveStudioClient omits it and
 * keeps the original camera path.
 */

export type IvsHostPublishHandle = {
  localStream: MediaStream;
  leave: () => Promise<void>;
};

type StageLike = {
  join: () => Promise<void>;
  leave: () => Promise<void> | void;
  on: (event: string | number, cb: (...args: unknown[]) => void) => void;
};

export async function startIvsWebHostPublish(opts: {
  participantToken: string;
  videoEl?: HTMLVideoElement | null;
  /**
   * Prebuilt MediaStream (e.g. BlypStudio Clean Feed canvas + mic).
   * When omitted, opens getUserMedia like the original Live Studio path.
   */
  mediaStream?: MediaStream | null;
  /**
   * When true, leave() does not stop media tracks (shared preview / canvas).
   * Defaults to true when mediaStream is provided, false otherwise.
   */
  retainMediaOnLeave?: boolean;
}): Promise<IvsHostPublishHandle> {
  if (typeof window === "undefined") {
    throw new Error("IVS Web Broadcast only runs in the browser");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ivs: any = await import("amazon-ivs-web-broadcast");
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
  const videoTrack = media.getVideoTracks()[0];
  if (!audioTrack || !videoTrack) {
    if (ownsMedia) media.getTracks().forEach((t) => t.stop());
    throw new Error("Camera or microphone track missing");
  }

  const localStreams = [
    new LocalStageStream(audioTrack),
    new LocalStageStream(videoTrack),
  ];

  const strategy = {
    stageStreamsToPublish: () => localStreams,
    shouldPublishParticipant: () => true,
    shouldSubscribeToParticipant: () => SubscribeType.NONE,
  };

  const stage = new Stage(opts.participantToken, strategy) as StageLike;

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
    leave: async () => {
      try {
        await stage.leave();
      } catch {
        /* best-effort */
      }
      if (!retain) {
        media.getTracks().forEach((t) => t.stop());
      }
      if (opts.videoEl && ownsMedia) opts.videoEl.srcObject = null;
    },
  };
}
