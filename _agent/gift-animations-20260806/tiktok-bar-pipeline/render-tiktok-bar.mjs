/**
 * TikTok-class gift overlay renderer — PASS 2 (density + scale leap).
 *
 * Dark-keyed commercial FX on pure black. Large center-stage heroes,
 * heavy bloom, soft smoke, dense glitter — NOT cartoon faces, NOT Ken Burns.
 * Honest ceiling: still procedural 2D, not commissioned AlphaPlayer 3D.
 */
import { createCanvas } from '@napi-rs/canvas';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../../..');
const OUT_CLIPS = path.join(REPO, 'assets/gifts/cinema/clips');
const WORK = path.join(__dirname, '_frames');
const QC = path.join(__dirname, '_qc');

const W = 720;
const H = 1280;
const FPS = 30;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInCubic = (t) => t ** 3;
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const hash01 = (i, salt = 1) => {
  const n = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

function findFfmpeg() {
  const fromPath = spawnSync('where.exe', ['ffmpeg'], { encoding: 'utf8' });
  if (fromPath.status === 0) {
    const line = String(fromPath.stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (line) return line;
  }
  const winget = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe'
  );
  if (fs.existsSync(winget)) return winget;
  return 'ffmpeg';
}

const FFMPEG = findFfmpeg();

function bloom(ctx, x, y, r, rgb, a = 0.55) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${Math.min(1, a)})`);
  g.addColorStop(0.25, `rgba(${rgb},${a * 0.45})`);
  g.addColorStop(0.6, `rgba(${rgb},${a * 0.12})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function softDisc(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function softSmoke(ctx, x, y, r, a, rgb = '200,210,220') {
  bloom(ctx, x, y, r, rgb, a * 0.55);
  bloom(ctx, x + r * 0.15, y - r * 0.1, r * 0.7, rgb, a * 0.35);
}

function shockwave(ctx, x, y, radius, width, rgba, alpha) {
  if (radius < 2 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = rgba;
  ctx.lineWidth = width;
  ctx.shadowColor = rgba;
  ctx.shadowBlur = width * 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function lightShafts(ctx, cx, cy, t, count, color, strength) {
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const ang = (i / count) * Math.PI * 2 + t * 0.45 + hash01(i, 2) * 0.35;
    const len = H * (0.4 + hash01(i, 3) * 0.5);
    const w = 28 + hash01(i, 4) * 55;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.globalAlpha = strength * (0.1 + hash01(i, 5) * 0.14) * (0.75 + 0.25 * Math.sin(t * 7 + i));
    const g = ctx.createLinearGradient(0, 0, 0, -len);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color.replace(/[\d.]+\)$/, '0.25)'));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-w * 0.12, 0);
    ctx.lineTo(w * 0.12, 0);
    ctx.lineTo(w, -len);
    ctx.lineTo(-w, -len);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function glitterField(ctx, t, count, cx, cy, opts = {}) {
  const {
    radius = 320,
    size = 3.2,
    colors = ['#FFF7D6', '#FDE68A', '#FFFFFF', '#A5F3FC', '#FBCFE8'],
    spin = 1.2,
    burst = 0,
  } = opts;
  for (let i = 0; i < count; i += 1) {
    const seed = hash01(i, 11);
    const seed2 = hash01(i, 17);
    const ang = seed * Math.PI * 2 + t * spin * (0.4 + seed2);
    const dist = radius * (0.08 + seed2 * 0.92) * (1 + burst * seed * 0.6);
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 1.08;
    const twinkle = 0.3 + 0.7 * Math.abs(Math.sin(t * 16 + seed * 22));
    const s = size * (0.35 + seed * 1.6) * twinkle;
    ctx.globalAlpha = twinkle * (0.5 + burst * 0.4);
    if (seed > 0.55) {
      softDisc(ctx, x, y, s, colors[i % colors.length]);
    } else {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s * (0.5 + seed));
    }
    if (seed > 0.78) bloom(ctx, x, y, s * 8, '255,248,220', 0.22 * twinkle);
  }
  ctx.globalAlpha = 1;
}

