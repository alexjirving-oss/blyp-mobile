/* Final Play Store feature graphic (1024×500).
 * Near-black atmosphere + hero "blyp" wordmark + teal pulse. No testing badges.
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'play-store', 'feature-graphic-1024x500.png');
const OUT_SVG = path.join(ROOT, 'assets', 'play-store', 'feature-graphic-1024x500.svg');
const BG_CANDIDATES = [
  path.join(ROOT, '_agent', 'play-store', 'feature-graphic-bg.png'),
  path.resolve(
    process.env.USERPROFILE || '',
    '.cursor',
    'projects',
    'c-Users-Alex-Blyp26',
    'assets',
    'feature-graphic-bg.png',
  ),
];

const W = 1024;
const H = 500;
const NEAR_BLACK = '#0A0A0C';
const WHITE = '#F5F5F7';
const TEAL = '#00D2BE';
const MUTED = '#A1A1AA';

async function alphaBBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width, height };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function renderWordmarkRow() {
  const fontSize = 520;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="900">
    <text x="40" y="640" font-family="Arial, Helvetica, sans-serif" font-weight="800"
      font-size="${fontSize}" letter-spacing="-18" fill="${WHITE}">blyp</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const box = await alphaBBox(png);
  const cropped = await sharp(png).extract(box).png().toBuffer();
  const w = box.width;
  const h = box.height;
  const dotD = Math.round(h * 0.22);
  const gap = Math.round(w * 0.05);
  const dot = await sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dotD}" height="${dotD}">
      <circle cx="${dotD / 2}" cy="${dotD / 2}" r="${dotD / 2}" fill="${TEAL}"/>
    </svg>`,
  )).png().toBuffer();

  const rowW = w + gap + dotD;
  const rowH = h;
  const row = await sharp({
    create: { width: rowW, height: rowH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: cropped, left: 0, top: 0 },
      { input: dot, left: w + gap, top: Math.min(Math.round(h * 0.60), rowH - dotD) },
    ])
    .png()
    .toBuffer();

  // Hero scale for the banner.
  return sharp(row).resize({ width: 560 }).png().toBuffer();
}

async function buildAtmosphereFallback() {
  // Procedural premium plate if the AI background is unavailable.
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <radialGradient id="tealBloom" cx="72%" cy="42%" r="55%">
        <stop offset="0%" stop-color="${TEAL}" stop-opacity="0.28"/>
        <stop offset="45%" stop-color="${TEAL}" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="${NEAR_BLACK}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="leftShade" cx="18%" cy="55%" r="50%">
        <stop offset="0%" stop-color="#141418" stop-opacity="1"/>
        <stop offset="100%" stop-color="${NEAR_BLACK}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${NEAR_BLACK}" stop-opacity="0"/>
        <stop offset="100%" stop-color="${TEAL}" stop-opacity="0.14"/>
      </linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${TEAL}" stop-opacity="0"/>
        <stop offset="55%" stop-color="${TEAL}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${TEAL}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="${NEAR_BLACK}"/>
    <rect width="${W}" height="${H}" fill="url(#leftShade)"/>
    <rect width="${W}" height="${H}" fill="url(#tealBloom)"/>
    <rect y="360" width="${W}" height="140" fill="url(#floor)"/>
    <rect x="80" y="438" width="864" height="2" fill="url(#edge)"/>
    <circle cx="860" cy="150" r="3" fill="${TEAL}" opacity="0.9"/>
    <circle cx="900" cy="210" r="2" fill="${WHITE}" opacity="0.35"/>
    <circle cx="820" cy="240" r="2" fill="${TEAL}" opacity="0.55"/>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

async function loadBackground() {
  for (const candidate of BG_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return sharp(candidate)
        .resize(W, H, { fit: 'cover', position: 'centre' })
        .modulate({ brightness: 0.92, saturation: 0.85 })
        .png()
        .toBuffer();
    }
  }
  return buildAtmosphereFallback();
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  const bg = await loadBackground();
  const word = await renderWordmarkRow();
  const wordMeta = await sharp(word).metadata();
  const wordW = wordMeta.width || 560;
  const wordH = wordMeta.height || 180;

  // Soft vignette / readability plate behind the wordmark.
  const plate = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <radialGradient id="plate" cx="32%" cy="48%" r="42%">
        <stop offset="0%" stop-color="${NEAR_BLACK}" stop-opacity="0.72"/>
        <stop offset="70%" stop-color="${NEAR_BLACK}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${NEAR_BLACK}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#plate)"/>
  </svg>`)).png().toBuffer();

  const tagline = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="48">
    <text x="0" y="34" font-family="Arial, Helvetica, sans-serif" font-weight="600"
      font-size="28" letter-spacing="4" fill="${MUTED}">CREATE  ·  DISCOVER  ·  GO LIVE</text>
  </svg>`)).png().toBuffer();

  const accent = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="4">
    <defs>
      <linearGradient id="a" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${TEAL}" stop-opacity="0"/>
        <stop offset="35%" stop-color="${TEAL}" stop-opacity="1"/>
        <stop offset="100%" stop-color="${TEAL}" stop-opacity="0.15"/>
      </linearGradient>
    </defs>
    <rect width="180" height="4" rx="2" fill="url(#a)"/>
  </svg>`)).png().toBuffer();

  const left = 88;
  const wordTop = Math.round((H - wordH) / 2) - 28;
  const accentTop = wordTop + wordH + 18;
  const tagTop = accentTop + 22;

  await sharp(bg)
    .composite([
      { input: plate, left: 0, top: 0 },
      { input: word, left, top: wordTop },
      { input: accent, left, top: accentTop },
      { input: tagline, left, top: tagTop },
    ])
    .png()
    .toFile(OUT);

  // Lightweight SVG source (final listing copy — no testing labels).
  fs.writeFileSync(
    OUT_SVG,
    `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
  <rect width="1024" height="500" fill="${NEAR_BLACK}"/>
  <text x="88" y="250" font-family="Arial, Helvetica, sans-serif" font-weight="800"
    font-size="128" letter-spacing="-6" fill="${WHITE}">blyp</text>
  <circle cx="430" cy="232" r="18" fill="${TEAL}"/>
  <text x="88" y="330" font-family="Arial, Helvetica, sans-serif" font-weight="600"
    font-size="28" letter-spacing="4" fill="${MUTED}">CREATE  ·  DISCOVER  ·  GO LIVE</text>
</svg>
`,
  );

  console.log('wrote', OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
