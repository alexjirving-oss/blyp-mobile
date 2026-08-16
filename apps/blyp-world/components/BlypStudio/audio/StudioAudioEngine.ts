/**
 * Lightweight Web Audio stubs for BlypStudio (no asset files).
 * Synthetic beeps only — Phase 4 polish.
 */

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

function beep(opts: {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  slideTo?: number;
}) {
  const audio = ac();
  if (!audio) return;
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const g = audio.createGain();
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
  g.connect(audio.destination);
  osc.start(now);
  osc.stop(now + opts.duration + 0.02);
}

export const studioAudio = {
  playRouletteTick() {
    beep({ freq: 880, duration: 0.04, type: "square", gain: 0.05 });
  },
  playSpotlightSurge() {
    beep({
      freq: 220,
      duration: 0.35,
      type: "sawtooth",
      gain: 0.07,
      slideTo: 660,
    });
  },
  playGiftDrop() {
    beep({ freq: 520, duration: 0.08, type: "triangle", gain: 0.06 });
    window.setTimeout(() => {
      beep({ freq: 780, duration: 0.1, type: "triangle", gain: 0.05 });
    }, 70);
  },
};