function sparkBurst(ctx, t0, t, originX, originY, count, colors, speed = 480) {
  if (t < t0) return;
  const u = (t - t0) / Math.max(0.01, 1 - t0);
  for (let i = 0; i < count; i += 1) {
    const seed = hash01(i, 21);
    const life = 0.5 + seed * 0.45;
    const age = u / life;
    if (age > 1) continue;
    const ang = seed * Math.PI * 2 + hash01(i, 3) * 0.4;
    const dist = age * speed * (0.5 + hash01(i, 4));
    const x = originX + Math.cos(ang) * dist;
    const y = originY + Math.sin(ang) * dist - age * age * 110;
    const a = (1 - age) * 0.95;
    const s = (2.5 + seed * 4.5) * (1 - age * 0.45);
    ctx.globalAlpha = a;
    softDisc(ctx, x, y, s, colors[i % colors.length]);
    bloom(ctx, x, y, s * 7, '255,220,160', a * 0.28);
  }
  ctx.globalAlpha = 1;
}

function softRibbon(ctx, t, cx, cy, i, color) {
  const seed = hash01(i, 40);
  const ang0 = seed * Math.PI * 2;
  const progress = clamp((t * 0.95 + seed * 0.2) % 1.15, 0, 1);
  ctx.save();
  ctx.globalAlpha = 0.7 * (1 - progress * 0.4);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5 + seed * 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  for (let k = 0; k < 24; k += 1) {
    const u = k / 23;
    const ang = ang0 + u * (2.2 + seed) + Math.sin(t * 5 + k * 0.4) * 0.25;
    const dist = 30 + progress * 420 * u + Math.sin(u * 10 + t * 3) * 22;
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 0.9;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

function confetti(ctx, t, t0, count, cx, cy) {
  if (t < t0) return;
  const u = clamp((t - t0) / 0.9, 0, 1);
  const colors = ['#00D2BE', '#FBBF24', '#F472B6', '#38BDF8', '#F97316', '#FFFFFF', '#A78BFA', '#34D399'];
  for (let i = 0; i < count; i += 1) {
    const seed = hash01(i, 55);
    const ang = seed * Math.PI * 2;
    const dist = easeOutCubic(u) * (200 + seed * 480);
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist * 0.88 + u * u * 260 * (0.25 + seed);
    const rot = u * 14 + seed * 12;
    const w = 8 + seed * 14;
    const h = 3.5 + hash01(i, 2) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = 1 - u * 0.5;
    ctx.shadowColor = colors[i % colors.length];
    ctx.shadowBlur = 8;
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

function starBurstCore(ctx, x, y, scale, t) {
  bloom(ctx, x, y, 180 * scale, '255,255,255', 0.55);
  bloom(ctx, x, y, 320 * scale, '125,211,252', 0.35);
  for (let i = 0; i < 8; i += 1) {
    const ang = (i / 8) * Math.PI * 2 + t * 0.8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(0, 0, 0, -140 * scale);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(125,211,252,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-6 * scale, 0);
    ctx.lineTo(6 * scale, 0);
    ctx.lineTo(2 * scale, -160 * scale);
    ctx.lineTo(-2 * scale, -160 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

// ——— Heroes (large, glossy) ———

function drawMetallicRocket(ctx, x, y, scale, tilt, thrust) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.scale(scale, scale);

  if (thrust > 0.05) {
    for (let i = 0; i < 14; i += 1) {
      const yy = 95 + i * 32 * thrust;
      const rr = (38 - i * 2) * thrust * (1.15 - i * 0.05);
      const wob = Math.sin(i * 1.7 + thrust * 8) * 10;
      bloom(ctx, wob, yy, rr * 3.8, i < 3 ? '255,255,255' : i < 7 ? '125,211,252' : '251,146,60', 0.4 * thrust);
      softSmoke(ctx, wob * 1.4, yy + 20, rr * 2.2, 0.2 * thrust * (1 - i / 14), '148,163,184');
    }
  }

  // fins
  const finGrad = ctx.createLinearGradient(0, 60, 0, 130);
  finGrad.addColorStop(0, '#5EEAD4');
  finGrad.addColorStop(1, '#134E4A');
  ctx.fillStyle = finGrad;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 36, 70);
    ctx.lineTo(side * 78, 130);
    ctx.lineTo(side * 22, 105);
    ctx.closePath();
    ctx.fill();
  }

  // body
  const body = ctx.createLinearGradient(-55, 0, 55, 0);
  body.addColorStop(0, '#042F2E');
  body.addColorStop(0.22, '#0F766E');
  body.addColorStop(0.42, '#5EEAD4');
  body.addColorStop(0.5, '#F0FDFA');
  body.addColorStop(0.58, '#2DD4BF');
  body.addColorStop(0.78, '#0F766E');
  body.addColorStop(1, '#042F2E');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(0, -150);
  ctx.bezierCurveTo(52, -95, 58, 30, 46, 95);
  ctx.lineTo(-46, 95);
  ctx.bezierCurveTo(-58, 30, -52, -95, 0, -150);
  ctx.closePath();
  ctx.fill();

  // panel lines
  ctx.strokeStyle = 'rgba(15,118,110,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-30, -40);
  ctx.lineTo(-28, 70);
  ctx.moveTo(30, -40);
  ctx.lineTo(28, 70);
  ctx.stroke();

  // specular
  ctx.globalAlpha = 0.7;
  const spec = ctx.createLinearGradient(-14, -120, 22, 80);
  spec.addColorStop(0, 'rgba(255,255,255,0)');
  spec.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  spec.addColorStop(0.55, 'rgba(255,255,255,0.15)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = spec;
  ctx.beginPath();
  ctx.ellipse(-10, -15, 11, 95, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // window
  bloom(ctx, 0, -45, 40, '165,243,252', 0.65);
  const win = ctx.createRadialGradient(-6, -52, 2, 0, -45, 24);
  win.addColorStop(0, '#FFFFFF');
  win.addColorStop(0.35, '#A5F3FC');
  win.addColorStop(0.7, '#22D3EE');
  win.addColorStop(1, '#0E7490');
  softDisc(ctx, 0, -45, 22, win);
  softDisc(ctx, -6, -52, 5, 'rgba(255,255,255,0.95)');

  bloom(ctx, 0, -145, 32, '255,255,255', 0.55);
  softDisc(ctx, 0, -148, 8, '#fff');

  // engine bell
  const bell = ctx.createLinearGradient(0, 90, 0, 120);
  bell.addColorStop(0, '#67E8F9');
  bell.addColorStop(1, '#164E63');
  ctx.fillStyle = bell;
  ctx.beginPath();
  ctx.moveTo(-34, 95);
  ctx.lineTo(34, 95);
  ctx.lineTo(28, 118);
  ctx.lineTo(-28, 118);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawCrown(ctx, x, y, scale, rot, sparkleT) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale, scale);

  bloom(ctx, 0, 20, 240, '251,191,36', 0.45);
  bloom(ctx, 0, -30, 140, '255,255,255', 0.28);
  softSmoke(ctx, 0, 40, 160, 0.18, '253,224,71');

  // band
  const band = ctx.createLinearGradient(0, 55, 0, 110);
  band.addColorStop(0, '#FFFBEB');
  band.addColorStop(0.25, '#FDE68A');
  band.addColorStop(0.55, '#F59E0B');
  band.addColorStop(1, '#78350F');
  ctx.fillStyle = band;
  ctx.beginPath();
  ctx.moveTo(-130, 70);
  ctx.quadraticCurveTo(0, 105, 130, 70);
  ctx.lineTo(130, 105);
  ctx.quadraticCurveTo(0, 135, -130, 105);
  ctx.closePath();
  ctx.fill();

  // specular on band
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(0, 82, 90, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const tips = [-100, -50, 0, 50, 100];
  tips.forEach((tx, i) => {
    const hgt = i === 2 ? 155 : 95 + (i % 2) * 28;
    const g = ctx.createLinearGradient(tx, 75, tx, 75 - hgt);
    g.addColorStop(0, '#92400E');
    g.addColorStop(0.35, '#FBBF24');
    g.addColorStop(0.65, '#FDE68A');
    g.addColorStop(1, '#FFFBEB');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(tx - 26, 78);
    ctx.lineTo(tx, 78 - hgt);
    ctx.lineTo(tx + 26, 78);
    ctx.closePath();
    ctx.fill();
    // inner bevel
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(tx - 8, 70);
    ctx.lineTo(tx, 78 - hgt + 12);
    ctx.lineTo(tx - 2, 70);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    const jy = 78 - hgt + 12;
    bloom(ctx, tx, jy, 28, i === 2 ? '251,113,133' : '103,232,249', 0.7);
    softDisc(ctx, tx, jy, 12, i === 2 ? '#FB7185' : '#67E8F9');
    softDisc(ctx, tx - 3, jy - 3, 3.5, '#fff');
  });

  for (let i = 0; i < 9; i += 1) {
    const gx = -88 + i * 22;
    const gy = 90 + Math.sin(i * 1.2) * 3;
    bloom(ctx, gx, gy, 10, '255,255,255', 0.35);
    softDisc(ctx, gx, gy, 7, i % 3 === 0 ? '#34D399' : i % 3 === 1 ? '#818CF8' : '#F472B6');
    softDisc(ctx, gx - 2, gy - 2, 2, '#fff');
  }

  glitterField(ctx, sparkleT, 90, 0, 0, { radius: 140, size: 2.8, spin: 2.6 });
  ctx.restore();
}

function drawDiamond(ctx, x, y, scale, rot, pulse) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(scale * (1 + pulse * 0.05), scale * (1 + pulse * 0.05));

  bloom(ctx, 0, 0, 280, '34,211,238', 0.5);
  bloom(ctx, 0, 0, 140, '255,255,255', 0.4);
  softSmoke(ctx, 0, 20, 180, 0.15, '165,243,252');

  const top = [
    [0, -160],
    [100, -40],
    [55, 30],
    [0, 15],
    [-55, 30],
    [-100, -40],
  ];
  const fills = [
    ['#FFFFFF', '#A5F3FC'],
    ['#CFFAFE', '#0891B2'],
    ['#ECFEFF', '#22D3EE'],
    ['#E0F2FE', '#38BDF8'],
    ['#F0FDFA', '#2DD4BF'],
  ];
  for (let i = 0; i < 5; i += 1) {
    const a = top[0];
    const b = top[i + 1];
    const c = top[(i + 1) % 5 + 1] || top[1];
    const g = ctx.createLinearGradient(a[0], a[1], (b[0] + c[0]) / 2, (b[1] + c[1]) / 2);
    g.addColorStop(0, fills[i][0]);
    g.addColorStop(1, fills[i][1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.closePath();
    ctx.fill();
  }

  const pavilion = [
    [[-100, -40], [-55, 30], [0, 175]],
    [[-55, 30], [0, 15], [0, 175]],
    [[0, 15], [55, 30], [0, 175]],
    [[55, 30], [100, -40], [0, 175]],
  ];
  pavilion.forEach((tri, i) => {
    const g = ctx.createLinearGradient(0, -30, 0, 175);
    g.addColorStop(0, i % 2 ? '#67E8F9' : '#A5F3FC');
    g.addColorStop(0.5, '#22D3EE');
    g.addColorStop(1, '#164E63');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(tri[0][0], tri[0][1]);
    ctx.lineTo(tri[1][0], tri[1][1]);
    ctx.lineTo(tri[2][0], tri[2][1]);
    ctx.closePath();
    ctx.fill();
  });

  // caustic flash
  ctx.globalAlpha = 0.75 + pulse * 0.2;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(-12, -100);
  ctx.lineTo(22, -140);
  ctx.lineTo(8, -50);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(20, -20);
  ctx.lineTo(55, -55);
  ctx.lineTo(35, 10);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawFlameColumn(ctx, x, baseY, t, power) {
  // wide soft base
  bloom(ctx, x, baseY, 220 * power, '234,88,12', 0.45 * power);
  bloom(ctx, x, baseY - 80, 180 * power, '251,146,60', 0.4 * power);

  const tongues = 9;
  for (let i = 0; i < tongues; i += 1) {
    const seed = hash01(i, 8);
    const ox = (seed - 0.5) * 90 * power;
    const h = (220 + seed * 280) * power * (0.85 + 0.15 * Math.sin(t * 11 + i));
    const wob = Math.sin(t * 9 + i * 1.3) * 28 * power;
    const w = (35 + seed * 45) * power;
    const g = ctx.createRadialGradient(x + ox + wob * 0.3, baseY - h * 0.55, 2, x + ox, baseY - h * 0.15, w * 1.6);
    const rgb = i < 2 ? '255,255,255' : i < 4 ? '253,224,71' : i < 6 ? '251,146,60' : '234,88,12';
    const a = (0.35 + seed * 0.4) * power;
    g.addColorStop(0, `rgba(${rgb},${Math.min(0.95, a + 0.2)})`);
    g.addColorStop(0.45, `rgba(${rgb},${a * 0.4})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x + ox + wob, baseY - h * 0.42, w, h * 0.55, wob * 0.01, 0, Math.PI * 2);
    ctx.fill();
  }

  // core white-hot
  bloom(ctx, x, baseY - 120 * power, 70 * power, '255,255,255', 0.55 * power);

  for (let i = 0; i < 70; i += 1) {
    const seed = hash01(i, 66);
    const life = ((t * 0.85 + seed) % 1);
    const ex = x + (seed - 0.5) * 200 * power + Math.sin(t * 6 + i) * 12;
    const ey = baseY - life * 520 * power - seed * 50;
    const a = (1 - life) * power * 0.95;
    ctx.globalAlpha = a;
    softDisc(ctx, ex, ey, 2.5 + seed * 4, seed > 0.55 ? '#FDBA74' : '#FDE68A');
    if (seed > 0.7) bloom(ctx, ex, ey, 16, '251,146,60', a * 0.45);
  }
  ctx.globalAlpha = 1;
}

const GIFTS = {
  rocket: {
    durationMs: 3400,
    impactAt: 0.28,
    gloryMs: 1000,
    storyBeat: 'Metallic rocket ignition → ascent streak → apex star detonation.',
    draw(ctx, t) {
      const cx = W / 2;
      const ground = H * 0.7;
      const thrust = smoothstep(0.1, 0.28, t) * (1 - smoothstep(0.55, 0.95, t) * 0.35);
      bloom(ctx, cx, ground + 50, 300, '251,146,60', 0.35 * thrust);
      bloom(ctx, cx, ground, 160, '255,255,255', 0.22 * thrust);
      softSmoke(ctx, cx - 40, ground + 30, 100, 0.2 * thrust);
      softSmoke(ctx, cx + 50, ground + 40, 120, 0.18 * thrust);

      const lift = easeInCubic(smoothstep(0.2, 0.7, t));
      const y = lerp(ground - 60, H * 0.28, lift);
      const scale = lerp(1.05, 1.55, smoothstep(0, 0.22, t)) * lerp(1, 0.65, smoothstep(0.62, 1, t));
      const tilt = Math.sin(t * 5) * 0.05 * (1 - lift);

      if (lift > 0.04) {
        for (let i = 0; i < 16; i += 1) {
          const ty = y + 80 + i * 38 * lift;
          bloom(ctx, cx + Math.sin(t * 18 + i) * 12, ty, 40 - i * 1.5, '56,189,248', 0.28 * (1 - i / 16) * thrust);
        }
      }

      drawMetallicRocket(ctx, cx, y, scale, tilt - 0.02, Math.max(thrust, lift * 0.85));

      const impact = smoothstep(0.26, 0.36, t) * (1 - smoothstep(0.42, 0.72, t));
      if (impact > 0) {
        shockwave(ctx, cx, y - 50, 50 + impact * 340, 10, 'rgba(165,243,252,0.95)', impact);
        shockwave(ctx, cx, y - 50, 30 + impact * 220, 4, 'rgba(255,255,255,0.9)', impact * 0.85);
        bloom(ctx, cx, y - 50, 280 * impact, '255,255,255', 0.65 * impact);
        sparkBurst(ctx, 0.27, t, cx, y - 40, 140, ['#ECFEFF', '#67E8F9', '#FDE68A', '#fff'], 420);
      }

      if (t > 0.52) {
        const g = smoothstep(0.52, 0.72, t);
        starBurstCore(ctx, cx, H * 0.28, g, t);
        lightShafts(ctx, cx, H * 0.28, t, 14, 'rgba(165,243,252,0.95)', g);
        glitterField(ctx, t, 220, cx, H * 0.28, { radius: 340 * g, burst: g, spin: 1.9 });
        sparkBurst(ctx, 0.55, t, cx, H * 0.28, 160, ['#ECFEFF', '#67E8F9', '#FDE68A', '#fff'], 400);
      }
    },
  },

  crown: {
    durationMs: 3200,
    impactAt: 0.42,
    gloryMs: 1100,
    storyBeat: 'Jeweled gold crown descends on light shaft → contact glitter storm → regal halo.',
    draw(ctx, t) {
      const cx = W / 2;
      const landY = H * 0.4;
      const drop = easeOutCubic(smoothstep(0.04, 0.42, t));
      const y = lerp(-220, landY, drop);
      const scale = lerp(0.85, 1.65, easeOutBack(clamp(drop, 0, 1)));
      const rot = (1 - drop) * 0.4 + Math.sin(t * 4) * 0.04;

      const shaftA = 0.2 + drop * 0.45;
      const sg = ctx.createLinearGradient(cx, 0, cx, landY + 100);
      sg.addColorStop(0, `rgba(255,251,235,${shaftA})`);
      sg.addColorStop(0.5, `rgba(253,224,71,${shaftA * 0.5})`);
      sg.addColorStop(1, 'rgba(251,191,36,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(cx - 55, 0, 110, landY + 120);
      bloom(ctx, cx, landY, 260, '251,191,36', 0.28 + drop * 0.3);

      drawCrown(ctx, cx, y, scale, rot, t);

      const impact = smoothstep(0.4, 0.5, t) * (1 - smoothstep(0.55, 0.88, t));
      if (impact > 0) {
        shockwave(ctx, cx, landY + 50, 40 + impact * 380, 12, 'rgba(253,224,71,0.95)', impact);
        bloom(ctx, cx, landY, 360 * impact, '255,255,255', 0.6 * impact);
        sparkBurst(ctx, 0.42, t, cx, landY, 180, ['#FEF3C7', '#FBBF24', '#fff', '#FDE68A'], 440);
        glitterField(ctx, t, 260, cx, landY, {
          radius: 360 * impact + 100,
          burst: impact,
          colors: ['#FFFBEB', '#FDE68A', '#FBBF24', '#fff', '#FBCFE8'],
        });
      }

      if (t > 0.48) {
        const g = smoothstep(0.48, 0.72, t);
        lightShafts(ctx, cx, landY, t, 16, 'rgba(253,224,71,0.95)', g);
        bloom(ctx, cx, landY - 30, 280 * g, '251,191,36', 0.45 * g);
        glitterField(ctx, t, 180, cx, landY, { radius: 300, spin: 2.0, burst: 0.3 });
      }
    },
  },

  diamond: {
    durationMs: 3300,
    impactAt: 0.34,
    gloryMs: 1100,
    storyBeat: 'Crystal rotates with caustic flashes → prism beams → shatter spark bloom.',
    draw(ctx, t) {
      const cx = W / 2;
      const cy = H * 0.42;
      const enter = easeOutCubic(smoothstep(0, 0.2, t));
      const scale = lerp(0.35, 1.75, enter);
      const rot = t * 2.4 + enter * 0.9;
      const pulse = Math.sin(t * 14) * 0.5 + 0.5;

      bloom(ctx, cx, cy, 220 * enter, '34,211,238', 0.35 * enter);
      drawDiamond(ctx, cx, cy, scale, rot, pulse);

      if (t > 0.15) {
        lightShafts(ctx, cx, cy, t, 12, 'rgba(165,243,252,0.95)', 0.65 + pulse * 0.25);
      }

      const impact = smoothstep(0.32, 0.42, t) * (1 - smoothstep(0.5, 0.82, t));
      if (impact > 0) {
        shockwave(ctx, cx, cy, 50 + impact * 360, 8, 'rgba(207,250,254,0.95)', impact);
        bloom(ctx, cx, cy, 400 * impact, '255,255,255', 0.7 * impact);
        sparkBurst(ctx, 0.34, t, cx, cy, 200, ['#ECFEFF', '#67E8F9', '#A5F3FC', '#fff', '#F0FDFA'], 480);
        for (let i = 0; i < 36; i += 1) {
          const seed = hash01(i, 90);
          const ang = seed * Math.PI * 2;
          const dist = impact * (140 + seed * 320);
          ctx.save();
          ctx.globalAlpha = impact * (0.8 - seed * 0.3);
          ctx.strokeStyle = '#ECFEFF';
          ctx.lineWidth = 2.5 + seed * 3;
          ctx.shadowColor = '#67E8F9';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * 40, cy + Math.sin(ang) * 40);
          ctx.lineTo(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist);
          ctx.stroke();
          ctx.restore();
        }
      }

      if (t > 0.5) {
        glitterField(ctx, t, 240, cx, cy, { radius: 340, spin: 2.3, burst: 0.45 });
      }
    },
  },

  cheer_burst: {
    durationMs: 3200,
    impactAt: 0.3,
    gloryMs: 1100,
    storyBeat: 'Center confetti cannon → stadium light streaks → teal/gold celebration wash.',
    draw(ctx, t) {
      const cx = W / 2;
      const cy = H * 0.46;
      const build = smoothstep(0.0, 0.28, t);

      bloom(ctx, cx, cy, 180 * build, '0,210,190', 0.4 * build);
      bloom(ctx, cx, cy, 90 * build, '255,255,255', 0.35 * build);

      if (t < 0.32) {
        for (let i = 0; i < 4; i += 1) {
          const r = 50 + (1 - build) * (100 + i * 50);
          shockwave(ctx, cx, cy, r, 4, 'rgba(0,210,190,0.75)', (1 - build) * 0.65);
        }
      }

      const impact = smoothstep(0.28, 0.4, t);
      confetti(ctx, t, 0.28, 280, cx, cy);
      for (let i = 0; i < 18; i += 1) {
        softRibbon(ctx, Math.max(0, t - 0.28), cx, cy, i, ['#00D2BE', '#FBBF24', '#F472B6', '#38BDF8', '#F97316'][i % 5]);
      }

      if (impact > 0) {
        const fade = 1 - smoothstep(0.45, 0.78, t);
        shockwave(ctx, cx, cy, 60 + impact * 400, 14, 'rgba(251,191,36,0.95)', impact * fade);
        bloom(ctx, cx, cy, 380 * impact, '255,255,255', 0.55 * impact * fade);
        sparkBurst(ctx, 0.3, t, cx, cy, 160, ['#FDE68A', '#00D2BE', '#fff', '#F9A8D4'], 500);
      }

      lightShafts(ctx, cx, cy, t, 18, 'rgba(253,224,71,0.9)', smoothstep(0.3, 0.55, t));
      glitterField(ctx, t, 200, cx, cy, {
        radius: 380 * smoothstep(0.3, 0.7, t),
        colors: ['#FFF', '#FDE68A', '#5EEAD4', '#F9A8D4', '#FBBF24'],
        spin: 1.6,
        burst: impact,
      });

      if (t > 0.42) {
        const g = smoothstep(0.42, 0.68, t) * (1 - smoothstep(0.85, 1, t) * 0.3);
        bloom(ctx, cx, H * 0.88, 480 * g, '0,210,190', 0.28 * g);
        bloom(ctx, cx, H * 0.12, 360 * g, '251,191,36', 0.25 * g);
      }
    },
  },

  fire: {
    durationMs: 3300,
    impactAt: 0.3,
    gloryMs: 1100,
    storyBeat: 'Ember floor → rising luminous flame column → heat bloom + ember rain.',
    draw(ctx, t) {
      const cx = W / 2;
      const base = H * 0.76;
      const power = smoothstep(0.06, 0.32, t) * (0.8 + 0.2 * Math.sin(t * 10));

      bloom(ctx, cx, base + 30, 360, '234,88,12', 0.4 * power);
      for (let i = 0; i < 50; i += 1) {
        const seed = hash01(i, 3);
        const ex = cx + (seed - 0.5) * 400;
        const ey = base + 16 + Math.sin(t * 9 + i) * 8;
        softDisc(ctx, ex, ey, 3 + seed * 5, `rgba(251,146,60,${0.45 + seed * 0.4})`);
        if (seed > 0.7) bloom(ctx, ex, ey, 18, '251,146,60', 0.3);
      }

      drawFlameColumn(ctx, cx, base, t, power);

      const impact = smoothstep(0.28, 0.4, t) * (1 - smoothstep(0.5, 0.82, t));
      if (impact > 0) {
        shockwave(ctx, cx, base - 220, 50 + impact * 320, 10, 'rgba(253,186,116,0.95)', impact);
        bloom(ctx, cx, base - 240, 320 * impact, '255,255,255', 0.55 * impact);
        sparkBurst(ctx, 0.3, t, cx, base - 200, 160, ['#FDBA74', '#F97316', '#FDE68A', '#fff'], 400);
      }

      if (t > 0.48) {
        const g = smoothstep(0.48, 0.72, t);
        bloom(ctx, cx, H * 0.32, 360 * g, '251,146,60', 0.42 * g);
        lightShafts(ctx, cx, H * 0.38, t, 12, 'rgba(253,224,71,0.85)', g * 0.8);
        glitterField(ctx, t, 160, cx, H * 0.38, {
          radius: 300,
          colors: ['#FDE68A', '#FDBA74', '#fff', '#F97316'],
          spin: 1.2,
        });
      }
    },
  },
};

function clearBlack(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
}

function renderGift(id) {
  const spec = GIFTS[id];
  const frames = Math.round((spec.durationMs / 1000) * FPS);
  const dir = path.join(WORK, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  console.log(`Rendering ${id}: ${frames} frames @ ${FPS}fps (${W}x${H})`);
  for (let f = 0; f < frames; f += 1) {
    const t = f / (frames - 1);
    clearBlack(ctx);
    bloom(ctx, W / 2, H / 2, Math.max(W, H) * 0.6, '6,10,18', 0.4);
    spec.draw(ctx, t);
    fs.writeFileSync(path.join(dir, `f${String(f).padStart(4, '0')}.png`), canvas.toBuffer('image/png'));
    if (f % 30 === 0) process.stdout.write(`  ${id} ${f}/${frames}\n`);
  }

  fs.mkdirSync(OUT_CLIPS, { recursive: true });
  const outMp4 = path.join(OUT_CLIPS, `${id}.mp4`);
  const res = spawnSync(
    FFMPEG,
    [
      '-y',
      '-framerate',
      String(FPS),
      '-i',
      path.join(dir, 'f%04d.png'),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-crf',
      '17',
      '-movflags',
      '+faststart',
      '-an',
      outMp4,
    ],
    { encoding: 'utf8' }
  );
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout);
    throw new Error(`ffmpeg failed for ${id}`);
  }

  fs.mkdirSync(QC, { recursive: true });
  for (const at of [0.1, 0.3, 0.55, 0.85]) {
    const f = Math.round(at * (frames - 1));
    fs.copyFileSync(path.join(dir, `f${String(f).padStart(4, '0')}.png`), path.join(QC, `${id}_${Math.round(at * 100)}.png`));
  }

  return {
    id,
    frames,
    durationMs: spec.durationMs,
    impactAt: spec.impactAt,
    gloryMs: spec.gloryMs,
    storyBeat: spec.storyBeat,
    file: outMp4,
    bytes: fs.statSync(outMp4).size,
  };
}

function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const results = [];
  for (const id of Object.keys(GIFTS)) results.push(renderGift(id));
  const manifest = {
    generatedAt: new Date().toISOString(),
    resolution: `${W}x${H}`,
    fps: FPS,
    style: 'tiktok-bar-dark-key-luxury-fx-v2',
    pass: 2,
    notes:
      'Larger heroes, denser glitter/sparks/smoke, stronger bloom. Still procedural 2D — not true TikTok AlphaPlayer 3D packs.',
    gifts: results,
  };
  fs.writeFileSync(path.join(__dirname, 'TIKTOK_BAR_MANIFEST.json'), JSON.stringify(manifest, null, 2));
  console.log('\nDone.');
  console.log(JSON.stringify(manifest, null, 2));
}

main();
