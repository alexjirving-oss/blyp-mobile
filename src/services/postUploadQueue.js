/**
 * Background publish queue for create-post.
 *
 * Tap Post → enqueue → leave Review immediately. Worker compresses, uploads
 * (concurrency 2–3), writes Firestore, then notifies subscribers for the
 * global progress banner / optimistic feed.
 *
 * In-memory only (process lifetime). Not kill-safe resume — that needs GCS
 * resumable sessions (P1/P2).
 */

import * as VideoThumbnails from 'expo-video-thumbnails';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db as firestore, auth } from '../config/firebase';
import { serverTimestamp } from 'firebase/firestore';
import { uploadMediaToStorage } from '../utils/uploadMediaToStorage';
import { prepareMediaForUpload } from '../utils/prepareMediaForUpload';
import { initialReachState } from './blypReachClient';
import { COMPOSE_DRAFT_KEY } from '../components/CreatePostButton';

export const POST_UPLOAD_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
};

const MEDIA_CONCURRENCY = 3;
const TERMINAL_KEEP_MS = 60 * 1000;

/** @type {Map<string, object>} */
const jobs = new Map();
/** @type {Set<(jobs: object[]) => void>} */
const listeners = new Set();
/** @type {string[]} */
const queue = [];
let processing = false;

function now() {
  return Date.now();
}

function notify() {
  const snapshot = getPostUploadJobs();
  listeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch (e) {
      console.warn('[POST_QUEUE] listener error', e?.message || e);
    }
  });
}

function patchJob(id, patch) {
  const prev = jobs.get(id);
  if (!prev) return null;
  const next = {
    ...prev,
    ...patch,
    updatedAt: now(),
  };
  jobs.set(id, next);
  notify();
  return next;
}

function extractHashtags(text) {
  const hashtagRegex = /#[\w]+/g;
  const hashtags = text.match(hashtagRegex) || [];
  return hashtags.map((tag) => tag.substring(1));
}

