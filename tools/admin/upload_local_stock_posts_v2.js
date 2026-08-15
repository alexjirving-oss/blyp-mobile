'use strict';

/**
 * Upload local stock videos as For You–eligible posts for an owner account.
 *
 * Freeze-safe framing: always ffmpeg pad/letterbox to 1080x1920 (9:16) + setsar=1
 * before upload so cover players are not stretched / over-cropped.
 *
 * Usage (from tip, with NODE_PATH=./node_modules):
 *   GOOGLE_APPLICATION_CREDENTIALS=<sa.json> node tools/admin/upload_local_stock_posts_v2.js \
 *     --dir "C:/Users/Alex/Downloads/BlypStockUploads" \
 *     --uid <ownerUid> [--watch] [--limit N] [--concurrency 2]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const admin = require('firebase-admin');
const {
  STOCK_PROFILE_CATEGORIES,
  topicMetaForPath,
} = require('./stockCategories');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const ROOT = arg('dir');
const UID = arg('uid');
const LIMIT = Number(arg('limit', '0')) || 0;
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '2')) || 2);
const WATCH = hasFlag('watch');
const WATCH_MS = Number(arg('watch-ms', '20000')) || 20000;
const DRY = hasFlag('dry-run');
const SKIP_NORMALIZE = hasFlag('skip-normalize');
const SKIP_PROFILE_CATEGORIES = hasFlag('skip-profile-categories');
const SOURCE_PLATFORM = arg('source-platform', 'local-stock');
const IMPORTED_VIA = arg('imported-via', 'upload_local_stock_posts_v2');
const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'blyp-master.firebasestorage.app';
const MANIFEST = arg('manifest', path.join(ROOT || '.', '_upload_manifest.json'));
const CONVERT_DIR = arg('convert-dir', path.join(ROOT || '.', '_converted'));

if (!ROOT || !UID) {
  console.error('Required: --dir <stockRoot> --uid <ownerUid>');
  process.exit(2);
}

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credential = saPath && fs.existsSync(saPath)
  ? admin.credential.cert(require(saPath))
  : admin.credential.applicationDefault();

if (!admin.apps.length) {
  admin.initializeApp({ credential, projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv']);
// `tiktok` = creator TikTok→Blyp imports (separate --uid uploads); never stock-owner walk.
const SKIP_DIR_PARTS = new Set(['_converted', 'node_modules', '.git', 'ChromeCookies_copy', '_ytdlp_test', 'tiktok']);

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  } catch {
    return { uploaded: {}, failed: {}, skipped: {} };
  }
}
function saveManifest(m) {
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}

function fileHash(p) {
  const h = crypto.createHash('sha1');
  h.update(fs.readFileSync(p));
  return h.digest('hex');
}

function listVideos(root) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIR_PARTS.has(ent.name) || ent.name === 'MadFightingTest') continue;
        if (/mad\s*scientist|gift\s*alert|stream\s*alert/i.test(ent.name)) continue;
        walk(full);
        continue;
      }
      const ext = path.extname(ent.name).toLowerCase();
      if (!VIDEO_EXT.has(ext)) continue;
      if (/\.crdownload$|\.part$|\.tmp$/i.test(ent.name)) continue;
      try {
        const st = fs.statSync(full);
        if (st.size < 50 * 1024) continue;
        out.push({ path: full, size: st.size, mtimeMs: st.mtimeMs, ext });
      } catch {
        /* ignore */
      }
    }
  }
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function probeVideo(srcPath) {
  const r = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,sample_aspect_ratio,display_aspect_ratio:stream_tags=rotate:format_tags=rotate',
      '-of', 'json',
      srcPath,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout || '{}');
    const s = (j.streams && j.streams[0]) || {};
    const rot = Number(s.tags?.rotate || j.format?.tags?.rotate || 0) || 0;
    let w = Number(s.width) || 0;
    let h = Number(s.height) || 0;
    if (Math.abs(rot) === 90 || Math.abs(rot) === 270) {
      const t = w; w = h; h = t;
    }
    return { width: w, height: h, sar: s.sample_aspect_ratio || '1:1', rot };
  } catch {
    return null;
  }
}

