/**
 * Shared phase math + seeded pseudo-random for deterministic Skia particles.
 */

export const PHASE = {
  preloadEnd: 0.04,
  entranceEnd: 0.18,
  impactEnd: 0.28,
  climaxEnd: 0.62,
  gloryEnd: 0.82,
};

/** Smoothstep 0–1 */
export function smoothstep(edge0, edge1, x) {
  'worklet';
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function phaseWeight(t, start, end) {
  'worklet';
  return smoothstep(start, start + (end - start) * 0.35, t) * (1 - smoothstep(end - (end - start) * 0.25, end, t));
}

export function impactPulse(t) {
  'worklet';
  // sharp punch around impact window
  const a = smoothstep(0.17, 0.22, t);
  const b = 1 - smoothstep(0.22, 0.32, t);
  return a * b;
}

export function gloryHold(t) {
  'worklet';
  return smoothstep(0.58, 0.68, t) * (1 - smoothstep(0.88, 0.98, t));
}

export function dismissFade(t) {
  'worklet';
  return 1 - smoothstep(0.82, 1, t);
}

/** Deterministic hash → 0..1 */
export function hash01(i, salt = 1) {
  const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function makeParticles(count, seed = 1) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      i,
      a: hash01(i, seed) * Math.PI * 2,
      r: 0.25 + hash01(i, seed + 2) * 0.75,
      s: 0.5 + hash01(i, seed + 3) * 1.2,
      hue: hash01(i, seed + 4),
      delay: hash01(i, seed + 5) * 0.35,
    });
  }
  return out;
}
