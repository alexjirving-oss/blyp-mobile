/*
 * Blyp social-import worker.
 *
 * Fulfils the in-app "Bring your content" feature. The app writes a `pending`
 * request to the `socialImports` collection (see src/services/socialImportService.js
 * + src/screens/ImportContentScreen.js). This worker claims pending requests,
 * downloads the requester's public TikTok videos with yt-dlp, uploads them to
 * Firebase Storage, posts them onto the requester's profile (same schema as the
 * proven seed scripts), and streams progress back onto the request doc.
 *
 * It is intentionally a standalone worker (not a Cloud Function) because it
 * shells out to yt-dlp + needs disk. Run it on any box with credentials, or
 * containerise it for Cloud Run later. It loops forever, one job at a time.
 *
 * Prerequisites:
 *   ÔÇó yt-dlp on PATH                (https://github.com/yt-dlp/yt-dlp)
 *   ÔÇó ffmpeg on PATH (yt-dlp merges)
 *   ÔÇó Admin credentials, either:
 *       - GOOGLE_APPLICATION_CREDENTIALS=<path to service-account.json>, or
 *       - `gcloud auth application-default login` (uses your ADC)
 *
 * Env:
 *   PROJECT_ID      (default blyp-master)
 *   STORAGE_BUCKET  (default blyp-master.firebasestorage.app)
 *   IMPORT_TMP      (default <os tmp>/blyp_imports)
 *   POLL_MS         (default 5000)
 *   MAX_VIDEOS      (default 1000)
 *   ONCE=1          (process a single job then exit — handy for testing)
 *   STAGGER_FORCE_OFF=1  (ignore job.stagger and publish live immediately)
 *
 * Staggered publish: by default imports write posts as publishStatus=scheduled
 * with publishAt spaced over time. Run tools/import/blyp_publish_sweeper.js
 * (or the blypScheduledPublishSweep Cloud Function) to flip them live when due.
 *
 * Run: node tools/import/blyp_import_worker.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const admin = require('firebase-admin');
const { normalizeStagger, publishAtForIndex, PUBLISH_STATUS } = require('./publishSchedule');

const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'blyp-master.firebasestorage.app';
const TMP_ROOT = process.env.IMPORT_TMP || path.join(os.tmpdir(), 'blyp_imports');
const POLL_MS = Number(process.env.POLL_MS || 5000);
// Sane default cap so one huge account can't monopolise the worker or run up an
// unbounded bill. Set MAX_VIDEOS=0 explicitly to lift the cap.
const MAX_VIDEOS = process.env.MAX_VIDEOS !== undefined ? Number(process.env.MAX_VIDEOS) : 1000;
// A 'running' job whose heartbeat is older than this is assumed orphaned (the
// worker that owned it died/restarted) and may be re-claimed and resumed.
const STALE_RUNNING_MS = Number(process.env.STALE_RUNNING_MS || 5 * 60 * 1000);
// Per-item yt-dlp timeouts so a single hung download can never block the whole
// import indefinitely. The clip is killed and counted as failed; the rest carry on.
const ITEM_TIMEOUT_MS = Number(process.env.ITEM_TIMEOUT_MS || 5 * 60 * 1000);
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 2 * 60 * 1000);
const ONCE = process.env.ONCE === '1';
const STAGGER_FORCE_OFF = process.env.STAGGER_FORCE_OFF === '1';

admin.initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET });
const db = admin.firestore();
const bucket = admin.storage().bucket();

const log = (...a) => console.log('[import-worker]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stable per-source-video identity used for idempotent dedupe. Scoped to
// platform + account so the same user can import several different accounts
// without their videos colliding. Account/platform are lower-cased and the
// account's leading '@' is stripped so it matches however it was stored.
function dedupeKey(platform, account, sourceId) {
  const plat = String(platform || 'tiktok').toLowerCase();
  const acct = String(account || '').toLowerCase().replace(/^@+/, '');
  return `${plat}|${acct}|${String(sourceId)}`;
}

function parseHashtags(text) {
  if (!text) return [];
  return Array.from(new Set((text.match(/#[\p{L}0-9_]+/gu) || []).map((t) => t.slice(1).toLowerCase())));
}

function inferCategory(tags, caption) {
  const hay = (tags.join(' ') + ' ' + (caption || '')).toLowerCase();
  const map = [
    ['mtb', 'cycling'], ['enduro', 'cycling'], ['bike', 'cycling'], ['trail', 'cycling'], ['emtb', 'cycling'], ['downhill', 'cycling'],
    ['dj', 'music'], ['dancehall', 'music'], ['amapiano', 'music'], ['mix', 'music'], ['remix', 'music'], ['music', 'music'], ['song', 'music'],
    ['skull', 'gaming'], ['game', 'gaming'], ['gaming', 'gaming'],
    ['funny', 'comedy'], ['comedy', 'comedy'], ['prank', 'comedy'],
    ['football', 'sport'], ['gym', 'fitness'], ['workout', 'fitness'], ['sport', 'sport'],
    ['dog', 'animals'], ['cat', 'animals'], ['pet', 'animals'], ['animal', 'animals'],
  ];
  for (const [kw, cat] of map) if (hay.includes(kw)) return cat;
  return 'general';
}

/** Upload bytes to Storage and return a permanent Firebase download URL. */
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