function needsNormalize(probe) {
  if (!probe || !probe.width || !probe.height) return true;
  const ratio = probe.width / probe.height;
  const target = 9 / 16;
  if (Math.abs(ratio - target) > 0.02) return true;
  if (probe.sar && probe.sar !== 'N/A' && probe.sar !== '1:1' && probe.sar !== '1/1') return true;
  // Still normalize non-1080x1920 so cover framing is consistent (letterbox already baked).
  if (probe.width !== 1080 || probe.height !== 1920) return true;
  return false;
}

/**
 * Pad/letterbox to 1080x1920, square pixels, h264+aac. Always used for stock
 * (even existing .mp4) so For You cover does not stretch landscape / odd SAR.
 */
function normalizeTo916(srcPath) {
  fs.mkdirSync(CONVERT_DIR, { recursive: true });
  const key = crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 12);
  const dest = path.join(CONVERT_DIR, `v916_${key}.mp4`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 50 * 1024) {
    const p = probeVideo(dest);
    if (p && p.width === 1080 && p.height === 1920) return dest;
  }
  const vf =
    "scale=1080:1920:force_original_aspect_ratio=decrease," +
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black," +
    "setsar=1,format=yuv420p";
  const args = [
    '-y', '-i', srcPath,
    '-vf', vf,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    dest,
  ];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size < 50 * 1024) {
    throw new Error(`ffmpeg normalize failed: ${(r.stderr || r.stdout || '').slice(-500)}`);
  }
  return dest;
}

function ensureUploadMp4(srcPath, ext) {
  if (SKIP_NORMALIZE) {
    if (ext === '.mp4') return srcPath;
    fs.mkdirSync(CONVERT_DIR, { recursive: true });
    const base = path.basename(srcPath, ext).replace(/[^\w\-]+/g, '_').slice(0, 80);
    const dest = path.join(CONVERT_DIR, `${base}_${crypto.createHash('sha1').update(srcPath).digest('hex').slice(0, 8)}.mp4`);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 50 * 1024) return dest;
    const args = [
      '-y', '-i', srcPath,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      dest,
    ];
    const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
    if (r.status !== 0 || !fs.existsSync(dest)) {
      throw new Error(`ffmpeg failed: ${(r.stderr || r.stdout || '').slice(-400)}`);
    }
    return dest;
  }
  return normalizeTo916(srcPath);
}

function thumbFromVideo(mp4Path) {
  fs.mkdirSync(CONVERT_DIR, { recursive: true });
  const dest = path.join(
    CONVERT_DIR,
    `${path.basename(mp4Path, '.mp4')}_${crypto.createHash('sha1').update(mp4Path).digest('hex').slice(0, 8)}.jpg`,
  );
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) return dest;
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-ss', '0.5', '-i', mp4Path, '-frames:v', '1', '-q:v', '3', dest],
    { encoding: 'utf8' },
  );
  if (r.status !== 0 || !fs.existsSync(dest)) return null;
  return dest;
}