/**
 * Run async work over items with a fixed concurrency pool.
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} worker
 * @returns {Promise<PromiseSettledResult<R>[]>}
 */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      try {
        const value = await worker(items[i], i);
        results[i] = { status: 'fulfilled', value };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function uploadOneMedia(mediaItem, fbUid, onStatus) {
  if (!fbUid) throw new Error('User not authenticated (no Firebase UID)');
  const kind = String(mediaItem?.type || 'photo').toLowerCase();
  const mediaUri = mediaItem?.uri;
  if (!mediaUri) throw new Error('Missing media URI');

  const fileExtension = kind === 'video' ? 'mp4' : kind === 'audio' ? 'm4a' : 'jpg';
  const fileName = `${kind}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${fileExtension}`;
  const filePath = `users/${fbUid}/media/${fileName}`;
  const contentType =
    kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/m4a' : 'image/jpeg';

  let uploadUri = mediaUri;
  if (kind === 'video') {
    try {
      onStatus?.({ stage: 'compressing', pct: 0 });
      const prepared = await prepareMediaForUpload(mediaUri, 'video', {
        onProgress: (p) => {
          const raw = Number(p) || 0;
          const pct = Math.min(100, Math.round(raw <= 1 ? raw * 100 : raw));
          onStatus?.({ stage: 'compressing', pct });
        },
      });
      if (prepared?.uri) uploadUri = prepared.uri;
    } catch (prepErr) {
      console.warn('[POST_QUEUE] media prep skipped', prepErr?.message || prepErr);
    }
  }

  onStatus?.({ stage: 'uploading', pct: 0 });
  const uploadedPromise = uploadMediaToStorage({
    localUri: uploadUri,
    storagePath: filePath,
    contentType,
    timeoutMs: kind === 'video' ? 180000 : 90000,
    onProgress: (pct) => {
      onStatus?.({ stage: 'uploading', pct });
    },
  });

  let thumbWork = Promise.resolve(null);
  if (kind === 'video') {
    thumbWork = (async () => {
      try {
        const thumbnailPromise = VideoThumbnails.getThumbnailAsync(mediaUri, {
          time: 0,
          quality: 0.55,
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Thumbnail generation timeout')), 5000),
        );
        const { uri: thumbnailUri } = await Promise.race([thumbnailPromise, timeoutPromise]);
        const thumbPath = `users/${fbUid}/thumbnails/thumbnail-${Date.now()}.jpg`;
        const thumbUploaded = await uploadMediaToStorage({
          localUri: thumbnailUri,
          storagePath: thumbPath,
          contentType: 'image/jpeg',
          timeoutMs: 30000,
        });
        return thumbUploaded.downloadURL;
      } catch (error) {
        console.warn('[POST_QUEUE] thumbnail failed', error?.message || error);
        return null;
      }
    })();
  }

  const [uploaded, thumbnailUrl] = await Promise.all([uploadedPromise, thumbWork]);
  let normalizedType = 'image';
  if (kind === 'video') normalizedType = 'video';
  else if (kind === 'audio') normalizedType = 'audio';

  return {
    url: uploaded.downloadURL,
    type: normalizedType,
    thumbnail: thumbnailUrl || null,
  };
}

async function uploadOneMediaWithRetry(mediaItem, fbUid, onStatus) {
  try {
    return await uploadOneMedia(mediaItem, fbUid, onStatus);
  } catch (firstErr) {
    console.warn('[POST_QUEUE] media first attempt failed, retrying once', firstErr?.message);
    onStatus?.({ stage: 'retrying', pct: 0 });
    return uploadOneMedia(mediaItem, fbUid, onStatus);
  }
}

function buildOptimisticPost(job) {
  const media = Array.isArray(job.mediaItems) ? job.mediaItems : [];
  const hasVideo = media.some((m) => String(m?.type || '').toLowerCase() === 'video');
  const hasImage = media.some((m) => {
    const t = String(m?.type || '').toLowerCase();
    return t === 'image' || t === 'photo';
  });
  const hasAudio = media.some((m) => String(m?.type || '').toLowerCase() === 'audio');
  const postType = hasVideo ? 'video' : hasImage ? 'image' : hasAudio ? 'audio' : 'text';
  const primary = media[0];
  const localUri = primary?.uri || null;

  return {
    id: job.id,
    _pendingUpload: true,
    _pendingJobId: job.id,
    userId: job.userId,
    username: job.username,
    userPhotoURL: job.userPhotoURL || null,
    title: job.title,
    transcript: job.caption,
    description: job.caption,
    caption: job.caption,
    tags: job.tags || [],
    hashtags: job.hashtags || [],
    categoryId: job.categoryId || null,
    sportTags: Array.isArray(job.sportTags) ? job.sportTags : [],
    teamIds: Array.isArray(job.teamIds) ? job.teamIds : [],
    emoji: media.length > 0 ? '📸' : '💭',
    media: media.map((m) => ({
      url: m.uri,
      type: String(m.type || '').toLowerCase() === 'video' ? 'video' : String(m.type || '').toLowerCase() === 'audio' ? 'audio' : 'image',
      thumbnail: null,
      local: true,
    })),
    type: postType,
    videoUrl: hasVideo ? localUri : null,
    imageUrl: hasImage && !hasVideo ? localUri : null,
    audioUrl: hasAudio ? localUri : null,
    thumbnail: null,
    user: { username: job.username, avatar: job.userPhotoURL || null },
    likes: 0,
    comments: 0,
    shares: 0,
    likeCount: 0,
    commentCount: 0,
    viewCount: 0,
    views: 0,
    giftCoins: 0,
    giftCount: 0,
    coinsReceived: 0,
    date: new Date(),
    uploadStatus: job.status,
    uploadStatusText: job.statusText,
  };
}

async function runJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  patchJob(jobId, {
    status: POST_UPLOAD_STATUS.RUNNING,
    statusText: 'Preparing your content…',
    progressPct: 2,
  });

  let lastStageLabel = 'Uploading…';

  try {
    const mediaItems = (job.mediaItems || []).filter((m) => m?.uri);
    const totalMedia = mediaItems.length;
    const itemProgress = new Map(); // index -> 0..100 stage weight

    const bumpOverall = () => {
      if (totalMedia <= 0) {
        patchJob(jobId, { progressPct: 40, statusText: 'Publishing…' });
        return;
      }
      let sum = 0;
      for (let i = 0; i < totalMedia; i++) sum += itemProgress.get(i) || 0;
      const avg = sum / totalMedia;
      // Reserve 0–88% for media, 88–100 for Firestore.
      const pct = Math.min(88, Math.round(avg * 0.88));
      patchJob(jobId, { progressPct: Math.max(5, pct), statusText: lastStageLabel });
    };

    const uploadedMedia = [];
    if (totalMedia > 0) {
      const settled = await mapPool(mediaItems, MEDIA_CONCURRENCY, async (mediaItem, i) => {
        const itemLabel =
          totalMedia > 1
            ? `${i + 1}/${totalMedia}`
            : String(mediaItem.type || '').toLowerCase() === 'video'
              ? 'video'
              : 'photo';
        const onStatus = ({ stage, pct }) => {
          const stageWeight =
            stage === 'compressing' ? 0.35 : stage === 'retrying' ? 0.4 : 0.95;
          const stagePct = Math.min(100, Number(pct) || 0);
          itemProgress.set(i, Math.min(99, Math.round(stagePct * stageWeight)));
          const verb =
            stage === 'compressing'
              ? `Compressing ${itemLabel}`
              : stage === 'retrying'
                ? `Retrying ${itemLabel}`
                : `Uploading ${itemLabel}`;
          lastStageLabel = `${verb}… ${stagePct}%`;
          bumpOverall();
        };
        const mediaData = await uploadOneMediaWithRetry(mediaItem, job.fbUid, onStatus);
        itemProgress.set(i, 100);
        bumpOverall();
        return mediaData;
      });

      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        if (r.status === 'fulfilled' && r.value) {
          uploadedMedia.push(r.value);
        } else {
          const reason = String(r.reason?.message || r.reason || 'upload failed').slice(0, 180);
          console.error(`[POST_QUEUE] media ${i + 1} failed`, reason);
          // Skip failed item; continue with the rest (no blocking Alert in background).
        }
      }

      if (uploadedMedia.length === 0 && !(job.caption || '').trim()) {
        throw new Error('All media uploads failed');
      }
      if (uploadedMedia.length < totalMedia) {
        console.warn(
          `[POST_QUEUE] published with ${uploadedMedia.length}/${totalMedia} media (skipped failures)`,
        );
      }
    }

    const hasVideo = uploadedMedia.some((m) => m.type === 'video');
    const hasImage = uploadedMedia.some((m) => m.type === 'image');
    const hasAudio = uploadedMedia.some((m) => m.type === 'audio');
    const postType = hasVideo ? 'video' : hasImage ? 'image' : hasAudio ? 'audio' : 'text';
    const primaryMedia = uploadedMedia[0];
    const videoUrl = hasVideo ? primaryMedia?.url : null;
    const imageUrl = hasImage ? primaryMedia?.url : null;
    const audioUrl = hasAudio ? primaryMedia?.url : null;
    const thumbnailUrl = uploadedMedia[0]?.thumbnail || null;

    patchJob(jobId, {
      statusText: 'Publishing…',
      progressPct: 92,
    });

    const postData = {
      userId: job.userId,
      username: job.username,
      userPhotoURL: job.userPhotoURL || null,
      title: job.title,
      transcript: job.caption,
      description: job.caption,
      caption: job.caption,
      tags: job.tags || extractHashtags(job.caption || ''),
      hashtags: job.hashtags || [],
      categoryId: job.categoryId || null,
      sportTags: Array.isArray(job.sportTags) ? job.sportTags : [],
      teamIds: Array.isArray(job.teamIds) ? job.teamIds : [],
      emoji: uploadedMedia.length > 0 ? '📸' : '💭',
      media: uploadedMedia,
      type: postType,
      videoUrl,
      imageUrl,
      audioUrl,
      thumbnail: thumbnailUrl,
      user: {
        username: job.username,
        avatar: job.userPhotoURL || null,
      },
      likes: 0,
      comments: 0,
      shares: 0,
      sharedTo: job.sharedTo || [],
      date: serverTimestamp(),
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      views: 0,
      giftCoins: 0,
      giftCount: 0,
      coinsReceived: 0,
      reach: initialReachState(),
    };

    const docRef = await firestore.collection('posts').add(postData);

    try {
      await AsyncStorage.removeItem(COMPOSE_DRAFT_KEY);
    } catch {
      /* non-blocking */
    }

    patchJob(jobId, {
      status: POST_UPLOAD_STATUS.DONE,
      statusText: 'Post is live',
      progressPct: 100,
      postId: docRef.id,
      optimisticPost: null,
    });

    // Drop terminal jobs from active maps after a short window (banner handles UI).
    setTimeout(() => {
      const cur = jobs.get(jobId);
      if (cur?.status === POST_UPLOAD_STATUS.DONE) {
        // Keep briefly for subscribers that need postId; prune later.
      }
    }, TERMINAL_KEEP_MS);

    console.log('[POST_QUEUE] published', docRef.id);
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('[POST_QUEUE] job failed', jobId, msg);
    patchJob(jobId, {
      status: POST_UPLOAD_STATUS.ERROR,
      statusText: 'Upload failed — tap to retry',
      error: msg,
      progressPct: jobs.get(jobId)?.progressPct || 0,
    });
  }
}