/** Claim the oldest pending request (transactional, so two workers don't collide). */
async function claimNext() {
  // 1) Prefer fresh pending jobs (oldest first).
  const snap = await db.collection('socialImports').where('status', '==', 'pending').limit(5).get();
  if (!snap.empty) {
    const docs = snap.docs.sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));
    for (const d of docs) {
      const ok = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(d.ref);
        if (!fresh.exists || fresh.data().status !== 'pending') return false;
        tx.update(d.ref, {
          status: 'running',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          message: 'Connecting…',
        });
        return true;
      });
      if (ok) return d.ref;
    }
  }

  // 2) Otherwise, resume a stale 'running' job — one whose owning worker died or
  //    restarted mid-import (no heartbeat for a while). Without this, a crash
  //    would leave the request stuck on "running" forever. processJob re-runs
  //    are safe: dedupe skips videos already imported, so it picks up where it
  //    left off.
  const runSnap = await db.collection('socialImports').where('status', '==', 'running').limit(10).get();
  if (!runSnap.empty) {
    const now = Date.now();
    const stale = runSnap.docs
      .filter((d) => now - (d.data().updatedAt || d.data().startedAt || 0) > STALE_RUNNING_MS)
      .sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));
    for (const d of stale) {
      const ok = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(d.ref);
        if (!fresh.exists || fresh.data().status !== 'running') return false;
        const ts = fresh.data().updatedAt || fresh.data().startedAt || 0;
        if (Date.now() - ts <= STALE_RUNNING_MS) return false; // someone is alive on it
        tx.update(d.ref, { updatedAt: Date.now(), message: 'Resuming import…' });
        return true;
      });
      if (ok) {
        log(`reclaimed stale running job ${d.id}`);
        return d.ref;
      }
    }
  }

  return null;
}

