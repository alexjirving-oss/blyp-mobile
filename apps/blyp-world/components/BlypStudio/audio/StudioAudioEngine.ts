/**
 * BlypStudio mix: host hears music/stings locally; mic + beds + stings
 * go out on MediaStreamAudioDestinationNode for IVS publish.
 * Fail-soft — missing Web Audio / autoplay never throws to the director UI.
 */

import { mixDeskAudioTracks } from "@/lib/studioDeskMedia";
import {
  planPublishAudio,
  wantPublishMix as wantMixFromInputs,
} from "@/lib/studioPublishGraph";

export type StingId =
  | "alert"
  | "gift"
  | "applause"
  | "airhorn"
  | "join"
  | "win";
export type MusicBedId = "neon-pulse" | "night-drive" | "gold-room";

export const MUSIC_BEDS: { id: MusicBedId; name: string }[] = [
  { id: "neon-pulse", name: "Neon Pulse" },
  { id: "night-drive", name: "Night Drive" },
  { id: "gold-room", name: "Gold Room" },
];

/** Soundboard pad — hints map to digit hotkeys on Live Studio. */
export const STING_PAD: { id: StingId; name: string; hint: string }[] = [
  { id: "gift", name: "Gift", hint: "1" },
  { id: "join", name: "Join", hint: "2" },
  { id: "win", name: "Win", hint: "3" },
  { id: "alert", name: "Alert", hint: "4" },
  { id: "airhorn", name: "Airhorn", hint: "5" },
  { id: "applause", name: "Applause", hint: "6" },
];

type MixNodes = {
  ctx: AudioContext;
  micGain: GainNode;
  musicGain: GainNode;
  /** Tab/captureStream music — publish only, never speakers (avoids howl). */
  musicPublishGain: GainNode;
  stingGain: GainNode;
  /** Local monitor tap for alerts (cans) — disconnect to avoid double-hear */
  stingMonitor: GainNode;
  dest: MediaStreamAudioDestinationNode;
};

let nodes: MixNodes | null = null;
let micSource: MediaStreamAudioSourceNode | null = null;
let musicEl: HTMLAudioElement | null = null;
let musicElSource: MediaElementAudioSourceNode | null = null;
let musicObjectUrl: string | null = null;
let padOsc: OscillatorNode[] = [];
let padFilters: AudioNode[] = [];
let currentBed: MusicBedId | "file" | null = null;
let musicPlaying = false;
let stingMonitorOn = true;
let extMusicEl: HTMLMediaElement | null = null;
let extMusicSource: MediaElementAudioSourceNode | null = null;
let extMusicStreamSource: MediaStreamAudioSourceNode | null = null;
let mixDestTrackId: string | null = null;
let tabCaptureRouting = false;
let nativeAudioMix: {
  ids: string;
  track: MediaStreamTrack;
  stop: () => void;
} | null = null;
const mixListeners = new Set<(wantMix: boolean) => void>();

function nativeVideoTrack(videoFrom: MediaStream): MediaStreamTrack | null {
  return (
    videoFrom.getVideoTracks().find((t) => {
      if (t.readyState !== "live") return false;
      const settings = t.getSettings?.() ?? {};
      if (settings.deviceId || settings.displaySurface || settings.facingMode) {
        return true;
      }
      const label = t.label || "";
      if (/canvas/i.test(label)) return false;
      return /screen|display|window|web-contents/i.test(label);
    }) ?? null
  );
}

function gumAudioTracks(from: MediaStream | null | undefined): MediaStreamTrack[] {
  return (
    from
      ?.getAudioTracks()
      .filter((t) => t.readyState === "live" && t.id !== mixDestTrackId) ?? []
  );
}

/** IVS publishes one audio LocalStageStream — never drop tab/display as track[1]. */
function mixedGumAudioTrack(
  from: MediaStream | null | undefined,
): MediaStreamTrack | null {
  const tracks = gumAudioTracks(from);
  if (!tracks.length) return null;
  if (tracks.length === 1) {
    if (nativeAudioMix) {
      nativeAudioMix.stop();
      nativeAudioMix = null;
    }
    return tracks[0];
  }
  const ids = tracks
    .map((t) => t.id)
    .sort()
    .join(",");
  if (
    nativeAudioMix &&
    nativeAudioMix.ids === ids &&
    nativeAudioMix.track.readyState === "live"
  ) {
    return nativeAudioMix.track;
  }
  nativeAudioMix?.stop();
  const mixed = mixDeskAudioTracks(tracks);
  nativeAudioMix = { ids, track: mixed.track, stop: mixed.stop };
  return mixed.track;
}

