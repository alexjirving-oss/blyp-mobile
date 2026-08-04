/* Build the launcher icons as the Blyp wordmark: lowercase white "blyp" + a teal
 * pulse dot on near-black, matching the in-app header logo. Rendered from vector
 * text so colours/shape are exact and crisp.
 *
 *   icon.png          -> opaque near-black square (iOS rounds the corners)
 *   adaptive-icon.png -> wordmark on transparent (Android composites over the
 *                        adaptiveIcon.backgroundColor), sized into the safe zone
 */
const sharp = require('sharp');
const path = require('path');

const OUT_ICON = path.resolve(__dirname, '..', 'assets', 'icon.png');
const OUT_ADAPTIVE = path.resolve(__dirname, '..', 'assets', 'adaptive-icon.png');

const NEAR_BLACK = '#0A0A0C';
const WHITE = '#F5F5F7';
const TEAL = '#00D2BE';
const SIZE = 1024;

async function alphaBBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1;
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

// Render "blyp" glyphs (white) on a wide transparent canvas, then trim.
async function renderWordmark() {
  const fontSize = 520;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="900">
    <text x="40" y="640" font-family="Arial, Helvetica, sans-serif" font-weight="800"
      font-size="${fontSize}" letter-spacing="-18" fill="${WHITE}">blyp</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const box = await alphaBBox(png);
  const cropped = await sharp(png).extract(box).png().toBuffer();
  return { cropped, w: box.width, h: box.height };
}

function dotSvg(d) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d}" height="${d}">
    <circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="${TEAL}"/>
  </svg>`;
}

async function build({ outPath, opaque, padRatio }) {
  const { cropped, w, h } = await renderWordmark();
  const dotD = Math.round(h * 0.22);
  const dot = await sharp(Buffer.from(dotSvg(dotD))).png().toBuffer();
  const gap = Math.round(w * 0.05);

  // Lay out [wordmark][gap][dot] with the dot sitting low (near the baseline).
  const rowW = w + gap + dotD;
  const rowH = h;
  const dotTop = Math.round(h * 0.60);
  const row = await sharp({
    create: { width: rowW, height: rowH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: cropped, left: 0, top: 0 },
      { input: dot, left: w + gap, top: Math.min(dotTop, rowH - dotD) },
    ])
    .png()
    .toBuffer();

  // Place the composition into a padded square.
  const side = Math.max(rowW, rowH);
  const canvas = Math.round(side * (1 + padRatio * 2));
  const left = Math.round((canvas - rowW) / 2);
  const top = Math.round((canvas - rowH) / 2);

  const bg = opaque
    ? { r: 10, g: 10, b: 12, alpha: 1 }
    : { r: 0, g: 0, b: 0, alpha: 0 };

  // Pass 1: composite at full size (sharp applies resize before composite, so we
  // must NOT resize in the same pipeline as a larger composite input).
  const full = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: bg } })
    .composite([{ input: row, left, top }])
    .png()
    .toBuffer();
  // Pass 2: downscale to the final icon size.
  await sharp(full).resize(SIZE, SIZE, { fit: 'fill' }).png().toFile(outPath);
  console.log('wrote', outPath, 'canvas', canvas, 'row', rowW, rowH);
}

// ---- Native Android res (webp) ----
const RES = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

async function roundMask(buf, size) {
  const circle = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(buf)
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: circle, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function writeNative() {
  const iconBuf = await sharp(OUT_ICON).png().toBuffer();
  const fgBuf = await sharp(OUT_ADAPTIVE).png().toBuffer();
  for (const [dpi, sz] of Object.entries(LEGACY)) {
    await sharp(iconBuf).resize(sz, sz, { fit: 'fill' }).webp({ quality: 95 })
      .toFile(path.join(RES, `mipmap-${dpi}`, 'ic_launcher.webp'));
    const round = await roundMask(iconBuf, sz);
    await sharp(round).webp({ quality: 95 })
      .toFile(path.join(RES, `mipmap-${dpi}`, 'ic_launcher_round.webp'));
  }
  for (const [dpi, sz] of Object.entries(FOREGROUND)) {
    await sharp(fgBuf).resize(sz, sz, { fit: 'fill' }).webp({ quality: 95 })
      .toFile(path.join(RES, `mipmap-${dpi}`, 'ic_launcher_foreground.webp'));
  }
  console.log('wrote native android mipmaps');
}

(async () => {
  // icon.png: opaque near-black tile, wordmark fills more of the tile.
  await build({ outPath: OUT_ICON, opaque: true, padRatio: 0.20 });
  // adaptive-icon.png: transparent (launcher fills bg); padded into the Android
  // safe zone so the launcher mask never clips the wordmark.
  await build({ outPath: OUT_ADAPTIVE, opaque: false, padRatio: 0.40 });
  await writeNative();
})().catch((e) => { console.error(e); process.exit(1); });