function ytDlp(args, opts = {}) {
  return spawnSync('yt-dlp', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** Build a single-video URL so we can fetch one clip at a time (streamed progress). */
function buildVideoUrl(platform, handle, id, fallbackUrl) {
  if (fallbackUrl && /^https?:\/\//i.test(fallbackUrl)) return fallbackUrl;
  if (platform === 'youtube') return `https://www.youtube.com/watch?v=${id}`;
  return `https://www.tiktok.com/@${String(handle || '').replace(/^@+/, '')}/video/${id}`;
}

async function processJob(ref) {
  const job = (await ref.get()).data();
  const { uid, handle, platform } = job;
  const platformLabel = platform === 'youtube' ? 'YouTube' : 'TikTok';
  const url = job.sourceUrl || `https://www.tiktok.com/@${handle}`;
  log(`job ${ref.id}: importing @${handle} → uid ${uid}`);

  // Author fields from the requester's profile (never modified).
  let prof = {};
  try { prof = (await db.collection('users').doc(uid).get()).data() || {}; } catch { /* ignore */ }
  const authorName = prof.displayName || prof.username || handle;
  const authorHandle = prof.username || prof.handle || handle;
  const authorPhoto = prof.photoURL || null;

  // Pace publishes over time (default ON). Admin jobs may set stagger.isAdmin for higher caps.
  const stagger = STAGGER_FORCE_OFF
    ? { enabled: false }
    : normalizeStagger(job.stagger || { enabled: true }, { isAdmin: !!(job.stagger && job.stagger.isAdmin) });

  // Idempotency: skip a video only if THIS user already imported the SAME
  // source video from the SAME source account. The dedupe key is scoped by
  // platform + account + sourceId — deliberately NOT a bare sourceId and NOT a
  // blanket "user already imported" flag — so a user can bring over additional,
  // different accounts without their videos being mistaken for duplicates of an
  // earlier import.
  const existing = new Set();
  let scheduledIndex = 0;
  try {
    const posts = await db.collection('posts').where('userId', '==', uid).get();
    posts.forEach((p) => {
      const d = p.data() || {};
      if (d.sourceId) existing.add(dedupeKey(d.sourcePlatform, d.sourceAccount, d.sourceId));
      if (d.importId === ref.id && typeof d.staggerIndex === 'number' && d.staggerIndex >= scheduledIndex) {
        scheduledIndex = d.staggerIndex + 1;
      }
    });
  } catch (e) { log('read existing failed:', e.message); }

  // Download into a fresh per-job temp dir.
  const dir = path.join(TMP_ROOT, `${ref.id}`);
  fs.mkdirSync(dir, { recursive: true });
  await ref.update({
    stagger,
    updatedAt: Date.now(),
    message: stagger.enabled
      ? `Connecting to ${platformLabel}… (will publish ~${stagger.postsPerDay}/day)`
      : `Connecting to ${platformLabel}…`,
  });

  // 1) Enumerate the source's videos (read-only, fast) so we know the real
  //    total up-front and can stream progress as each clip is brought over,
  //    instead of one giant opaque download that looks stalled for ages.
  let entries = [];
  try {
    const probe = spawnSync('yt-dlp', ['--flat-playlist', '--print', '%(id)s\t%(url)s', url], { encoding: 'utf8', maxBuffer: 1 << 26, timeout: PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' });
    if (probe.signal === 'SIGKILL' || (probe.error && probe.error.code === 'ETIMEDOUT')) {
      log(`enumerate timed out after ${PROBE_TIMEOUT_MS}ms for @${handle}`);
    }
    if (probe.error && probe.error.code === 'ENOENT') {
      throw new Error('yt-dlp not found on PATH. Install yt-dlp and try again.');
    }
    entries = (probe.stdout || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, ...rest] = line.split('\t');
        return { id: String(id || '').trim(), url: (rest.join('\t') || '').trim() || null };
      })
      .filter((e) => e.id);
  } catch (e) {
    if (/yt-dlp not found/.test(e.message)) throw e;
    log('enumerate failed:', e.message);
  }

  if (MAX_VIDEOS > 0) entries = entries.slice(0, MAX_VIDEOS);
  const total = entries.length;
  await ref.update({
    total,
    done: 0,
    skipped: 0,
    failed: 0,
    updatedAt: Date.now(),
    message: total ? `Found ${total} videos — bringing them in now…` : 'No public videos found.',
  });
  log(`enumerated ${total} videos for @${handle}`);

  // 2) Download + upload one clip at a time. Progress (and a heartbeat) is
  //    written after every video, so the app shows live movement and partial
  //    results appear immediately. A single failing clip never blocks the rest.
  let done = 0, skipped = 0, failed = 0, scheduled = 0, n = 0;

  // Cancel awareness: the client can flip status -> 'canceled' at any moment.
  // We re-check at the loop head AND right after each (potentially minutes-long)
  // download, so a canceled job never POSTS another video. The worker must also
  // never overwrite a terminal 'canceled' with 'done' at the end.
  const jobCanceled = async () => {
    try {
      const fresh = await ref.get();
      const st = fresh.exists ? (fresh.data() || {}).status : null;
      return st === 'canceled' || st === 'cancelled';
    } catch {
      return false; // transient read error — keep going
    }
  };
  const finishCanceled = async (at) => {
    log(`job ${ref.id} canceled by user at ${at}/${total}`);
    await ref.update({
      done, skipped, failed,
      status: 'canceled',
      finishedAt: Date.now(),
      updatedAt: Date.now(),
      message: `Import canceled — kept the ${done} already brought over.`,
    }).catch(() => {});
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  const safeJobUpdate = async (patch) => {
    if (await jobCanceled()) return false;
    await ref.update({ ...patch, updatedAt: Date.now() }).catch(() => {});
    return true;
  };

  for (const entry of entries) {
    n += 1;

    // Honor a client-initiated cancel mid-import. Anything already imported is
    // kept; dedupe means a later re-run won't re-fetch it.
    if (await jobCanceled()) {
      await finishCanceled(n - 1);
      return;
    }

    const srcId = String(entry.id);
    if (existing.has(dedupeKey(platform, handle, srcId))) {
      skipped += 1;
      if (!(await safeJobUpdate({
        done, skipped, failed,
        message: `Skipping ${skipped} already imported ┬À ${done + skipped} of ${total}…`,
      }))) {
        await finishCanceled(n - 1);
        return;
      }
      continue;
    }

    try {
      const videoUrlSrc = buildVideoUrl(platform, handle, srcId, entry.url);
      const one = ytDlp([
        '-o', path.join(dir, '%(id)s.%(ext)s'),
        '--write-info-json', '--write-thumbnail',
        '--no-warnings', '--ignore-errors', '--no-playlist',
        '--socket-timeout', '30',
        '-f', 'mp4/best',
        videoUrlSrc,
      ], { stdio: 'inherit', timeout: ITEM_TIMEOUT_MS, killSignal: 'SIGKILL' });
      if (one.error && one.error.code === 'ENOENT') {
        throw new Error('yt-dlp not found on PATH. Install yt-dlp and try again.');
      }
      if (one.signal === 'SIGKILL' || (one.error && one.error.code === 'ETIMEDOUT')) {
        // Hung download — killed by the per-item timeout. Count as failed and move on.
        log(`  timeout ${srcId} after ${ITEM_TIMEOUT_MS}ms`);
        failed += 1;
        if (await jobCanceled()) {
          await finishCanceled(n - 1);
          return;
        }
        await ref.update({ done, skipped, failed, updatedAt: Date.now() }).catch(() => {});
        continue;
      }

      const file = path.join(dir, `${srcId}.mp4`);
      if (!fs.existsSync(file)) {
        // yt-dlp couldn't fetch this one (private/region-locked/blocked).
        failed += 1;
        if (await jobCanceled()) {
          await finishCanceled(n - 1);
          return;
        }
        await ref.update({ done, skipped, failed, updatedAt: Date.now() }).catch(() => {});
        continue;
      }

      // The download above can take minutes; if the user canceled during it,
      // stop NOW — before uploading/posting — so no new video appears after
      // the app said "Canceled".
      if (await jobCanceled()) {
        await finishCanceled(n - 1);
        return;
      }

      let info = {};
      try { info = JSON.parse(fs.readFileSync(path.join(dir, `${srcId}.info.json`), 'utf8')); } catch { /* none */ }

      const caption = info.description || info.title || '';
      const tags = Array.from(new Set(parseHashtags(caption).concat((Array.isArray(info.tags) ? info.tags : []).map((t) => String(t).toLowerCase()))));
      const category = inferCategory(tags, caption);
      const tsSec = Number(info.timestamp) || null;
      const postDate = tsSec ? admin.firestore.Timestamp.fromMillis(tsSec * 1000) : admin.firestore.FieldValue.serverTimestamp();
      const stamp = Date.now() + '-' + n;

      const videoUrl = await uploadAndGetUrl(`users/${uid}/media/video-${stamp}.mp4`, fs.readFileSync(file), 'video/mp4');

      let thumbnailUrl = null;
      try {
        const localThumb = ['.jpg', '.webp', '.png'].map((e) => path.join(dir, `${srcId}${e}`)).find((p) => fs.existsSync(p));
        if (localThumb) {
          thumbnailUrl = await uploadAndGetUrl(`users/${uid}/thumbnails/thumbnail-${stamp}.jpg`, fs.readFileSync(localThumb), 'image/jpeg');
        } else if (info.thumbnail) {
          const resp = await fetch(info.thumbnail);
          if (resp.ok) thumbnailUrl = await uploadAndGetUrl(`users/${uid}/thumbnails/thumbnail-${stamp}.jpg`, Buffer.from(await resp.arrayBuffer()), 'image/jpeg');
        }
      } catch (e) { log('  thumb skipped:', e.message); }

      const title = (caption || '').split('\n')[0].slice(0, 80) || authorName;
      const nowMs = Date.now();
      const staggerSlot = scheduledIndex;
      const publishAt = stagger.enabled
        ? publishAtForIndex(stagger, staggerSlot, nowMs)
        : nowMs;
      const publishStatus = stagger.enabled ? PUBLISH_STATUS.SCHEDULED : PUBLISH_STATUS.LIVE;
      if (stagger.enabled) scheduledIndex += 1;

      await db.collection('posts').add({
        userId: uid,
        username: authorName,
        userDisplayName: authorName,
        userPhotoURL: authorPhoto,
        user: { username: authorHandle, avatar: authorPhoto },
        title, caption, description: caption, transcript: caption,
        tags, hashtags: tags, category,
        emoji: '­ƒÄ¼', type: 'video',
        videoUrl, mediaUrl: videoUrl, imageUrl: null, audioUrl: null,
        thumbnail: thumbnailUrl,
        media: [{ url: videoUrl, type: 'video', thumbnail: thumbnailUrl }],
        durationSec: Number(info.duration) || null,
        sourcePlatform: platform || 'tiktok',
        sourceAccount: handle,
        sourceUrl: info.webpage_url || videoUrlSrc || null,
        sourceId: srcId,
        importedVia: 'social-import',
        importId: ref.id,
        publishStatus,
        publishAt,
        staggerIndex: stagger.enabled ? staggerSlot : null,
        likes: 0, likeCount: 0, comments: 0, commentCount: 0, shares: 0,
        date: postDate, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      done += 1;
      if (publishStatus === PUBLISH_STATUS.SCHEDULED) scheduled += 1;

      // Free disk as we go so big imports don't fill the box.
      try {
        ['.mp4', '.info.json', '.jpg', '.webp', '.png'].forEach((e) => {
          const p = path.join(dir, `${srcId}${e}`);
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        });
      } catch { /* ignore */ }
    } catch (e) {
      failed += 1;
      log(`  failed ${srcId}:`, e.message);
    }

    // Heartbeat + progress after every clip so the UI never looks frozen.
    // Count skipped toward the processed total so re-imports don't look stuck.
    await ref.update({
      done, skipped, failed, scheduled,
      updatedAt: Date.now(),
      message: stagger.enabled
        ? `${done + skipped} of ${total} processed (${done} queued to publish${skipped ? `, ${skipped} already there` : ''})…`
        : `${done + skipped} of ${total} processed (${done} new${skipped ? `, ${skipped} already there` : ''})…`,
    }).catch(() => {});
  }

  // Never overwrite a terminal 'canceled' with 'done': if the user canceled
  // during the final clip, the client-set status must win.
  if (await jobCanceled()) {
    await finishCanceled(total);
    return;
  }

  await ref.update({
    status: 'done',
    done, skipped, failed, scheduled, total,
    finishedAt: Date.now(),
    updatedAt: Date.now(),
    message: stagger.enabled
      ? `Imported ${done} video${done === 1 ? '' : 's'} from @${handle} — publishing ~${stagger.postsPerDay}/day.`
      : `Imported ${done} video${done === 1 ? '' : 's'} from @${handle}.`,
  });
  log(`job ${ref.id} done: posted=${done} scheduled=${scheduled} skipped=${skipped} failed=${failed}`);

  // Best-effort cleanup of the temp dir.
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

// Cloud Run (and most managed runtimes) require the container to listen on
// $PORT. The worker itself is a background poller, so we expose a tiny health
// endpoint just to satisfy the platform's startup probe.
function startHealthServer() {
  const port = Number(process.env.PORT || 8080);
  try {
    http
      .createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('blyp-import-worker ok'); })
      .listen(port, () => log(`health server listening on :${port}`));
  } catch (e) {
    log('health server failed (continuing):', e.message);
  }
}

async function main() {
  log(`started. project=${PROJECT_ID} bucket=${STORAGE_BUCKET} poll=${POLL_MS}ms once=${ONCE}`);
  if (!ONCE) startHealthServer();
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let ref = null;
    try {
      ref = await claimNext();
    } catch (e) {
      log('claim error:', e.message);
    }
    if (!ref) {
      if (ONCE) { log('no pending jobs; exiting (ONCE).'); break; }
      await sleep(POLL_MS);
      continue;
    }
    try {
      await processJob(ref);
    } catch (e) {
      log('job failed:', e.message);
      try {
        await ref.update({ status: 'error', message: e.message || 'Import failed.', updatedAt: Date.now() });
      } catch { /* ignore */ }
    }
    if (ONCE) break;
  }
  process.exit(0);
}

main().catch((e) => { console.error('[import-worker] FATAL', e); process.exit(1); });
