import fs from 'node:fs';
import path from 'node:path';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch (e) {
  console.error('Missing dependency: sharp');
  console.error('Install with: npm i -D sharp');
  process.exit(2);
}

const repoRoot = process.cwd();

const inputArg = process.argv[2];
const inputPath = inputArg
  ? path.resolve(repoRoot, inputArg)
  : path.resolve(repoRoot, 'assets', 'icon.png');

if (!fs.existsSync(inputPath)) {
  console.error(`Input icon not found: ${inputPath}`);
  console.error('Provide a path: node scripts/generate-android-launcher-icons.mjs assets/icon-source.png');
  process.exit(1);
}

const resRoot = path.resolve(repoRoot, 'android', 'app', 'src', 'main', 'res');

const launcherSizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const adaptiveForegroundSizes = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

async function writeWebp(outFile, size) {
  await sharp(inputPath)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 95 })
    .toFile(outFile);
}

async function main() {
  const tasks = [];

  for (const [dpi, size] of Object.entries(launcherSizes)) {
    const dir = path.join(resRoot, `mipmap-${dpi}`);
    if (!fs.existsSync(dir)) {
      console.warn(`Skipping missing dir: ${dir}`);
      continue;
    }

    tasks.push(writeWebp(path.join(dir, 'ic_launcher.webp'), size));
    tasks.push(writeWebp(path.join(dir, 'ic_launcher_round.webp'), size));
  }

  for (const [dpi, size] of Object.entries(adaptiveForegroundSizes)) {
    const dir = path.join(resRoot, `mipmap-${dpi}`);
    if (!fs.existsSync(dir)) {
      console.warn(`Skipping missing dir: ${dir}`);
      continue;
    }

    tasks.push(writeWebp(path.join(dir, 'ic_launcher_foreground.webp'), size));
  }

  await Promise.all(tasks);
  console.log('✅ Android launcher icons updated (ic_launcher/ic_launcher_round/ic_launcher_foreground).');
  console.log(`Source: ${inputPath}`);
}

main().catch((e) => {
  console.error('Icon generation failed:', e?.message || String(e));
  process.exit(1);
});
