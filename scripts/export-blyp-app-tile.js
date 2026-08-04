/**
 * Export a copy of the Blyp home-screen app tile:
 * black rounded square + white "blyp" + tight teal pulse.
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'assets', 'brand');
const TEAL = '#00D2BE';
const BG = '#0A0A0C';
const LIGHT = '#F5F5F7';
const SIZE = 1024;
/** Android-like rounded tile corner radius (~22%). */
const RADIUS = Math.round(SIZE * 0.22);

async function measureTextBBox(fontSize, letterSpacing) {
  const pad = 64;
  const svg = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600" viewBox="0 0 1600 600">
  <text x="${pad}" y="400"
    font-family="Arial Black, Arial, Helvetica, sans-serif"
    font-weight="900"
    font-size="${fontSize}"
    letter-spacing="${letterSpacing}"
    fill="${LIGHT}">blyp</text>
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
    top: minY * scale,
    width: (maxX - minX + 1) * scale,
    height: (maxY - minY + 1) * scale,
    pad,
  };
}

async function main() {
  fs.mkdirSync(dir, { recursive: true });

  const fontSize = 210;
  const letterSpacing = -10;
  const m = await measureTextBBox(fontSize, letterSpacing);

  const pulseR = fontSize * 0.095;
  const pulseD = pulseR * 2;
  const gap = pulseD * 0.02;

  const contentW = m.width + gap + pulseD;
  const contentH = Math.max(m.height, pulseD);
  // Keep mark inside rounded corners (matches launcher safe zone).
  const safe = SIZE * 0.16;
  const usable = SIZE - safe * 2;
  const s = Math.min(usable / contentW, usable / contentH);

  const markW = contentW * s;
  const markH = contentH * s;
  const originX = (SIZE - markW) / 2;
  const originY = (SIZE - markH) / 2;
  const textX = originX - m.left * s + m.pad * s;
  const textY = originY - m.top * s + 400 * s;
  const textRight = originX + m.width * s;
  const pulseCx = textRight + gap * s + pulseR * s;
  const pulseCy = originY + markH * 0.42;

  const tileSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="${BG}"/>
  <text x="${textX.toFixed(2)}" y="${textY.toFixed(2)}"
    font-family="Arial Black, Arial, Helvetica, sans-serif"
    font-weight="900"
    font-size="${(fontSize * s).toFixed(2)}"
    letter-spacing="${(letterSpacing * s).toFixed(2)}"
    fill="${LIGHT}">blyp</text>
  <circle cx="${pulseCx.toFixed(2)}" cy="${pulseCy.toFixed(2)}" r="${(pulseR * s).toFixed(2)}" fill="${TEAL}"/>
</svg>
`;

  const svgPath = path.join(dir, 'blyp-app-tile.svg');
  fs.writeFileSync(svgPath, tileSvg, 'utf8');

  const mask = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="white"/>
</svg>`);

  // Rounded tile with transparent corners (true app-tile shape).
  const raster = await sharp(Buffer.from(tileSvg), { density: 300 })
    .resize(SIZE, SIZE)
    .png()
    .toBuffer();

  await sharp(raster)
    .composite([{ input: await sharp(mask).png().toBuffer(), blend: 'dest-in' }])
    .png()
    .toFile(path.join(dir, 'blyp-app-tile.png'));

  await sharp(path.join(dir, 'blyp-app-tile.png'))
    .resize(512, 512)
    .png()
    .toFile(path.join(dir, 'blyp-app-tile-512.png'));

  // Full opaque square (no transparent corners) if needed.
  await sharp(Buffer.from(tileSvg.replace(/rx="\d+" ry="\d+"/, 'rx="0" ry="0"')), {
    density: 300,
  })
    .resize(SIZE, SIZE)
    .png()
    .toFile(path.join(dir, 'blyp-app-tile-square.png'));

  console.log('wrote', {
    tile: 'assets/brand/blyp-app-tile.png',
    tile512: 'assets/brand/blyp-app-tile-512.png',
    square: 'assets/brand/blyp-app-tile-square.png',
    gapPx: +(gap * s).toFixed(1),
    pulseD: +(pulseD * s).toFixed(1),
    radius: RADIUS,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