async function pump() {
  if (processing) return;
  processing = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      await runJob(id);
    }
  } finally {
    processing = false;
    if (queue.length > 0) {
      pump().catch(() => {});
    }
  }
}

/**
 * Enqueue a publish job. Returns the job (incl. optimistic local post).
 *
 * @param {object} input
 * @param {Array<{uri: string, type?: string}>} [input.mediaItems]
 * @param {string} input.caption
 * @param {string} [input.title]
 * @param {string[]} [input.hashtags]
 * @param {string|null} [input.categoryId]
 * @param {string[]} [input.sportTags]
 * @param {string[]} [input.teamIds]
 * @param {string[]} [input.sharedTo]
 * @param {string} input.userId
 * @param {string} input.username
 * @param {string|null} [input.userPhotoURL]
 * @param {string} input.fbUid - Firebase UID for Storage paths
 */
export function enqueuePostUpload(input) {
  const id = `pending_${now()}_${Math.floor(Math.random() * 1e6)}`;
  const caption = String(input?.caption || '').trim();
  const mediaItems = Array.isArray(input?.mediaItems)
    ? input.mediaItems.filter((m) => m?.uri).map((m) => ({
        uri: m.uri,
        type: m.type || 'photo',
      }))
    : [];

  if (!caption && mediaItems.length === 0) {
    throw new Error('Please add a caption or media');
  }
  if (!input?.fbUid) {
    throw new Error('Missing Firebase UID');
  }
  if (!input?.userId) {
    throw new Error('Missing user id');
  }

  const job = {
    id,
    status: POST_UPLOAD_STATUS.QUEUED,
    statusText: 'Queued…',
    progressPct: 0,
    error: null,
    postId: null,
    mediaItems,
    caption,
    title: (input.title && String(input.title).trim()) || caption.substring(0, 80) || 'New Post',
    hashtags: Array.isArray(input.hashtags) ? input.hashtags : [],
    tags: extractHashtags(caption),
    categoryId: input.categoryId || null,
    sportTags: Array.isArray(input.sportTags)
      ? input.sportTags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
      : [],
    teamIds: Array.isArray(input.teamIds)
      ? Array.from(new Set(input.teamIds.map((t) => String(t).trim()).filter(Boolean)))
      : [],
    sharedTo: Array.isArray(input.sharedTo) ? input.sharedTo : [],
    userId: String(input.userId),
    username: input.username || 'Anonymous',
    userPhotoURL: input.userPhotoURL || null,
    fbUid: String(input.fbUid),
    createdAt: now(),
    updatedAt: now(),
    optimisticPost: null,
  };
  job.optimisticPost = buildOptimisticPost(job);

  jobs.set(id, job);
  queue.push(id);
  notify();
  pump().catch((e) => console.error('[POST_QUEUE] pump error', e?.message || e));
  return job;
}

