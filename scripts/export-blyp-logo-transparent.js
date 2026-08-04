/**
 * Export Blyp brand cutouts with tight pulse spacing (period-like).
 * Primary deliverable: square transparent app tile matching launcher icon.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'assets', 'brand');
const TEAL = '#00D2BE';
const DARK = '#0A0A0C';
const LIGHT = '#F5F5F7';

/** Gap between glyph right edge and pulse left edge, as fraction of pulse diameter. */
const GAP_FRAC = 0.02;

async function measureTextBBox(fill, fontSize, letterSpacing) {
  const pad = 64;
  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600">
  <text x="${pad}" y="400"
    font-family="Arial Black, Arial, Helvetica, sans-serif"
    font-weight="900"
    font-size="${fontSize}"
    letter-spacing="${letterSpacing}"
    fill="${fill}">blyp</text>
</svg>`);
  const { data, info } = await sharp(svg, { density: 144 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let maxX = 0;
  let minY = info.height;
  let maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      if (data[i + 3] > 20 && data[i] + data[i + 1] + data[i + 2] > 30) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const scale = 1600 / info.width;
  return {
    left: minX * scale,
    right: maxX * scale,
    top: minY * scale,
    bottom: maxY * scale,
    width: (maxX - minX + 1) * scale,
    height: (maxY - minY + 1) * scale,
    pad,
  };
}

function writeSvg(name, contents) {
  fs.writeFileSync(path.join(dir, `${name}.svg`), contents, 'utf8');
}

async function rasterSquare(name, size) {
  const svg = fs.readFileSync(path.join(dir, `${name}.svg`));
  await sharp(svg, { density: 300 })
    .resize({
      width: size,
      height: size,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(dir, size === 1024 ? `${name}.png` : `${name}-${size}.png`));
}

async function rasterWordmark(name) {
  const svg = fs.readFileSync(path.join(dir, `${name}.svg`));
  await sharp(svg, { density: 300 })
    .resize({
      width: 2048,
      height: 640,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(dir, `${name}.png`));
}

async function buildAppTile(fill) {
  const size = 1024;
  const fontSize = 210;
  const letterSpacing = -10;
  const m = await measureTextBBox(fill, fontSize, letterSpacing);

  // Pulse sized like in-app (~16% of type size), gap ~12% of diameter (near period).
  const pulseR = fontSize * 0.095;
  const pulseD = pulseR * 2;
  const gap = pulseD * GAP_FRAC;

  const contentW = m.width + gap + pulseD;
  const contentH = Math.max(m.height, pulseD);
  // Match shipping icon fill (~fill most of the square, leave a little margin).
  const safe = size * 0.08;
  const usable = size - safe * 2;
  const scale = Math.min(usable / contentW, usable / contentH) * 1.0;

  const markW = contentW * scale;
  const markH = contentH * scale;
  const originX = (size - markW) / 2;
  const originY = (size - markH) / 2;

  // Map measured text into tile space (measure used pad as text x).
  const textScale = scale;
  const textX = originX - m.left * textScale + m.pad * textScale;
  // Baseline: measure used y=400; align measured top to originY.
  const textY = originY - m.top * textScale + 400 * textScale;

  const textRight = originX + m.width * textScale;
  const pulseCx = textRight + gap * scale + pulseR * scale;
  const pulseCy = originY + markH * 0.42;

  const suffix = fill === LIGHT ? 'light' : 'dark';
  const name = `blyp-app-tile-transparent-${suffix === 'light' ? 'on-dark' : 'on-light'}`;
  // on-dark = light letters (for dark backgrounds); on-light = dark letters
  const tileName =
    fill === LIGHT ? 'blyp-app-tile-transparent' : 'blyp-app-tile-transparent-dark-ink';

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
  <text x="${textX.toFixed(2)}" y="${textY.toFixed(2)}"
    font-family="Arial Black, Arial, Helvetica, sans-serif"
    font-weight="900"
    font-size="${(fontSize * textScale).toFixed(2)}"
    letter-spacing="${(letterSpacing * textScale).toFixed(2)}"
    fill="${fill}">blyp</text>
  <circle cx="${pulseCx.toFixed(2)}" cy="${pulseCy.toFixed(2)}" r="${(pulseR * scale).toFixed(2)}" fill="${TEAL}"/>
</svg>
`;
  writeSvg(tileName, svg);
  await rasterSquare(tileName, 1024);
  await rasterSquare(tileName, 512);
  console.log('tile', tileName, {
    gapPx: +(gap * scale).toFixed(1),
    pulseD: +(pulseD * scale).toFixed(1),
    textRight: +textRight.toFixed(1),
    pulseCx: +pulseCx.toFixed(1),
  });
  return tileName;
}

async function buildWordmark(fill, name) {
  const fontSize = 200;
  const letterSpacing = -8;
  const m = await measureTextBBox(fill, fontSize, letterSpacing);
  const pulseR = fontSize * 0.095;
  const pulseD = pulseR * 2;
  const gap = pulseD * GAP_FRAC;

  const padX = 40;
  const padY = 48;
  const vbW = Math.ceil(padX + m.width + gap + pulseD + padX);
  const vbH = Math.ceil(padY + m.height + padY);

  const textX = padX - m.left + m.pad;
  const textY = padY - m.top + 400;
  const textRight = padX + m.width;
  const pulseCx = textRight + gap + pulseR;
  const pulseCy = padY + m.height * 0.42;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${vbW}" height="${vbH}" viewBox="0 0 ${vbW} ${vbH}" fill="none">
  <text x="${textX.toFixed(2)}" y="${textY.toFixed(2)}"
    font-family="Arial Black, Arial, Helvetica, sans-serif"
    font-weight="900"
    font-size="${fontSize}"
    letter-spacing="${letterSpacing}"
    fill="${fill}">blyp</text>
  <circle cx="${pulseCx.toFixed(2)}" cy="${pulseCy.toFixed(2)}" r="${pulseR.toFixed(2)}" fill="${TEAL}"/>
</svg>
`;
  writeSvg(name, svg);
  await rasterWordmark(name);
  console.log('wordmark', name, { vbW, vbH, gap: +gap.toFixed(1) });
}

async function alsoPunchExistingIcon() {
  // Transparent cutout of the shipping launcher icon (black → alpha).
  const src = path.join(__dirname, '..', 'assets', 'icon.png');
  const out = path.join(dir, 'blyp-app-tile-from-icon-punched.png');
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Near-black background → transparent; keep white letters + teal pulse.
    if (r < 28 && g < 28 && b < 28) {
      data[i + 3] = 0;
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(out);
  console.log('punched', path.basename(out));
}

async function main() {
  fs.mkdirSync(dir, { recursive: true });

  // Primary: square transparent app tiles (tight pulse).
  await buildAppTile(LIGHT);
  await buildAppTile(DARK);

  // Fixed wordmarks (no more cx=920 nonsense).
  await buildWordmark(DARK, 'blyp-logo-transparent-dark');
  await buildWordmark(LIGHT, 'blyp-logo-transparent-light');

  const mark = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
  <circle cx="256" cy="256" r="96" fill="${TEAL}"/>
</svg>`);
  await sharp(mark).png().toFile(path.join(dir, 'blyp-pulse-dot-transparent.png'));

  await alsoPunchExistingIcon();
  console.log('done →', dir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