async function uploadAndGetUrl(destPath, bytes, contentType) {
  const token = crypto.randomUUID();
  const file = bucket.file(destPath);
  await file.save(bytes, {
    contentType,
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
    resumable: false,
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destPath)}?alt=media&token=${token}`;
}

async function ensureProfileCategories(uid) {
  await db.collection('users').doc(uid).set(
    { profileCategories: STOCK_PROFILE_CATEGORIES },
    { merge: true },
  );
}

async function loadOwner(uid) {
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) throw new Error(`users/${uid} missing`);
  const d = doc.data() || {};
  return {
    uid,
    username: d.username || d.handle || d.displayName || 'Alex',
    displayName: d.displayName || d.name || d.username || 'Alex',
    handle: d.handle || d.username || 'Alex',
    photoURL: d.photoURL || d.avatar || null,
    email: d.email || null,
  };
}

async function uploadOne(owner, item, manifest) {
  const key = path.resolve(item.path);
  if (manifest.uploaded[key]) return { status: 'skipped', reason: 'already-uploaded', postId: manifest.uploaded[key].postId };

  const s1 = fs.statSync(item.path).size;
  await new Promise((r) => setTimeout(r, 400));
  const s2 = fs.statSync(item.path).size;
  if (s1 !== s2) return { status: 'deferred', reason: 'size-changing' };

  const hash = fileHash(item.path);
  const already = Object.values(manifest.uploaded).find((v) => v.hash === hash);
  if (already) {
    manifest.skipped[key] = { hash, postId: already.postId, at: Date.now() };
    saveManifest(manifest);
    return { status: 'skipped', reason: 'dup-hash', postId: already.postId };
  }

  if (DRY) return { status: 'dry-run', path: item.path };

  const meta = topicMetaForPath(item.path);
  const probe = probeVideo(item.path);
  const mp4 = ensureUploadMp4(item.path, item.ext);
  const thumbPath = thumbFromVideo(mp4);
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const videoUrl = await uploadAndGetUrl(
    `users/${owner.uid}/media/stock-${stamp}.mp4`,
    fs.readFileSync(mp4),
    'video/mp4',
  );
  let thumbnailUrl = null;
  if (thumbPath) {
    thumbnailUrl = await uploadAndGetUrl(
      `users/${owner.uid}/thumbnails/stock-${stamp}.jpg`,
      fs.readFileSync(thumbPath),
      'image/jpeg',
    );
  }

  const isCreatorImport = SOURCE_PLATFORM === 'tiktok' || SOURCE_PLATFORM === 'youtube';
  const metaTitle = (() => {
    // Prefer adjacent yt-dlp .info.json title when present.
    try {
      const infoPath = item.path.replace(/\.[^.]+$/, '') + '.info.json';
      if (fs.existsSync(infoPath)) {
        const j = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        const t = String(j.title || j.fulltitle || j.description || '').trim();
        if (t) return t.slice(0, 120);
      }
    } catch { /* fall through */ }
    return meta.title;
  })();
  const tags = Array.from(
    new Set(
      [
        ...(meta.hashtags || []),
        isCreatorImport ? SOURCE_PLATFORM : meta.kind,
        isCreatorImport ? 'import' : 'stock',
        'foryou',
      ].filter(Boolean),
    ),
  );
  const ref = await db.collection('posts').add({
    userId: owner.uid,
    username: owner.username,
    userDisplayName: owner.displayName,
    userPhotoURL: owner.photoURL,
    user: { username: owner.handle, avatar: owner.photoURL },
    title: metaTitle,
    caption: metaTitle,
    description: meta.description,
    transcript: meta.transcript,
    tags,
    hashtags: tags,
    category: meta.category,
    topic: meta.topic,
    categoryId: meta.categoryId || null,
    emoji: '🎬',
    type: 'video',
    videoUrl,
    mediaUrl: videoUrl,
    imageUrl: null,
    audioUrl: null,
    thumbnail: thumbnailUrl,
    media: [{ url: videoUrl, type: 'video', thumbnail: thumbnailUrl, width: 1080, height: 1920 }],
    mediaWidth: 1080,
    mediaHeight: 1920,
    stockNormalized916: true,
    mediaDisplay: { fitMode: 'contain', scale: 1, offsetX: 0, offsetY: 0 },
    publishStatus: 'live',
    publishAt: Date.now(),
    likes: 0,
    likeCount: 0,
    comments: 0,
    commentCount: 0,
    shares: 0,
    viewCount: 0,
    views: 0,
    sourcePlatform: SOURCE_PLATFORM,
    importedVia: IMPORTED_VIA,
    stockPack: isCreatorImport ? null : meta.stockPack,
    stockKind: isCreatorImport ? null : meta.kind,
    stockPath: path.relative(ROOT, item.path),
    stockHash: hash,
    stockProbe: probe || null,
    date: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  manifest.uploaded[key] = {
    postId: ref.id,
    hash,
    pack: meta.stockPack,
    kind: meta.kind,
    videoUrl,
    normalized916: true,
    at: Date.now(),
    size: item.size,
  };
  saveManifest(manifest);
  return { status: 'ok', postId: ref.id, videoUrl, caption: meta.title, kind: meta.kind };
}

async function mapPool(items, concurrency, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function runPass(owner, manifest) {
  const videos = listVideos(ROOT);
  const pending = videos.filter((v) => !manifest.uploaded[path.resolve(v.path)]);
  const batch = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  console.log(`[stock-upload] found=${videos.length} pending=${pending.length} batch=${batch.length} concurrency=${CONCURRENCY} normalize=${!SKIP_NORMALIZE}`);
  if (!batch.length) return { ok: 0, fail: 0, skip: 0, defer: 0, samples: [] };

  let ok = 0; let fail = 0; let skip = 0; let defer = 0;
  const samples = [];
  await mapPool(batch, CONCURRENCY, async (item) => {
    const label = path.relative(ROOT, item.path);
    try {
      const res = await uploadOne(owner, item, manifest);
      if (res.status === 'ok') {
        ok += 1;
        if (samples.length < 12) samples.push({ postId: res.postId, caption: res.caption, kind: res.kind, path: label });
        console.log(`  OK  [${res.kind}] ${label} -> ${res.postId}`);
      } else if (res.status === 'skipped' || res.status === 'dry-run') {
        skip += 1;
        console.log(`  SKIP ${label} (${res.reason || res.status})`);
      } else if (res.status === 'deferred') {
        defer += 1;
        console.log(`  DEFER ${label}`);
      }
    } catch (e) {
      fail += 1;
      manifest.failed[path.resolve(item.path)] = { error: String(e.message || e).slice(0, 300), at: Date.now() };
      saveManifest(manifest);
      console.error(`  FAIL ${label}:`, e.message || e);
    }
  });
  return { ok, fail, skip, defer, samples };
}

async function main() {
  const owner = await loadOwner(UID);
  console.log(`[stock-upload] owner=${owner.email || owner.uid} username=${owner.username}`);
  console.log(`[stock-upload] dir=${ROOT} manifest=${MANIFEST}`);
  if (!SKIP_PROFILE_CATEGORIES) {
    await ensureProfileCategories(UID);
    console.log(`[stock-upload] profileCategories=${STOCK_PROFILE_CATEGORIES.length} shelves`);
  } else {
    console.log('[stock-upload] skip-profile-categories=1');
  }
  const manifest = loadManifest();

  let totalOk = 0; let totalFail = 0; const allSamples = [];
  do {
    const pass = await runPass(owner, manifest);
    totalOk += pass.ok;
    totalFail += pass.fail;
    allSamples.push(...pass.samples);
    console.log(`[stock-upload] pass ok=${pass.ok} fail=${pass.fail} skip=${pass.skip} defer=${pass.defer}`);
    if (!WATCH) break;
    if (pass.ok === 0 && pass.fail === 0 && pass.defer === 0) {
      console.log(`[stock-upload] idle, sleeping ${WATCH_MS}ms…`);
    }
    await new Promise((r) => setTimeout(r, WATCH_MS));
  } while (WATCH);

  console.log(JSON.stringify({
    summary: { ok: totalOk, fail: totalFail, uploadedTotal: Object.keys(manifest.uploaded).length },
    samples: allSamples.slice(0, 12),
    categories: STOCK_PROFILE_CATEGORIES.map((c) => c.label),
    auth: { path: 'firebase-admin SA + Firestore posts', ownerUid: owner.uid, ownerEmail: owner.email },
  }, null, 2));
}

main().catch((e) => {
  console.error('[stock-upload] fatal', e);
  process.exit(1);
});