function wantPublishMix(): boolean {
  return wantMixFromInputs({
    localMusicPlaying: musicPlaying,
    tabOrElementMusic: !!(extMusicSource || extMusicStreamSource),
  });
}

function notifyPublishMix() {
  const want = wantPublishMix();
  mixListeners.forEach((fn) => {
    try {
      fn(want);
    } catch {
      /* ignore */
    }
  });
}

/** Tab capture already includes tab Web Audio. Don't also sum local beds into dest. */
function routeMusicForTabCapture(on: boolean) {
  const mix = nodes;
  if (!mix) return;
  if (tabCaptureRouting === on) return;
  tabCaptureRouting = on;
  try {
    mix.musicGain.disconnect();
  } catch {
    /* ignore */
  }
  mix.musicGain.connect(mix.ctx.destination);
  if (!on) mix.musicGain.connect(mix.dest);
}

function createMixContext(): AudioContext | null {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  try {
    return new Ctx({ sampleRate: 48000, latencyHint: "interactive" });
  } catch {
    try {
      return new Ctx();
    } catch {
      return null;
    }
  }
}

function ensure(): MixNodes | null {
  if (typeof window === "undefined") return null;
  if (nodes) {
    if (nodes.ctx.state === "suspended") {
      void nodes.ctx.resume().catch(() => undefined);
    }
    return nodes;
  }
  try {
    const ctx = createMixContext();
    if (!ctx) return null;
    const micGain = ctx.createGain();
    const musicGain = ctx.createGain();
    const musicPublishGain = ctx.createGain();
    const stingGain = ctx.createGain();
    const stingMonitor = ctx.createGain();
    const dest = ctx.createMediaStreamDestination();
    micGain.gain.value = 0.8;
    musicGain.gain.value = 0.45;
    musicPublishGain.gain.value = 0.45;
    stingGain.gain.value = 0.7;
    stingMonitor.gain.value = 1;
    // True silence carrier — empty dest tracks encode as hiss / oscillator junk.
    const silent = ctx.createConstantSource();
    silent.offset.value = 0;
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    silent.connect(silentGain);
    silentGain.connect(dest);
    silent.start();
    // Mic to publish only (avoid speaker echo). Element music to both.
    // CaptureStream / tab audio → dest only (speakers would feed back).
    micGain.connect(dest);
    musicGain.connect(dest);
    musicGain.connect(ctx.destination);
    musicPublishGain.connect(dest);
    stingGain.connect(dest);
    stingGain.connect(stingMonitor);
    stingMonitor.connect(ctx.destination);
    mixDestTrackId = dest.stream.getAudioTracks()[0]?.id ?? null;
    nodes = {
      ctx,
      micGain,
      musicGain,
      musicPublishGain,
      stingGain,
      stingMonitor,
      dest,
    };
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return nodes;
  } catch {
    return null;
  }
}

function stopPad() {
  padOsc.forEach((o) => {
    try {
      o.stop();
      o.disconnect();
    } catch {
      /* ignore */
    }
  });
  padFilters.forEach((n) => {
    try {
      n.disconnect();
    } catch {
      /* ignore */
    }
  });
  padOsc = [];
  padFilters = [];
}

function stopFileMusic() {
  if (musicEl) {
    try {
      musicEl.pause();
      musicEl.src = "";
    } catch {
      /* ignore */
    }
    musicEl = null;
  }
  if (musicElSource) {
    try {
      musicElSource.disconnect();
    } catch {
      /* ignore */
    }
    musicElSource = null;
  }
  if (musicObjectUrl) {
    URL.revokeObjectURL(musicObjectUrl);
    musicObjectUrl = null;
  }
}

function startPad(bed: MusicBedId) {
  const mix = ensure();
  if (!mix) return;
  stopPad();
  const { ctx, musicGain } = mix;
  const now = ctx.currentTime;
  const specs: { freq: number; type: OscillatorType; gain: number }[] =
    bed === "neon-pulse"
      ? [
          { freq: 110, type: "sawtooth", gain: 0.045 },
          { freq: 164.81, type: "square", gain: 0.02 },
          { freq: 329.63, type: "triangle", gain: 0.018 },
        ]
      : bed === "night-drive"
        ? [
            { freq: 87.31, type: "sine", gain: 0.06 },
            { freq: 130.81, type: "triangle", gain: 0.03 },
            { freq: 196, type: "sine", gain: 0.02 },
          ]
        : [
            { freq: 98, type: "triangle", gain: 0.05 },
            { freq: 146.83, type: "sine", gain: 0.028 },
            { freq: 220, type: "triangle", gain: 0.016 },
          ];

  for (const spec of specs) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, now);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(bed === "night-drive" ? 900 : 1400, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(spec.gain, now + 0.4);
    osc.connect(filter);
    filter.connect(g);
    g.connect(musicGain);
    osc.start(now);
    padOsc.push(osc);
    padFilters.push(filter, g);
  }
}

