const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const binName = process.platform === 'win32' ? 'patch-package.cmd' : 'patch-package';
const localBin = path.join(__dirname, '..', 'node_modules', '.bin', binName);

if (!fs.existsSync(localBin)) {
  // This repo is sometimes installed with `NODE_ENV=production`, which skips devDependencies.
  // Don't fail the install in that case.
  console.warn('[postinstall] patch-package not installed; skipping.');
  process.exit(0);
}

try {
  execSync(`"${localBin}"`, { stdio: 'inherit' });
} catch (error) {
  // Preserve non-zero exit code so patch failures remain visible when patch-package exists.
  process.exit(typeof error?.status === 'number' ? error.status : 1);
}