export function retryPostUpload(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== POST_UPLOAD_STATUS.ERROR) return null;
  patchJob(jobId, {
    status: POST_UPLOAD_STATUS.QUEUED,
    statusText: 'Retrying…',
    error: null,
    progressPct: 0,
  });
  queue.push(jobId);
  pump().catch(() => {});
  return jobs.get(jobId);
}

export function dismissPostUpload(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.status === POST_UPLOAD_STATUS.RUNNING || job.status === POST_UPLOAD_STATUS.QUEUED) {
    // Can't cancel mid-upload yet; only dismiss terminal from UI.
    return;
  }
  jobs.delete(jobId);
  notify();
}

export function getPostUploadJobs() {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getActivePostUpload() {
  const list = getPostUploadJobs();
  return (
    list.find((j) => j.status === POST_UPLOAD_STATUS.RUNNING || j.status === POST_UPLOAD_STATUS.QUEUED) ||
    list.find((j) => j.status === POST_UPLOAD_STATUS.ERROR) ||
    list.find((j) => j.status === POST_UPLOAD_STATUS.DONE && now() - j.updatedAt < TERMINAL_KEEP_MS) ||
    null
  );
}

export function getPendingOptimisticPosts() {
  return getPostUploadJobs()
    .filter(
      (j) =>
        (j.status === POST_UPLOAD_STATUS.QUEUED || j.status === POST_UPLOAD_STATUS.RUNNING) &&
        j.optimisticPost,
    )
    .map((j) => j.optimisticPost);
}

/**
 * @param {(jobs: object[]) => void} cb
 * @returns {() => void}
 */
export function subscribePostUploads(cb) {
  if (typeof cb !== 'function') return () => {};
  listeners.add(cb);
  try {
    cb(getPostUploadJobs());
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(cb);
  };
}

export function isPostUploadActive(job) {
  return (
    !!job &&
    (job.status === POST_UPLOAD_STATUS.QUEUED || job.status === POST_UPLOAD_STATUS.RUNNING)
  );
}

/** Dev/test helper */
export function __resetPostUploadQueueForTests() {
  jobs.clear();
  queue.length = 0;
  processing = false;
  notify();
}

// Touch auth so Metro keeps the module linked; Storage still checks currentUser.
void auth;
