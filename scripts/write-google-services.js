#!/usr/bin/env node
/**
 * Inject google-services.json for EAS Build when the file is not committed.
 * Strategy:
 * 1. If a physical google-services.json exists at project root, do nothing.
 * 2. Else if env GOOGLE_SERVICES_JSON_BASE64 provided, decode and write it.
 * 3. Else log a clear warning so build fails early with actionable guidance.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(process.cwd(), 'google-services.json');
if (fs.existsSync(target)) {
  console.log('[inject-google-services] google-services.json already present.');
  process.exit(0);
}

const b64 = process.env.GOOGLE_SERVICES_JSON_BASE64;
if (!b64) {
  console.warn('[inject-google-services] Missing google-services.json and GOOGLE_SERVICES_JSON_BASE64 env var.');
  console.warn('Add file to repo OR set an EAS env var with base64 contents of google-services.json');
  process.exit(0); // allow subsequent plugin to surface error
}
try {
  const decoded = Buffer.from(b64, 'base64').toString('utf8');
  // Basic validation: must parse JSON and contain project_info or client.
  const json = JSON.parse(decoded);
  if (!json.project_info && !json.client) {
    console.warn('[inject-google-services] Decoded content missing expected keys (project_info/client). Writing anyway.');
  }
  fs.writeFileSync(target, decoded, { encoding: 'utf8' });
  console.log('[inject-google-services] google-services.json written from env variable.');
} catch (e) {
  console.error('[inject-google-services] Failed to decode/write google-services.json:', e.message);
  process.exit(1);
}
