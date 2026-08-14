'use strict';

/**
 * Backfill Alex stock posts:
 * 1) Expand profileCategories shelves
 * 2) Fix title/caption/description/categoryId from local stockPath
 * 3) Re-encode non-9:16 (or any not yet stockNormalized916) via local file → pad 1080x1920 → replace media URLs
 *
 * Freeze-safe: encode-side letterbox only (does not edit src/feed/**).
 *
 * Usage:
 *   NODE_PATH=./node_modules GOOGLE_APPLICATION_CREDENTIALS=<sa.json> \
 *     node tools/admin/backfill_stock_framing_meta.js \
 *     --dir "C:/Users/Alex/Downloads/BlypStockUploads" \
 *     --uid 26522274-e001-70aa-51b6-bcbbdffc43bb \
 *     [--meta-only] [--media-only] [--limit N] [--concurrency 2]
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

const ROOT = arg('dir', 'C:/Users/Alex/Downloads/BlypStockUploads');
const UID = arg('uid', '26522274-e001-70aa-51b6-bcbbdffc43bb');
const LIMIT = Number(arg('limit', '0')) || 0;
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '2')) || 2);
const META_ONLY = hasFlag('meta-only');
const MEDIA_ONLY = hasFlag('media-only');
const DRY = hasFlag('dry-run');
const FORCE_MEDIA = hasFlag('force-media');
const CONVERT_DIR = arg('convert-dir', path.join(ROOT, '_converted'));
const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'blyp-master.firebasestorage.app';

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!admin.apps.length) {
  admin.initializeApp({
    credential: saPath && fs.existsSync(saPath)
      ? admin.credential.cert(require(saPath))
      : admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
    storageBucket: STORAGE_BUCKET,
  });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

function resolveLocal(stockPath, stockPack) {
  if (!stockPath && !stockPack) return null;
  const rel = String(stockPath || '');
  const base = path.basename(rel);
  const candidates = [
    path.join(ROOT, rel),
    path.join(ROOT, rel.replace(/\//g, path.sep)),
    path.join(ROOT, rel.replace(/\\/g, path.sep)),
    path.join(ROOT, 'ready', base),
    path.join(ROOT, 'horror', base),
    path.join(ROOT, 'kids', base),
    stockPack ? path.join(ROOT, String(stockPack), base) : null,
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).size > 50 * 1024) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function probeVideo(srcPath) {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,sample_aspect_ratio', '-of', 'json', srcPath],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout || '{}');
    const s = (j.streams && j.streams[0]) || {};
    return { width: Number(s.width) || 0, height: Number(s.height) || 0, sar: s.sample_aspect_ratio || '1:1' };
  } catch {
    return null;
  }
}

function needsPad(probe) {
  // Only re-encode when aspect/SAR would stretch or force aggressive cover crop.
  // Exact 9:16 at 720x1280 is fine for cover — skip heavy re-encode.
  if (!probe || !probe.width || !probe.height) return true;
  const ratio = probe.width / probe.height;
  if (Math.abs(ratio - 9 / 16) > 0.02) return true;
  if (probe.sar && probe.sar !== 'N/A' && probe.sar !== '1:1' && probe.sar !== '1/1') return true;
  return false;
}

function normalizeTo916(srcPath) {
  fs.mkdirSync(CONVERT_DIR, { recursive: true });
  const key = crypto.createHash('sha1').update(`backfill:${srcPath}`).digest('hex').slice(0, 12);
  const dest = path.join(CONVERT_DIR, `v916_${key}.mp4`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 50 * 1024) {
    const p = probeVideo(dest);
    if (p && p.width === 1080 && p.height === 1920) return dest;
  }
  const vf =
    "scale=1080:1920:force_original_aspect_ratio=decrease," +
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black," +
    "setsar=1,format=yuv420p";
  const r = spawnSync(
    'ffmpeg',
    [
      '-y', '-i', srcPath,
      '-vf', vf,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', '+faststart',
      dest,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0 || !fs.existsSync(dest) || fs.statSync(dest).size < 50 * 1024) {
    throw new Error(`ffmpeg failed: ${(r.stderr || r.stdout || '').slice(-400)}`);
  }
  return dest;
}

function thumbFromVideo(mp4Path) {
  fs.mkdirSync(CONVERT_DIR, { recursive: true });
  const dest = path.join(CONVERT_DIR, `thumb_${crypto.createHash('sha1').update(mp4Path).digest('hex').slice(0, 10)}.jpg`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) return dest;
  const r = spawnSync('ffmpeg', ['-y', '-ss', '0.5', '-i', mp4Path, '-frames:v', '1', '-q:v', '3', dest], { encoding: 'utf8' });
  if (r.status !== 0 || !fs.existsSync(dest)) return null;
  return dest;
}

async function uploadAndGetUrl(destPath, bytes, contentType) {
  const token = crypto.randomUUID();
  await bucket.file(destPath).save(bytes, {
    contentType,
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
    resumable: false,
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destPath)}?alt=media&token=${token}`;
}

async function fetchAllStockPosts(uid) {
  const out = [];
  let last = null;
  for (;;) {
    let q = db.collection('posts').where('userId', '==', uid).orderBy(admin.firestore.FieldPath.documentId()).limit(300);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const p = doc.data() || {};
      if (p.importedVia || p.stockPath || p.stockPack || p.sourcePlatform === 'local-stock') {
        out.push({ id: doc.id, ref: doc.ref, data: p });
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 300) break;
  }
  return out;
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

async function main() {
  console.log(`[backfill] uid=${UID} dir=${ROOT} metaOnly=${META_ONLY} mediaOnly=${MEDIA_ONLY} dry=${DRY}`);
  if (!DRY) {
    await db.collection('users').doc(UID).set({ profileCategories: STOCK_PROFILE_CATEGORIES }, { merge: true });
    console.log(`[backfill] profileCategories → ${STOCK_PROFILE_CATEGORIES.map((c) => c.label).join(', ')}`);
  }

  const posts = await fetchAllStockPosts(UID);
  console.log(`[backfill] stock posts=${posts.length}`);

  let metaUpdated = 0;
  let mediaUpdated = 0;
  let mediaSkippedOk = 0;
  let mediaMissingLocal = 0;
  let mediaFailed = 0;
  const kindCounts = {};

  // --- metadata pass (fast) ---
  if (!MEDIA_ONLY) {
    let batch = db.batch();
    let ops = 0;
    const flush = async () => {
      if (!ops || DRY) { ops = 0; batch = db.batch(); return; }
      await batch.commit();
      batch = db.batch();
      ops = 0;
    };
    for (const post of posts) {
      const p = post.data;
      const local = resolveLocal(p.stockPath, p.stockPack);
      const metaPath = local || p.stockPath || `${p.stockPack || 'stock'}/${p.title || 'clip'}`;
      const meta = topicMetaForPath(metaPath);
      kindCounts[meta.kind] = (kindCounts[meta.kind] || 0) + 1;
      const patch = {
        title: meta.title,
        caption: meta.caption,
        description: meta.description,
        transcript: meta.transcript,
        categoryId: meta.categoryId,
        category: meta.category,
        topic: meta.topic,
        hashtags: meta.hashtags,
        tags: meta.hashtags,
        stockKind: meta.kind,
        stockPack: meta.stockPack,
        categoryEditedAt: Date.now(),
        metaBackfilledAt: Date.now(),
        mediaDisplay: p.mediaDisplay || { fitMode: 'contain', scale: 1, offsetX: 0, offsetY: 0 },
      };
      const changed =
        p.title !== patch.title ||
        p.description !== patch.description ||
        p.categoryId !== patch.categoryId ||
        p.stockKind !== patch.stockKind;
      if (!changed) continue;
      metaUpdated += 1;
      if (!DRY) {
        batch.set(post.ref, patch, { merge: true });
        ops += 1;
        if (ops >= 400) await flush();
      }
    }
    await flush();
    console.log(`[backfill] metaUpdated=${metaUpdated}`);
  }

  // --- media normalize pass ---
  if (!META_ONLY) {
    let candidates = posts.filter((post) => {
      if (FORCE_MEDIA) return true;
      if (post.data.stockNormalized916 === true) return false;
      return true;
    });
    // Prefer landscape / wrong-aspect local files first
    candidates = candidates
      .map((post) => {
        const local = resolveLocal(post.data.stockPath, post.data.stockPack);
        const probe = local ? probeVideo(local) : null;
        let score = 0;
        if (!local) score = 0;
        else if (needsPad(probe)) score = probe && probe.width > probe.height ? 3 : 2;
        else if (!post.data.stockNormalized916) score = 1; // mark-only
        return { post, local, probe, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (LIMIT > 0) candidates = candidates.slice(0, LIMIT);
    console.log(`[backfill] media candidates=${candidates.length} concurrency=${CONCURRENCY}`);

    await mapPool(candidates, CONCURRENCY, async ({ post, local, probe, score }) => {
      if (!local) {
        mediaMissingLocal += 1;
        return;
      }
      if (!FORCE_MEDIA && score === 1 && probe && !needsPad(probe) && post.data.stockNormalized916) {
        mediaSkippedOk += 1;
        return;
      }
      // Already correct 9:16 aspect — mark normalized without re-upload
      if (!FORCE_MEDIA && probe && !needsPad(probe)) {
        if (!DRY) {
          await post.ref.set({
            stockNormalized916: true,
            mediaWidth: probe.width || null,
            mediaHeight: probe.height || null,
            mediaDisplay: { fitMode: 'contain', scale: 1, offsetX: 0, offsetY: 0 },
          }, { merge: true });
        }
        mediaSkippedOk += 1;
        return;
      }
      try {
        if (DRY) {
          console.log(`  DRY media ${post.id} ${post.data.stockPath} probe=${probe ? `${probe.width}x${probe.height}` : '?'}`);
          mediaUpdated += 1;
          return;
        }
        const mp4 = normalizeTo916(local);
        const thumb = thumbFromVideo(mp4);
        const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const videoUrl = await uploadAndGetUrl(
          `users/${UID}/media/stock-reframe-${stamp}.mp4`,
          fs.readFileSync(mp4),
          'video/mp4',
        );
        let thumbnailUrl = post.data.thumbnail || null;
        if (thumb) {
          thumbnailUrl = await uploadAndGetUrl(
            `users/${UID}/thumbnails/stock-reframe-${stamp}.jpg`,
            fs.readFileSync(thumb),
            'image/jpeg',
          );
        }
        await post.ref.set({
          videoUrl,
          mediaUrl: videoUrl,
          thumbnail: thumbnailUrl,
          media: [{ url: videoUrl, type: 'video', thumbnail: thumbnailUrl, width: 1080, height: 1920 }],
          mediaWidth: 1080,
          mediaHeight: 1920,
          stockNormalized916: true,
          stockReframedAt: Date.now(),
          stockProbeBefore: probe || null,
          mediaDisplay: { fitMode: 'contain', scale: 1, offsetX: 0, offsetY: 0 },
        }, { merge: true });
        mediaUpdated += 1;
        console.log(`  MEDIA ${post.id} ${post.data.stockPath} ${probe ? `${probe.width}x${probe.height}` : '?'} → 1080x1920`);
      } catch (e) {
        mediaFailed += 1;
        console.error(`  FAIL media ${post.id}:`, e.message || e);
      }
    });
  }

  console.log(JSON.stringify({
    metaUpdated,
    mediaUpdated,
    mediaSkippedOk,
    mediaMissingLocal,
    mediaFailed,
    kindCounts,
    categories: STOCK_PROFILE_CATEGORIES.map((c) => `${c.label} (${c.id})`),
  }, null, 2));
}

main().catch((e) => {
  console.error('[backfill] fatal', e);
  process.exit(1);
});
