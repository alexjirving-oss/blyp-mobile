// socialImportService.js
//
// "Bring your content over" — lets a signed-in user import their own videos
// from an external platform (TikTok first) onto their Blyp profile.
//
// How it works (see ImportContentScreen + tools/import/blyp_import_worker.js):
//   1. The app creates ONE 'pending' request doc in `socialImports` for the
//      current user (this file). Firestore rules only allow the owner to
//      create a fresh pending request and to read their own requests.
//   2. A backend worker (Admin SDK) claims pending requests, downloads the
//      handle's videos, uploads them to Storage, posts them to the user's
//      profile, and writes progress (total/done/status) back onto the request.
//   3. The app subscribes to the request doc to show live progress.
//
// Honesty note (BLYP_CHARTER.md): import is opt-in and only ever brings a
// user's OWN content onto their OWN profile. We record an ownership
// attestation; abuse/mismatch handling is layered on later (ID + phone).

import { db, firebaseEnabled } from '../config/firebase';
import { STAGGER_DEFAULTS, normalizeStagger } from '../utils/publishSchedule';

export const IMPORT_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
  CANCELED: 'canceled',
};

// Platforms shown in the UI. Only `enabled` ones can be requested today; the
// rest are surfaced as "coming soon" so the intent (every platform) is clear.
export const IMPORT_PLATFORMS = [
  { id: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', enabled: true },
  { id: 'youtube', label: 'YouTube', icon: 'logo-youtube', enabled: true },
  { id: 'instagram', label: 'Instagram', icon: 'logo-instagram', enabled: false },
  { id: 'snapchat', label: 'Snapchat', icon: 'logo-snapchat', enabled: false },
];

// Detect a pasted URL so YouTube channel links can be used by yt-dlp verbatim.
function looksLikeUrl(s) {
  const v = String(s || '').toLowerCase();
  return v.includes('youtube.com') || v.includes('youtu.be') || v.startsWith('http');
}

/**
 * Platform-aware handle normalization.
 *  - tiktok: bare lowercase handle (from "@name", "name", or a profile URL).
 *  - youtube: a pasted URL is returned trimmed/verbatim (so yt-dlp can use it
 *    directly); otherwise the bare handle with a leading '@' stripped (case kept).
 */
export function normalizeHandleFor(platform, input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (platform === 'youtube') {
    if (looksLikeUrl(s)) return s;
    return s.replace(/^@+/, '');
  }
  // tiktok (default): legacy behavior.
  let t = s;
  const m = t.match(/tiktok\.com\/@?([A-Za-z0-9._]+)/i);
  if (m) t = m[1];
  t = t.replace(/^@+/, '');       // strip leading @(s)
  t = t.split(/[/?#]/)[0];        // drop any trailing path/query
  return t.toLowerCase();
}

/**
 * Platform-aware handle validation.
 *  - tiktok: letters, numbers, underscore and dot, 2–24 chars.
 *  - youtube: a YouTube URL, or a bare handle (3–30 chars, letters/digits/._-).
 */
export function isValidHandleFor(platform, value) {
  const v = String(value || '');
  if (platform === 'youtube') {
    if (v.toLowerCase().includes('youtube.com') || v.toLowerCase().includes('youtu.be')) return true;
    return /^[A-Za-z0-9._-]{3,30}$/.test(v);
  }
  return /^[a-z0-9._]{2,24}$/.test(v);
}

/**
 * Build the source URL yt-dlp should download from.
 *  - tiktok: profile URL from the bare handle.
 *  - youtube: a URL is returned unchanged; otherwise the channel's /videos tab.
 */
export function sourceUrlFor(platform, normalized) {
  const n = String(normalized || '');
  if (platform === 'youtube') {
    if (looksLikeUrl(n)) return n;
    return `https://www.youtube.com/@${n}/videos`;
  }
  return `https://www.tiktok.com/@${n}`;
}

/**
 * Normalize whatever the user typed into a bare TikTok handle.
 * Accepts "@name", "name", or a full profile URL. (Legacy TikTok-only export.)
 */
export function normalizeHandle(input) {
  return normalizeHandleFor('tiktok', input);
}

/** TikTok handles: letters, numbers, underscore and dot, 2–24 chars. (Legacy.) */
export function isValidHandle(handle) {
  return isValidHandleFor('tiktok', handle);
}

function fsReady() {
  return firebaseEnabled && db && typeof db.collection === 'function';
}

/**
 * Create a fresh import request for the current user.
 * @param {object} opts
 * @param {object} [opts.stagger] Pace options — see normalizeStagger. Default ON (3/day).
 * @returns {Promise<{ id: string }>} the new request id
 */
export async function requestImport({
  uid,
  platform = 'tiktok',
  handle,
  claimedOwnership,
  stagger,
}) {
  if (!fsReady()) throw new Error("Importing isn't available right now.");
  if (!uid) throw new Error('Please sign in to import your content.');

  const normalized = normalizeHandleFor(platform, handle);
  if (!isValidHandleFor(platform, normalized)) {
    throw new Error("That doesn't look like a valid username.");
  }

  try {
    const { ensureFirebaseAuthReady } = await import('../utils/firebaseAuthHelper');
    await ensureFirebaseAuthReady({ uid, timeoutMs: 15000 });
  } catch (e) {
    throw new Error('Still connecting your account — try again in a moment.');
  }

  const now = Date.now();
  // Clients cannot self-elevate to admin caps; staff uses the admin API.
  const staggerNorm = normalizeStagger(
    stagger != null ? stagger : { enabled: true, postsPerDay: STAGGER_DEFAULTS.postsPerDay, startAt: now },
    { isAdmin: false },
  );
  const data = {
    uid,
    platform,
    handle: normalized,
    sourceUrl: sourceUrlFor(platform, normalized),
    status: IMPORT_STATUS.PENDING,
    total: 0,
    done: 0,
    skipped: 0,
    failed: 0,
    scheduled: 0,
    claimedOwnership: !!claimedOwnership,
    stagger: staggerNorm,
    staggerPaused: false,
    message: staggerNorm.enabled
      ? `Queued — we'll import your videos, then publish about ${staggerNorm.postsPerDay}/day.`
      : "Queued — we'll start bringing your videos over shortly.",
    createdAt: now,
    updatedAt: now,
  };

  try {
    const ref = await db.collection('socialImports').add(data);
    return { id: ref?.id || null };
  } catch (e) {
    const code = e?.code || e?.message || '';
    if (String(code).includes('permission') || String(code).includes('PERMISSION')) {
      throw new Error(
        "Import isn't allowed for this account yet. Update the app / wait for permissions to deploy, then try again.",
      );
    }
    throw e instanceof Error ? e : new Error(String(e?.message || e));
  }
}

/**
 * Subscribe to the user's most recent import request (live progress).
 * Avoids a composite index by filtering on uid only and sorting client-side.
 * @returns {() => void} unsubscribe
 */
export function subscribeLatestImport(uid, cb) {
  if (!fsReady() || !uid) {
    try { cb(null); } catch { /* ignore */ }
    return () => {};
  }
  try {
    return db
      .collection('socialImports')
      .where('uid', '==', uid)
      .onSnapshot(
        (snap) => {
          const docs = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
          docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          try { cb(docs[0] || null); } catch { /* ignore */ }
        },
        (err) => {
          console.warn('[import] subscribe failed', err?.message || String(err));
          try { cb(null); } catch { /* ignore */ }
        },
      );
  } catch (e) {
    console.warn('[import] subscribe threw', e?.message || String(e));
    try { cb(null); } catch { /* ignore */ }
    return () => {};
  }
}

/**
 * Subscribe to ALL of the user's import requests (newest first).
 * Lets the UI show import history and support importing from several different
 * accounts over time. Avoids a composite index by filtering on uid only and
 * sorting client-side.
 * @returns {() => void} unsubscribe
 */
export function subscribeImports(uid, cb) {
  if (!fsReady() || !uid) {
    try { cb([]); } catch { /* ignore */ }
    return () => {};
  }
  try {
    return db
      .collection('socialImports')
      .where('uid', '==', uid)
      .onSnapshot(
        (snap) => {
          const docs = (snap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
          docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          try { cb(docs); } catch { /* ignore */ }
        },
        (err) => {
          console.warn('[import] subscribe-all failed', err?.message || String(err));
          try { cb([]); } catch { /* ignore */ }
        },
      );
  } catch (e) {
    console.warn('[import] subscribe-all threw', e?.message || String(e));
    try { cb([]); } catch { /* ignore */ }
    return () => {};
  }
}

/** True while a request is queued or actively running. */
export function isImportActive(req) {
  return !!req && (req.status === IMPORT_STATUS.PENDING || req.status === IMPORT_STATUS.RUNNING);
}

/**
 * Cancel a queued/running import. Lets a user recover if a job stalls (e.g. the
 * import worker is offline) so the form re-enables and they can try again.
 */
export async function cancelImport(importId) {
  if (!fsReady() || !importId) return;
  await db.collection('socialImports').doc(importId).update({
    status: IMPORT_STATUS.CANCELED,
    message: 'Canceled.',
    updatedAt: Date.now(),
  });
}

export default {
  IMPORT_STATUS,
  IMPORT_PLATFORMS,
  normalizeHandle,
  isValidHandle,
  normalizeHandleFor,
  isValidHandleFor,
  sourceUrlFor,
  requestImport,
  subscribeLatestImport,
  subscribeImports,
  isImportActive,
  cancelImport,
};
