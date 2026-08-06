/**
 * True-motion gift cinema renderer.
 * Draws a character/prop RIG every frame (30fps) with anticipation, arcs,
 * squash/stretch, follow-through, and particle systems — then ffmpeg → H.264.
 *
 * NOT Ken Burns / zoompan / xfade slideshow.
 */
import { createCanvas } from '@napi-rs/canvas';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const STORY = path.join(REPO, 'assets/gifts/cinema/storyboards');
const OUT_CLIPS = path.join(REPO, 'assets/gifts/cinema/clips');
const WORK = path.join(__dirname, '_frames');

const W = 1280;
const H = 720;
const FPS = 30;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInCubic = (t) => t ** 3;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const hash01 = (i, salt = 1) => {
  const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

function oval(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function glow(ctx, x, y, r, color, a = 0.5) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('ALPHA', String(a)));
  g.addColorStop(1, color.replace('ALPHA', '0'));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Fully procedural cinema stage — no still plates (avoids slideshow ghosts). */
function drawCinemaStage(ctx, t, palette) {
  const [c0, c1, c2] = palette;
  const g = ctx.createRadialGradient(
    W * (0.45 + Math.sin(t * Math.PI * 2) * 0.04),
    H * (0.55 + Math.cos(t * Math.PI * 1.5) * 0.03),
    40,
    W * 0.5,
    H * 0.55,
    H * 0.85
  );
  g.addColorStop(0, c0);
  g.addColorStop(0.45, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // drifting light shafts
  ctx.save();
  ctx.globalAlpha = 0.08 + 0.04 * Math.sin(t * 8);
  for (let i = 0; i < 5; i += 1) {
    const x = W * (0.15 + i * 0.18) + Math.sin(t * 3 + i) * 30;
    const lg = ctx.createLinearGradient(x, 0, x + 80, H);
    lg.addColorStop(0, 'rgba(255,255,255,0.35)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 70, 0);
    ctx.lineTo(x + 140, H);
    ctx.lineTo(x + 40, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const v = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.12, W / 2, H * 0.5, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

function drawEyes(ctx, x, y, scale, blink, lookX = 0, lookY = 0, iris = '#3B82F6') {
  const eyeY = y;
  const spacing = 22 * scale;
  const open = 1 - blink;
  const rx = 13 * scale;
  const ry = 15 * scale * Math.max(0.08, open);
  for (const side of [-1, 1]) {
    const ex = x + side * spacing;
    ctx.fillStyle = '#F8FAFC';
    oval(ctx, ex, eyeY, rx, ry);
    ctx.fill();
    if (open > 0.15) {
      ctx.fillStyle = iris;
      oval(ctx, ex + lookX * 4 * scale, eyeY + lookY * 3 * scale, 6.5 * scale, 7.5 * scale * open);
      ctx.fill();
      ctx.fillStyle = '#0B1220';
      oval(ctx, ex + lookX * 4 * scale, eyeY + lookY * 3 * scale, 3.2 * scale, 3.8 * scale * open);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      oval(ctx, ex - 3 * scale + lookX, eyeY - 4 * scale + lookY, 2.2 * scale, 2.4 * scale * open);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(15,23,42,0.35)';
    ctx.lineWidth = 1.5 * scale;
    oval(ctx, ex, eyeY, rx, ry);
    ctx.stroke();
  }
  // smile
  ctx.strokeStyle = 'rgba(30,41,59,0.55)';
  ctx.lineWidth = 2.2 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y + 18 * scale, 10 * scale, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
}

function particles(ctx, t, count, originX, originY, opts = {}) {
  const {
    speed = 220,
    life = 0.9,
    size = 4,
    colors = ['#FDBA74', '#F97316', '#FDE68A'],
    upward = -1,
    spread = Math.PI * 0.7,
    baseAngle = -Math.PI / 2,
  } = opts;
  for (let i = 0; i < count; i += 1) {
    const seed = hash01(i, 9);
    const cycle = ((t * (0.7 + seed) + seed) % 1);
    if (cycle > life) continue;
    const a = baseAngle + (seed - 0.5) * spread;
    const dist = cycle * speed * (0.55 + hash01(i, 3));
    const x = originX + Math.cos(a) * dist * (1.1 - cycle * 0.3);
    const y = originY + Math.sin(a) * dist * upward + cycle * cycle * 40 * (upward < 0 ? 1 : -0.2);
    const s = size * (1 - cycle) * (0.6 + hash01(i, 4));
    ctx.globalAlpha = (1 - cycle) * 0.85;
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function stars(ctx, t, count = 40) {
  for (let i = 0; i < count; i += 1) {
    const x = hash01(i, 1) * W;
    const y = (hash01(i, 2) * H + t * (40 + hash01(i, 3) * 120)) % H;
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 18 + i));
    ctx.fillStyle = `rgba(226,232,240,${0.25 + tw * 0.55})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + hash01(i, 4) * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ───────────────── ROCKET ───────────────── */
function drawRocket(ctx, _plates, t) {
  // beat: anticipate (0-0.22) → ignition (0.22-0.38) → ascent (0.38-0.78) → glory (0.78-1)
  drawCinemaStage(ctx, t, ['#1e3a5f', '#0b1220', '#020617']);
  stars(ctx, t, 48);
  // launch pad ground
  const padY = H * 0.78;
  ctx.fillStyle = 'rgba(30,41,59,0.85)';
  ctx.beginPath();
  ctx.ellipse(W * 0.48, padY, 160, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const anticipate = 1 - smoothstep(0.18, 0.28, t);
  const lift = easeInCubic(smoothstep(0.24, 0.78, t));
  const squash = anticipate * (0.08 * Math.sin(t * Math.PI * 10)) + (1 - anticipate) * 0;
  const stretch = smoothstep(0.28, 0.55, t) * 0.18 * (1 - smoothstep(0.7, 0.9, t));
  const wobble = Math.sin(t * Math.PI * 14) * (1 - lift) * 0.06 + Math.sin(t * 22) * lift * 0.03;
  const landY = H * 0.62;
  const flyY = H * -0.15;
  const y = lerp(landY, flyY, lift) + anticipate * Math.sin(t * 40) * 3;
  const x = W * 0.48 + Math.sin(t * Math.PI * 2) * 12 + wobble * 40;
  const scale = 1.05 + stretch * 0.15 - squash * 0.12 + smoothstep(0.78, 0.95, t) * 0.08;
  const sx = scale * (1 - stretch * 0.35 + squash * 0.25);
  const sy = scale * (1 + stretch * 0.55 - squash * 0.2);
  const rot = wobble + lift * -0.08;

  // pad glow / ignition bloom
  const ignite = smoothstep(0.2, 0.32, t) * (1 - smoothstep(0.55, 0.85, t));
  glow(ctx, x, landY + 40, 180, 'rgba(251,146,60,ALPHA)', 0.35 * ignite + 0.1);
  glow(ctx, x, y, 220, 'rgba(56,189,248,ALPHA)', 0.2 * smoothstep(0.3, 0.7, t));

  // exhaust plume (continuous flicker)
  if (t > 0.2) {
    const plume = smoothstep(0.2, 0.3, t) * (1 - smoothstep(0.85, 0.98, t));
    ctx.save();
    ctx.translate(x, y + 70 * sy);
    ctx.globalAlpha = 0.55 * plume;
    for (let i = 0; i < 7; i += 1) {
      const flick = 0.7 + 0.3 * Math.sin(t * 50 + i * 1.7);
      const h = (70 + i * 28) * plume * flick;
      const w = (28 - i * 2.5) * flick;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(254,249,195,0.95)');
      g.addColorStop(0.35, 'rgba(251,146,60,0.85)');
      g.addColorStop(1, 'rgba(239,68,68,0)');
      ctx.fillStyle = g;
      oval(ctx, Math.sin(t * 40 + i) * 4, h * 0.45, w, h * 0.55);
      ctx.fill();
    }
    ctx.restore();
    particles(ctx, t * 1.4, 48, x, y + 55 * sy, {
      speed: 260 + lift * 180,
      colors: ['#FEF3C7', '#FB923C', '#F97316', '#38BDF8'],
      upward: 1,
      baseAngle: Math.PI / 2,
      spread: 0.9,
      size: 5,
    });
  }

  // rocket body
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(sx, sy);

  // fins
  ctx.fillStyle = '#DC2626';
  ctx.beginPath();
  ctx.moveTo(-22, 28);
  ctx.lineTo(-48, 62);
  ctx.lineTo(-16, 52);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(22, 28);
  ctx.lineTo(48, 62);
  ctx.lineTo(16, 52);
  ctx.closePath();
  ctx.fill();

  // body
  const body = ctx.createLinearGradient(-40, -70, 40, 70);
  body.addColorStop(0, '#F8FAFC');
  body.addColorStop(0.45, '#E2E8F0');
  body.addColorStop(1, '#94A3B8');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -78);
  ctx.bezierCurveTo(34, -40, 30, 20, 22, 58);
  ctx.lineTo(-22, 58);
  ctx.bezierCurveTo(-30, 20, -34, -40, 0, -78);
  ctx.closePath();
  ctx.fill();

  // nose
  const nose = ctx.createLinearGradient(0, -78, 0, -40);
  nose.addColorStop(0, '#EF4444');
  nose.addColorStop(1, '#B91C1C');
  ctx.fillStyle = nose;
  ctx.beginPath();
  ctx.moveTo(0, -78);
  ctx.bezierCurveTo(22, -58, 20, -42, 0, -38);
  ctx.bezierCurveTo(-20, -42, -22, -58, 0, -78);
  ctx.closePath();
  ctx.fill();

  // window
  glow(ctx, 0, -8, 28, 'rgba(56,189,248,ALPHA)', 0.45);
  ctx.fillStyle = '#0EA5E9';
  oval(ctx, 0, -8, 14, 14);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  oval(ctx, -4, -12, 5, 5);
  ctx.fill();

  const blink = smoothstep(0.08, 0.1, t) * (1 - smoothstep(0.1, 0.12, t))
    + smoothstep(0.48, 0.5, t) * (1 - smoothstep(0.5, 0.52, t));
  drawEyes(ctx, 0, 10, 1.05, blink, Math.sin(t * 6) * 0.4, -0.2 + lift * 0.5);

  // landing legs tuck
  const leg = 1 - smoothstep(0.25, 0.4, t);
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, 55);
  ctx.lineTo(-28 * leg - 8, 78 * leg + 55 * (1 - leg));
  ctx.moveTo(16, 55);
  ctx.lineTo(28 * leg + 8, 78 * leg + 55 * (1 - leg));
  ctx.moveTo(0, 58);
  ctx.lineTo(0, 80 * leg + 58 * (1 - leg));
  ctx.stroke();

  ctx.restore();

  // sonic ring on ignition
  const ringT = smoothstep(0.26, 0.45, t);
  if (ringT > 0 && ringT < 1) {
    ctx.strokeStyle = `rgba(125,211,252,${(1 - ringT) * 0.7})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, landY + 10, 40 + ringT * 160, 0, Math.PI * 2);
    ctx.stroke();
  }

  // glory stars burst
  if (t > 0.75) {
    const g = smoothstep(0.75, 0.9, t);
    glow(ctx, W * 0.5, H * 0.28, 260, 'rgba(253,224,71,ALPHA)', 0.35 * g);
    particles(ctx, (t - 0.75) * 2, 60, W * 0.5, H * 0.3, {
      speed: 320,
      colors: ['#FDE68A', '#F8FAFC', '#7DD3FC'],
      upward: -1,
      size: 3.5,
    });
  }
}

/* ───────────────── CROWN ───────────────── */
function drawCrown(ctx, _plates, t) {
  drawCinemaStage(ctx, t, ['#4c1d95', '#1e1b4b', '#020617']);
  stars(ctx, t * 0.6, 36);

  const drop = easeOutCubic(smoothstep(0.05, 0.45, t));
  const settle = smoothstep(0.45, 0.65, t);
  const bounce = Math.sin(smoothstep(0.42, 0.62, t) * Math.PI) * 18 * (1 - settle);
  const y = lerp(-80, H * 0.42, drop) + bounce;
  const x = W * 0.5 + Math.sin(t * Math.PI * 3) * 10 * (1 - settle);
  const rot = (1 - drop) * 0.35 + Math.sin(t * 10) * 0.04 * (1 - settle);
  const scale = lerp(0.75, 1.15, drop) * (1 + Math.sin(t * 8) * 0.02);
  const squash = Math.sin(smoothstep(0.4, 0.55, t) * Math.PI) * 0.12;

  glow(ctx, x, y + 20, 200, 'rgba(250,204,21,ALPHA)', 0.25 + settle * 0.35);
  // floating jewels trail
  particles(ctx, t, 36, x, y - 10, {
    speed: 90,
    colors: ['#FDE68A', '#F472B6', '#67E8F9', '#C4B5FD'],
    size: 3,
    upward: -1,
    spread: Math.PI * 1.6,
  });

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale * (1 + squash), scale * (1 - squash));

  // band
  const gold = ctx.createLinearGradient(-90, -40, 90, 50);
  gold.addColorStop(0, '#FDE68A');
  gold.addColorStop(0.5, '#F59E0B');
  gold.addColorStop(1, '#B45309');
  ctx.fillStyle = gold;
  ctx.beginPath();
  ctx.moveTo(-88, 18);
  ctx.quadraticCurveTo(0, 48, 88, 18);
  ctx.lineTo(78, -8);
  ctx.quadraticCurveTo(0, 12, -78, -8);
  ctx.closePath();
  ctx.fill();

  // points
  const tips = [-60, -30, 0, 30, 60];
  tips.forEach((tx, i) => {
    const bob = Math.sin(t * 14 + i) * 4;
    ctx.fillStyle = gold;
    ctx.beginPath();
    ctx.moveTo(tx - 16, -6);
    ctx.lineTo(tx, -58 - (i === 2 ? 18 : 0) + bob);
    ctx.lineTo(tx + 16, -6);
    ctx.closePath();
    ctx.fill();
    // jewel
    const jc = ['#EF4444', '#22D3EE', '#A855F7', '#22D3EE', '#EF4444'][i];
    ctx.fillStyle = jc;
    oval(ctx, tx, -28 - (i === 2 ? 10 : 0) + bob * 0.5, 7, 9);
    ctx.fill();
    glow(ctx, tx, -28, 18, jc.replace('#', 'rgba(').length ? `rgba(255,255,255,ALPHA)` : 'rgba(255,255,255,ALPHA)', 0.25);
  });

  // face on band
  const blink = smoothstep(0.3, 0.32, t) * (1 - smoothstep(0.32, 0.34, t));
  drawEyes(ctx, 0, 8, 1.1, blink, Math.sin(t * 5) * 0.3, 0.1, '#7C3AED');

  ctx.restore();

  // stage crown flash
  if (t > 0.55) {
    const g = smoothstep(0.55, 0.8, t);
    glow(ctx, W / 2, H * 0.72, 280, 'rgba(253,224,71,ALPHA)', 0.4 * g);
    ctx.strokeStyle = `rgba(253,224,71,${0.5 * g})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.72, 40 + g * 120 + Math.sin(t * 20) * 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

/* ───────────────── DIAMOND ───────────────── */
function drawDiamond(ctx, _plates, t) {
  drawCinemaStage(ctx, t, ['#0e7490', '#164e63', '#020617']);
  stars(ctx, t * 0.8, 40);

  const reveal = easeOutCubic(smoothstep(0, 0.28, t));
  const spin = t * Math.PI * 4.2 + easeInOut(smoothstep(0.25, 0.75, t)) * Math.PI * 2;
  const danceY = Math.sin(t * Math.PI * 6) * 28 * smoothstep(0.2, 0.4, t) * (1 - smoothstep(0.8, 1, t));
  const x = W * 0.5 + Math.sin(t * Math.PI * 3) * 40 * smoothstep(0.25, 0.55, t);
  const y = H * 0.48 + danceY - (1 - reveal) * 80;
  const scale = lerp(0.4, 1.2, reveal) * (1 + Math.sin(t * 12) * 0.04);
  const squash = Math.sin(t * Math.PI * 8) * 0.08;

  glow(ctx, x, y, 220, 'rgba(125,211,252,ALPHA)', 0.25 + smoothstep(0.6, 0.9, t) * 0.35);
  glow(ctx, x, y, 120, 'rgba(244,114,182,ALPHA)', 0.2 * (0.5 + 0.5 * Math.sin(t * 16)));

  // orbiting sparkles — continuous
  for (let i = 0; i < 18; i += 1) {
    const a = spin + (i / 18) * Math.PI * 2;
    const r = 90 + Math.sin(t * 10 + i) * 18;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r * 0.55;
    ctx.fillStyle = `rgba(248,250,252,${0.4 + 0.5 * Math.sin(t * 20 + i)})`;
    ctx.beginPath();
    ctx.arc(px, py, 2.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 5) * 0.12 + spin * 0.08);
  ctx.scale(scale * (1 + squash), scale * (1 - squash));

  // diamond facets
  const facets = [
    { pts: [[0, -70], [55, -10], [0, 10], [-55, -10]], c: '#E0F2FE' },
    { pts: [[0, 10], [55, -10], [40, 70], [0, 90]], c: '#7DD3FC' },
    { pts: [[0, 10], [-55, -10], [-40, 70], [0, 90]], c: '#38BDF8' },
    { pts: [[0, -70], [55, -10], [40, -40]], c: '#F0F9FF' },
    { pts: [[0, -70], [-55, -10], [-40, -40]], c: '#BAE6FD' },
  ];
  for (const f of facets) {
    const g = ctx.createLinearGradient(0, -70, 0, 90);
    g.addColorStop(0, f.c);
    g.addColorStop(1, '#0284C7');
    ctx.fillStyle = g;
    ctx.beginPath();
    f.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
  }
  // shimmer sweep
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const sh = ((t * 1.8) % 1);
  const sg = ctx.createLinearGradient(-80 + sh * 160, -80, -20 + sh * 160, 80);
  sg.addColorStop(0, 'rgba(255,255,255,0)');
  sg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(0, -70);
  ctx.lineTo(55, -10);
  ctx.lineTo(40, 70);
  ctx.lineTo(0, 90);
  ctx.lineTo(-40, 70);
  ctx.lineTo(-55, -10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const blink = smoothstep(0.22, 0.24, t) * (1 - smoothstep(0.24, 0.26, t));
  drawEyes(ctx, 0, 5, 1.0, blink, Math.cos(t * 8) * 0.5, Math.sin(t * 6) * 0.3, '#06B6D4');

  ctx.restore();

  if (t > 0.7) {
    const g = smoothstep(0.7, 0.9, t);
    particles(ctx, (t - 0.7) * 2.2, 70, x, y, {
      speed: 280,
      colors: ['#E0F2FE', '#F9A8D4', '#FDE68A', '#67E8F9'],
      size: 4,
      spread: Math.PI * 2,
      baseAngle: 0,
      upward: 0,
    });
    // fix upward 0 particles — redraw radial burst
    for (let i = 0; i < 50; i += 1) {
      const seed = hash01(i, 11);
      const cycle = ((t - 0.7) * 2.5 + seed) % 1;
      const a = seed * Math.PI * 2;
      const dist = cycle * 280 * g;
      ctx.globalAlpha = (1 - cycle) * 0.8 * g;
      ctx.fillStyle = ['#E0F2FE', '#F9A8D4', '#FDE68A'][i % 3];
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * dist, y + Math.sin(a) * dist, 3 * (1 - cycle), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* ───────────────── CHEER ───────────────── */
function drawCheer(ctx, _plates, t) {
  drawCinemaStage(ctx, t, ['#115e59', '#134e4a', '#022c22']);
  // stadium bowl suggestion
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.92, W * 0.55, 90, 0, Math.PI, 0);
  ctx.fill();

  // stadium lights flicker continuously
  for (let i = 0; i < 12; i += 1) {
    const lx = (i / 11) * W;
    const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 22 + i * 0.7));
    glow(ctx, lx, 40, 60, 'rgba(254,249,195,ALPHA)', 0.15 * pulse);
  }

  // wave of cheer figures — each continuously bouncing
  const figures = 9;
  for (let i = 0; i < figures; i += 1) {
    const u = i / (figures - 1);
    const wave = smoothstep(0.15 + u * 0.25, 0.35 + u * 0.25, t);
    const jump = Math.sin((t * 10 + u * 4) * Math.PI) * 35 * wave;
    const arms = Math.sin(t * 16 + i) * 0.7 * wave;
    const x = lerp(W * 0.12, W * 0.88, u);
    const y = H * 0.62 - jump - wave * 20;
    const s = 0.85 + hash01(i, 2) * 0.35;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // body
    const jersey = ['#14B8A6', '#F59E0B', '#EF4444', '#3B82F6', '#A855F7'][i % 5];
    ctx.fillStyle = jersey;
    oval(ctx, 0, 10, 22, 28);
    ctx.fill();
    // head
    ctx.fillStyle = '#FDE68A';
    oval(ctx, 0, -28, 18, 18);
    ctx.fill();
    drawEyes(ctx, 0, -30, 0.7, 0, Math.sin(t * 8 + i) * 0.3, -0.2, '#0F172A');

    // arms up
    ctx.strokeStyle = jersey;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-16, 0);
    ctx.quadraticCurveTo(-40, -40 + arms * 20, -28, -70 - jump * 0.2);
    ctx.moveTo(16, 0);
    ctx.quadraticCurveTo(40, -40 - arms * 20, 28, -70 - jump * 0.2);
    ctx.stroke();

    // pom / spark at hands
    if (wave > 0.2) {
      glow(ctx, -28, -70, 24, 'rgba(253,224,71,ALPHA)', 0.5 * wave);
      glow(ctx, 28, -70, 24, 'rgba(253,224,71,ALPHA)', 0.5 * wave);
    }
    ctx.restore();
  }

  // confetti continuous rain
  for (let i = 0; i < 80; i += 1) {
    const seed = hash01(i, 7);
    const x = seed * W;
    const y = ((t * (120 + hash01(i, 8) * 220) + hash01(i, 9) * H) % (H + 40)) - 20;
    const rot = t * 8 + i;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = ['#F472B6', '#FDE68A', '#67E8F9', '#86EFAC', '#C4B5FD'][i % 5];
    ctx.globalAlpha = 0.75 * smoothstep(0.12, 0.3, t);
    ctx.fillRect(-3, -5, 6, 10);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  if (t > 0.65) {
    const g = smoothstep(0.65, 0.85, t);
    glow(ctx, W / 2, H * 0.35, 300, 'rgba(253,224,71,ALPHA)', 0.35 * g);
  }
}

/* ───────────────── FIRE ───────────────── */
function drawFire(ctx, _plates, t) {
  drawCinemaStage(ctx, t, ['#7c2d12', '#431407', '#0c0a09']);

  // ember field — continuous float
  for (let i = 0; i < 55; i += 1) {
    const seed = hash01(i, 4);
    const x = seed * W + Math.sin(t * 4 + i) * 20;
    const y = H - ((t * (60 + hash01(i, 5) * 160) + hash01(i, 6) * H) % H);
    ctx.fillStyle = `rgba(251,146,60,${0.3 + 0.5 * Math.sin(t * 12 + i)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + hash01(i, 7) * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const rise = easeOutCubic(smoothstep(0.08, 0.55, t));
  const hover = Math.sin(t * Math.PI * 5) * 16 * rise;
  const x = W * 0.5 + Math.sin(t * Math.PI * 2.2) * 18 * rise;
  const y = lerp(H * 0.78, H * 0.38, rise) + hover;
  const scale = lerp(0.55, 1.25, rise);
  const wing = Math.sin(t * Math.PI * 8) * 0.55 * rise;
  const stretch = Math.sin(t * Math.PI * 6) * 0.06;

  // ground fire
  const ground = 1 - smoothstep(0.5, 0.85, t);
  for (let i = 0; i < 10; i += 1) {
    const fx = W * 0.5 + (i - 4.5) * 28 + Math.sin(t * 20 + i) * 8;
    const fh = (40 + hash01(i, 2) * 50) * (0.7 + 0.3 * Math.sin(t * 30 + i)) * ground;
    const g = ctx.createLinearGradient(fx, H * 0.85, fx, H * 0.85 - fh);
    g.addColorStop(0, 'rgba(239,68,68,0)');
    g.addColorStop(0.4, 'rgba(249,115,22,0.7)');
    g.addColorStop(1, 'rgba(254,243,199,0.9)');
    ctx.fillStyle = g;
    oval(ctx, fx, H * 0.85 - fh * 0.5, 12, fh * 0.55);
    ctx.fill();
  }

  glow(ctx, x, y, 240, 'rgba(249,115,22,ALPHA)', 0.3 + rise * 0.25);

  // wings
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * (1 + stretch), scale * (1 - stretch));

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate(-0.4 + wing * side * 0.15);
    const wg = ctx.createLinearGradient(20, 0, 120, -40);
    wg.addColorStop(0, 'rgba(239,68,68,0.95)');
    wg.addColorStop(0.5, 'rgba(249,115,22,0.85)');
    wg.addColorStop(1, 'rgba(253,224,71,0)');
    ctx.fillStyle = wg;
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.quadraticCurveTo(70, -10 - wing * 30, 130, -50 - wing * 20);
    ctx.quadraticCurveTo(80, 20, 20, 40);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // body / spirit
  const body = ctx.createRadialGradient(0, 0, 10, 0, 0, 70);
  body.addColorStop(0, '#FEF3C7');
  body.addColorStop(0.4, '#FB923C');
  body.addColorStop(1, '#B91C1C');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -55);
  ctx.bezierCurveTo(40, -20, 35, 40, 0, 70);
  ctx.bezierCurveTo(-35, 40, -40, -20, 0, -55);
  ctx.closePath();
  ctx.fill();

  // flame tip flicker on head
  for (let i = 0; i < 5; i += 1) {
    const flick = 0.7 + 0.3 * Math.sin(t * 40 + i);
    ctx.fillStyle = i % 2 ? '#FDE68A' : '#F97316';
    oval(ctx, Math.sin(t * 30 + i) * 6, -60 - i * 8 * flick, 8 - i, 14 * flick);
    ctx.fill();
  }

  const blink = smoothstep(0.4, 0.42, t) * (1 - smoothstep(0.42, 0.44, t));
  drawEyes(ctx, 0, -5, 1.05, blink, Math.sin(t * 5) * 0.35, -0.15, '#7C2D12');

  ctx.restore();

  particles(ctx, t * 1.3, 60, x, y + 40, {
    speed: 180 + rise * 100,
    colors: ['#FEF3C7', '#FB923C', '#EF4444', '#FDE68A'],
    upward: -1,
    size: 4,
    spread: 1.2,
  });

  if (t > 0.72) {
    const g = smoothstep(0.72, 0.9, t);
    glow(ctx, x, y, 320, 'rgba(253,224,71,ALPHA)', 0.4 * g);
  }
}

const GIFTS = [
  { id: 'rocket', seconds: 3.3, impactAt: 0.26, gloryMs: 1000, draw: drawRocket },
  { id: 'crown', seconds: 3.0, impactAt: 0.42, gloryMs: 1100, draw: drawCrown },
  { id: 'diamond', seconds: 3.1, impactAt: 0.32, gloryMs: 1100, draw: drawDiamond },
  { id: 'cheer_burst', seconds: 3.1, impactAt: 0.3, gloryMs: 1100, draw: drawCheer },
  { id: 'fire', seconds: 3.1, impactAt: 0.28, gloryMs: 1100, draw: drawFire },
];

async function loadPlates() {
  // Storyboard stills intentionally unused as hero frames (slideshow rejected).
  // Kept on disk for art reference only.
  return {};
}

function encodeMp4(frameDir, outFile, fps) {
  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(frameDir, 'frame_%04d.png'),
    '-vf', "scale=1280:720:flags=lanczos,format=yuv420p",
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-movflags', '+faststart',
    '-an',
    outFile,
  ];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`ffmpeg failed for ${outFile}:\n${r.stderr?.slice(-800)}`);
  }
}

async function renderGift(gift, plates) {
  const frames = Math.round(gift.seconds * FPS);
  const dir = path.join(WORK, gift.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  console.log(`[render] ${gift.id}: ${frames} frames @ ${FPS}fps (${gift.seconds}s)`);
  for (let i = 0; i < frames; i += 1) {
    const t = i / (frames - 1);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#050A12';
    ctx.fillRect(0, 0, W, H);
    gift.draw(ctx, plates, t);
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(path.join(dir, `frame_${String(i + 1).padStart(4, '0')}.png`), buf);
    if (i % 30 === 0 || i === frames - 1) process.stdout.write(`  frame ${i + 1}/${frames}\n`);
  }

  const out = path.join(OUT_CLIPS, `${gift.id}.mp4`);
  encodeMp4(dir, out, FPS);
  const st = fs.statSync(out);
  console.log(`[ok] ${out} (${(st.size / 1024).toFixed(0)} KB)`);
  return { id: gift.id, frames, seconds: gift.seconds, out, bytes: st.size, impactAt: gift.impactAt, gloryMs: gift.gloryMs };
}

async function main() {
  fs.mkdirSync(OUT_CLIPS, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  const plates = await loadPlates();
  const results = [];
  for (const g of GIFTS) {
    results.push(await renderGift(g, plates));
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    method: 'procedural-canvas-character-rig@30fps → ffmpeg libx264',
    note: 'Every frame redraws animated character/prop with continuous transforms + particles. Storyboards used only as soft atmospheric plates, not Ken Burns hero.',
    fps: FPS,
    size: `${W}x${H}`,
    gifts: results,
  };
  fs.writeFileSync(path.join(__dirname, 'TRUE_MOTION_MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log('\nDone. Manifest written.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
