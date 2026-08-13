#!/usr/bin/env node
/**
 * Direct Play Console AAB upload via resumable media (bypasses EAS Submit GCS).
 * Usage: node tools/release/upload_play_aab_direct.mjs <path-to.aab> [track=internal]
 */
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_NAME = 'com.blyp.mobile';
const aabPath = path.resolve(process.argv[2] || '');
const track = String(process.argv[3] || 'internal').trim() || 'internal';
const CHUNK = 8 * 1024 * 1024; // 8 MiB

if (!aabPath || !fs.existsSync(aabPath)) {
  console.error('Usage: node tools/release/upload_play_aab_direct.mjs <aab> [track]');
  process.exit(2);
}

function resolveKeyFile() {
  for (const c of [
    path.join(REPO_ROOT, 'android-service-account.json'),
    'C:\\keys\\eas-play-publisher.json',
  ]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Missing Play service account JSON');
}

async function apiJson(accessToken, url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

async function putChunk(sessionUri, chunk, offset, size, attempt = 1) {
  const end = offset + chunk.length - 1;
  try {
    const putRes = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${offset}-${end}/${size}`,
      },
      body: chunk,
    });
    return putRes;
  } catch (e) {
    if (attempt >= 5) throw e;
    const waitMs = 1000 * attempt * attempt;
    console.warn(`[play-upload] chunk ${offset} fetch failed (try ${attempt}): ${e.cause?.code || e.message}; retry in ${waitMs}ms`);
    await new Promise((r) => setTimeout(r, waitMs));
    return putChunk(sessionUri, chunk, offset, size, attempt + 1);
  }
}

async function queryOffset(sessionUri, size) {
  try {
    const res = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Length': '0',
        'Content-Range': `bytes */${size}`,
      },
    });
    if (res.status === 308) {
      const range = res.headers.get('range') || '';
      const m = /bytes=0-(\d+)/.exec(range);
      if (m) return Number(m[1]) + 1;
    }
  } catch {
    // ignore
  }
  return null;
}

async function resumableUpload(accessToken, editId, filePath) {
  const size = fs.statSync(filePath).size;
  const initUrl =
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/` +
    `${encodeURIComponent(PACKAGE_NAME)}/edits/${encodeURIComponent(editId)}/bundles?uploadType=resumable`;

  const initRes = await fetch(initUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/octet-stream',
      'X-Upload-Content-Length': String(size),
    },
    body: '{}',
  });
  if (!initRes.ok) {
    throw new Error(`resumable init failed: ${initRes.status} ${await initRes.text()}`);
  }
  const sessionUri = initRes.headers.get('location');
  if (!sessionUri) throw new Error('resumable init missing Location header');
  console.log(`[play-upload] resumable session ok size=${size}`);

  const fd = fs.openSync(filePath, 'r');
  try {
    let offset = 0;
    const buf = Buffer.allocUnsafe(CHUNK);
    while (offset < size) {
      const toRead = Math.min(CHUNK, size - offset);
      const read = fs.readSync(fd, buf, 0, toRead, offset);
      const chunk = Buffer.from(buf.subarray(0, read));
      const putRes = await putChunk(sessionUri, chunk, offset, size);
      const end = offset + read - 1;
      const pct = Math.floor(((end + 1) / size) * 100);
      if (putRes.status === 308) {
        if (pct % 5 === 0) console.log(`[play-upload] ${pct}% (${end + 1}/${size})`);
        offset += read;
        continue;
      }
      const text = await putRes.text();
      if (!putRes.ok) {
        const resumed = await queryOffset(sessionUri, size);
        if (resumed != null && resumed > offset) {
          console.warn(`[play-upload] server says resume at ${resumed} after ${putRes.status}`);
          offset = resumed;
          continue;
        }
        throw new Error(`chunk PUT failed ${putRes.status}: ${text.slice(0, 400)}`);
      }
      console.log(`[play-upload] 100% uploaded`);
      return JSON.parse(text);
    }
    throw new Error('upload ended without final 200');
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  const keyFile = resolveKeyFile();
  const auth = new GoogleAuth({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = token?.token || token;
  if (!accessToken) throw new Error('No access token');

  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}`;

  const editJson = await apiJson(accessToken, `${base}/edits`, { method: 'POST', body: {} });
  const editId = editJson.id;
  console.log(`[play-upload] editId=${editId}`);

  const upJson = await resumableUpload(accessToken, editId, aabPath);
  const versionCode = upJson.versionCode;
  console.log(`[play-upload] uploaded versionCode=${versionCode} sha1=${upJson.sha1}`);

  await apiJson(
    accessToken,
    `${base}/edits/${encodeURIComponent(editId)}/tracks/${encodeURIComponent(track)}`,
    {
      method: 'PUT',
      body: {
        track,
        releases: [
          {
            name: `1.0.93 (${versionCode})`,
            status: 'completed',
            versionCodes: [String(versionCode)],
          },
        ],
      },
    },
  );
  console.log(`[play-upload] track=${track} status=completed`);

  const commitJson = await apiJson(accessToken, `${base}/edits/${encodeURIComponent(editId)}:commit`, {
    method: 'POST',
  });
  console.log(`[play-upload] COMMITTED editId=${commitJson.id || editId}`);
  console.log(
    JSON.stringify({
      ok: true,
      package: PACKAGE_NAME,
      track,
      versionCode,
      aab: aabPath,
      playConsole: 'https://play.google.com/console/u/0/developers/5979146102509566368',
    }),
  );
}

main().catch((e) => {
  console.error('[play-upload] FAIL', e?.message || e);
  process.exit(1);
});
