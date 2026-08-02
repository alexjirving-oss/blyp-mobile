/**
 * Windows can transiently lock functions/lib/*.js during concurrent IDE/tsc use.
 * Retry a few times so accountability stop gates do not flake on TS5033.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const maxAttempts = 3;
const delayMs = 750;
let lastStatus = 1;

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc'],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      shell: process.platform === 'win32',
      env: process.env,
    },
  );
  lastStatus = result.status == null ? 1 : result.status;
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  process.stdout.write(stdout);
  process.stderr.write(stderr);

  if (lastStatus === 0) {
    process.exit(0);
  }

  const combined = `${stdout}\n${stderr}`;
  const locked =
    combined.includes('TS5033') ||
    /UNKNOWN:\s*unknown error,\s*open/i.test(combined) ||
    /EBUSY|EPERM|EACCES/i.test(combined);

  if (!locked || attempt === maxAttempts) {
    process.exit(lastStatus);
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs * attempt);
}

process.exit(lastStatus);