function beep(
  opts: {
    freq: number;
    duration: number;
    type?: OscillatorType;
    gain?: number;
    slideTo?: number;
  },
  dest: AudioNode,
  ctx: AudioContext,
) {
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = opts.type ?? "square";
  osc.frequency.setValueAtTime(opts.freq, now);
  if (opts.slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.slideTo),
      now + opts.duration,
    );
  }
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.08, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
  osc.connect(g);
  g.connect(dest);
  osc.start(now);
  osc.stop(now + opts.duration + 0.02);
}

function noiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  duration: number,
  gain: number,
) {
  const samples = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) {
    const env = 1 - i / samples;
    data[i] = (Math.random() * 2 - 1) * env * env;
  }
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  g.gain.value = gain;
  src.connect(filter);
  filter.connect(g);
  g.connect(dest);
  src.start();
}

export const studioAudio = {
  attachMic(stream: MediaStream | null) {
    const mix = ensure();
    if (!mix) return;
    try {
      micSource?.disconnect();
      micSource = null;
      const micTracks =
        stream
          ?.getAudioTracks()
          .filter(
            (t) =>
              t.readyState === "live" &&
              t.id !== mixDestTrackId,
          ) ?? [];
      if (!micTracks.length) return;
      // Never feed the mix destination back into itself (oscillator / howl).
      micSource = mix.ctx.createMediaStreamSource(new MediaStream(micTracks));
      micSource.connect(mix.micGain);
    } catch {
      micSource = null;
    }
  },

  setMicVolume(unit: number) {
    const mix = ensure();
    if (!mix) return;
    mix.micGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, unit)),
      mix.ctx.currentTime,
      0.03,
    );
  },

  setMusicVolume(unit: number) {
    const mix = ensure();
    if (!mix) return;
    const v = Math.max(0, Math.min(1, unit));
    mix.musicGain.gain.setTargetAtTime(v, mix.ctx.currentTime, 0.03);
    mix.musicPublishGain.gain.setTargetAtTime(v, mix.ctx.currentTime, 0.03);
  },

  setStingVolume(unit: number) {
    const mix = ensure();
    if (!mix) return;
    mix.stingGain.gain.setTargetAtTime(
      Math.max(0, Math.min(1, unit)),
      mix.ctx.currentTime,
      0.03,
    );
  },

  /**
   * Hear alerts in local speakers/headphones without changing publish bus.
   * When off, stings still go out on the mix stream.
   */
  setStingMonitorEnabled(on: boolean) {
    stingMonitorOn = on;
    const mix = ensure();
    if (!mix) return;
    mix.stingMonitor.gain.setTargetAtTime(
      on ? 1 : 0,
      mix.ctx.currentTime,
      0.03,
    );
  },

  isStingMonitorEnabled() {
    return stingMonitorOn;
  },

  getMixStream(): MediaStream | null {
    return ensure()?.dest.stream ?? null;
  },

  hasMusicInput(): boolean {
    return !!(extMusicSource || extMusicStreamSource);
  },

  shouldPublishMix(): boolean {
    return wantPublishMix();
  },

  subscribePublishMix(cb: (wantMix: boolean) => void): () => void {
    mixListeners.add(cb);
    return () => {
      mixListeners.delete(cb);
    };
  },

  mixAudioTrack(): MediaStreamTrack | null {
    return (
      this.getMixStream()
        ?.getAudioTracks()
        .find((t) => t.readyState === "live") ?? null
    );
  },

  nativeAudioTrack(from: MediaStream | null | undefined): MediaStreamTrack | null {
    return mixedGumAudioTrack(from);
  },

  /**
   * Camera/screen + getUserMedia mic. Same capture clock — no Web Audio dest.
   * Use this unless a bed/file/tab-share is actually on the mix.
   */
  buildNativePublishStream(
    videoFrom: MediaStream,
    micFrom?: MediaStream | null,
  ): MediaStream | null {
    this.attachMic(micFrom ?? videoFrom);
    const video = nativeVideoTrack(videoFrom);
    if (!video) return null;
    const out = new MediaStream([video]);
    const audio = mixedGumAudioTrack(micFrom ?? videoFrom);
    if (audio) out.addTrack(audio);
    return out;
  },

  /**
   * Stage publish: camera/screen video + mix audio (mic + jukebox).
   * Only uses the Web Audio dest when music is actually attached/playing.
   * Never put canvas capture on this stream.
   */
  buildPublishStream(
    videoFrom: MediaStream,
    micFrom?: MediaStream | null,
  ): MediaStream | null {
    this.attachMic(micFrom ?? videoFrom);
    const mix = ensure();
    if (mix?.ctx.state === "suspended") {
      void mix.ctx.resume().catch(() => undefined);
    }
    const video = nativeVideoTrack(videoFrom);
    if (!video) return null;
    const out = new MediaStream([video]);
    const mixAudio = this.mixAudioTrack();
    const gum = gumAudioTracks(micFrom ?? videoFrom);
    const source = planPublishAudio({
      wantMix: wantPublishMix(),
      mixTrackLive: !!mixAudio,
      gumTrackLive: gum.length > 0,
    });
    if (source === "mix" && mixAudio) {
      mixAudio.enabled = true;
      out.addTrack(mixAudio);
    } else {
      const audio = mixedGumAudioTrack(micFrom ?? videoFrom);
      if (audio) out.addTrack(audio);
    }
    return out;
  },

  isMusicPlaying() {
    return musicPlaying;
  },

  currentBed() {
    return currentBed;
  },

  async playBed(id: MusicBedId) {
    const mix = ensure();
    if (!mix) return false;
    try {
      stopFileMusic();
      startPad(id);
      currentBed = id;
      musicPlaying = true;
      notifyPublishMix();
      return true;
    } catch {
      return false;
    }
  },

  async playFile(file: File) {
    const mix = ensure();
    if (!mix) return false;
    try {
      stopPad();
      stopFileMusic();
      const url = URL.createObjectURL(file);
      musicObjectUrl = url;
      const el = new Audio(url);
      el.loop = true;
      el.crossOrigin = "anonymous";
      musicElSource = mix.ctx.createMediaElementSource(el);
      musicElSource.connect(mix.musicGain);
      musicEl = el;
      await el.play();
      currentBed = "file";
      musicPlaying = true;
      notifyPublishMix();
      return true;
    } catch {
      stopFileMusic();
      musicPlaying = false;
      currentBed = null;
      return false;
    }
  },

  stopMusic() {
    stopPad();
    stopFileMusic();
    musicPlaying = false;
    currentBed = null;
    notifyPublishMix();
  },

  /**
   * Route an existing media element (Spotify SDK / file) onto the music bus.
   * createMediaElementSource can run once per element; fail-soft if CORS/EME blocks.
   */
  attachMusicElement(el: HTMLMediaElement | null) {
    const mix = ensure();
    if (!mix || !el) return false;
    if (extMusicEl === el && extMusicSource) return true;
    try {
      if (extMusicSource) {
        extMusicSource.disconnect();
        extMusicSource = null;
      }
      extMusicEl = el;
      extMusicSource = mix.ctx.createMediaElementSource(el);
      extMusicSource.connect(mix.musicGain);
      notifyPublishMix();
      return true;
    } catch {
      extMusicSource = null;
      return false;
    }
  },

  attachMusicStream(stream: MediaStream | null) {
    const mix = ensure();
    if (!mix || !stream?.getAudioTracks().some((t) => t.readyState === "live")) {
      return false;
    }
    try {
      if (extMusicStreamSource) {
        extMusicStreamSource.disconnect();
        extMusicStreamSource = null;
      }
      extMusicStreamSource = mix.ctx.createMediaStreamSource(stream);
      extMusicStreamSource.connect(mix.musicPublishGain);
      routeMusicForTabCapture(true);
      notifyPublishMix();
      return true;
    } catch {
      extMusicStreamSource = null;
      return false;
    }
  },

  attachMusicCapture(el: HTMLMediaElement | null) {
    if (!el) return false;
    if (this.attachMusicElement(el)) return true;
    try {
      const cap = (
        el as HTMLMediaElement & { captureStream?: () => MediaStream }
      ).captureStream?.();
      if (cap?.getAudioTracks().some((t) => t.readyState === "live")) {
        return this.attachMusicStream(cap);
      }
    } catch {
      /* CORS / EME */
    }
    return false;
  },

  detachMusicElement() {
    if (extMusicSource) {
      try {
        extMusicSource.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (extMusicStreamSource) {
      try {
        extMusicStreamSource.disconnect();
      } catch {
        /* ignore */
      }
    }
    extMusicSource = null;
    extMusicStreamSource = null;
    extMusicEl = null;
    routeMusicForTabCapture(false);
    notifyPublishMix();
  },

  playSting(id: StingId) {
    const mix = ensure();
    if (!mix) return;
    const { ctx, stingGain } = mix;
    try {
      if (id === "alert") {
        beep({ freq: 880, duration: 0.12, type: "square", gain: 0.09 }, stingGain, ctx);
        window.setTimeout(() => {
          beep({ freq: 1174, duration: 0.14, type: "square", gain: 0.08 }, stingGain, ctx);
        }, 90);
        return;
      }
      if (id === "gift") {
        beep({ freq: 520, duration: 0.08, type: "triangle", gain: 0.08 }, stingGain, ctx);
        window.setTimeout(() => {
          beep({ freq: 780, duration: 0.1, type: "triangle", gain: 0.07 }, stingGain, ctx);
        }, 70);
        return;
      }
      if (id === "join") {
        beep({ freq: 440, duration: 0.07, type: "sine", gain: 0.07 }, stingGain, ctx);
        window.setTimeout(() => {
          beep({ freq: 660, duration: 0.09, type: "sine", gain: 0.08 }, stingGain, ctx);
        }, 60);
        window.setTimeout(() => {
          beep({ freq: 880, duration: 0.12, type: "triangle", gain: 0.07 }, stingGain, ctx);
        }, 130);
        return;
      }
      if (id === "win" || id === "applause") {
        noiseBurst(ctx, stingGain, 0.85, 0.22);
        window.setTimeout(() => noiseBurst(ctx, stingGain, 0.55, 0.14), 120);
        if (id === "win") {
          window.setTimeout(() => {
            beep(
              { freq: 523, duration: 0.12, type: "triangle", gain: 0.08 },
              stingGain,
              ctx,
            );
            beep(
              { freq: 784, duration: 0.18, type: "triangle", gain: 0.07 },
              stingGain,
              ctx,
            );
          }, 180);
        }
        return;
      }
      beep(
        { freq: 280, duration: 0.55, type: "sawtooth", gain: 0.12, slideTo: 90 },
        stingGain,
        ctx,
      );
    } catch {
      /* fail soft */
    }
  },

  /** One-shot custom sound through the sting bus (does not replace music). */
  async playCustomSting(file: File) {
    const mix = ensure();
    if (!mix) return false;
    try {
      const url = URL.createObjectURL(file);
      const el = new Audio(url);
      el.crossOrigin = "anonymous";
      const src = mix.ctx.createMediaElementSource(el);
      src.connect(mix.stingGain);
      await el.play();
      el.addEventListener(
        "ended",
        () => {
          try {
            src.disconnect();
          } catch {
            /* ignore */
          }
          URL.revokeObjectURL(url);
        },
        { once: true },
      );
      return true;
    } catch {
      return false;
    }
  },

  playRouletteTick() {
    const mix = ensure();
    if (!mix) return;
    beep({ freq: 880, duration: 0.04, type: "square", gain: 0.05 }, mix.stingGain, mix.ctx);
  },

  playSpotlightSurge() {
    const mix = ensure();
    if (!mix) return;
    beep(
      { freq: 220, duration: 0.35, type: "sawtooth", gain: 0.07, slideTo: 660 },
      mix.stingGain,
      mix.ctx,
    );
  },

  playGiftDrop() {
    this.playSting("gift");
  },

  /** Whoosh + boom for bomb-strike FX (file SFX + procedural fallback). */
  playBombBoom() {
    const mix = ensure();
    if (!mix) return;
    try {
      // Procedural whoosh into thud (always available).
      beep(
        {
          freq: 420,
          duration: 0.28,
          type: "sawtooth",
          gain: 0.06,
          slideTo: 90,
        },
        mix.stingGain,
        mix.ctx,
      );
      window.setTimeout(() => {
        noiseBurst(mix.ctx, mix.stingGain, 0.95, 0.28);
        beep(
          { freq: 90, duration: 0.22, type: "sawtooth", gain: 0.14, slideTo: 40 },
          mix.stingGain,
          mix.ctx,
        );
        window.setTimeout(() => {
          noiseBurst(mix.ctx, mix.stingGain, 0.45, 0.18);
        }, 90);
      }, 120);

      // Sampled sting (silent source MP4) — honors stingGain / mute-via-zero.
      const el = new Audio("/studio/fx/nukemonkey-strike.mp3");
      el.crossOrigin = "anonymous";
      el.volume = 0.9;
      const src = mix.ctx.createMediaElementSource(el);
      src.connect(mix.stingGain);
      void el.play().catch(() => undefined);
      el.addEventListener(
        "ended",
        () => {
          try {
            src.disconnect();
          } catch {
            /* ignore */
          }
        },
        { once: true },
      );
    } catch {
      /* fail soft */
    }
  },
};
