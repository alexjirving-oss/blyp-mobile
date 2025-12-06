import { db, auth } from '../config/firebase';
import { serverTimestamp } from 'firebase/firestore';

// ---------- USERS ----------
export async function setUserStatus(uid, status, currentStreamId = null) {
  const ref = db.collection("users").doc(uid);
  await ref.set({
    status,
    currentStreamId,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

const PLACEHOLDER_NAMES = ['Anonymous', 'Anonymous User'];

function isPlaceholderName(name) {
  if (!name) return true;
  const trimmed = String(name).trim();
  return PLACEHOLDER_NAMES.includes(trimmed);
}

export async function ensureUserProfile({ userId, displayName, photoURL, email } = {}) {
  if (!userId) {
    console.warn('[LiveService][ensureUserProfile] Missing userId, aborting profile ensure');
    return;
  }

  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();

  let finalDisplayName = displayName ?? null;

  // If no displayName provided, try to reuse existing non-placeholder value
  if (!finalDisplayName && snap.exists) {
    const existing = snap.data() || {};
    if (
      existing.displayName &&
      typeof existing.displayName === 'string' &&
      !isPlaceholderName(existing.displayName)
    ) {
      finalDisplayName = existing.displayName;
    }
  }

  // Last-resort fallback: NEVER Anonymous strings, use uid
  if (!finalDisplayName) {
    finalDisplayName = userId;
  }

  await ref.set(
    {
      displayName: finalDisplayName,
      photoURL: photoURL ?? null,
      email: email ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  console.log('[LiveService][ensureUserProfile] ensured profile', {
    userId,
    finalDisplayName,
  });
}

// ---------- STREAMS ----------
export async function createStream({ streamId, title, thumbnailUrl, userId }) {
  console.log('[LiveService][AUTH] createStream called with userId:', userId ? 'present' : 'MISSING');
  
  // CRITICAL: Trust userId param, do NOT fallback to auth.currentUser
  if (!userId || typeof userId !== 'string') {
    console.error('[LiveService][AUTH] createStream blocked: userId param missing or invalid');
    return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in to stream' };
  }

  // Create/merge stream doc with merge:true to avoid overwriting
  await db.collection("streams").doc(streamId).set({
    hostUid: userId,
    title,
    status: "live",
    createdAt: serverTimestamp(),
    viewerCount: 0,
    thumbnailUrl: thumbnailUrl || null,
  }, { merge: true });

  // Update user profile to "live" with streamId
  await setUserStatus(userId, "live", streamId);
}

export async function endStream(streamId, userId) {
  console.log('[LiveService][AUTH] endStream called with userId:', userId ? 'present' : 'MISSING');
  
  // CRITICAL: Trust userId param, do NOT fallback to auth.currentUser
  if (!userId || typeof userId !== 'string') {
    console.error('[LiveService][AUTH] endStream blocked: userId param missing or invalid');
    return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in' };
  }

  // Mark stream ended
  await db.collection("streams").doc(streamId).update({
    status: "ended",
    endedAt: serverTimestamp(),
  });

  // Update user profile to "offline" and clear streamId
  await setUserStatus(userId, "offline", null);
}

// ---------- VIEWERS ----------
export async function incrementViewer(streamId, delta) {
  const ref = db.collection("streams").doc(streamId);
  // Note: runTransaction not available in compatibility wrapper
  // Using a simple update instead
  const snap = await ref.get();
  if (!snap.exists) return;
  const current = snap.data()?.viewerCount ?? 0;
  await ref.update({ viewerCount: Math.max(0, current + delta) });
}

// ---------- MESSAGES ----------
export async function sendMessage(streamId, { uid, displayName, text }) {
  if (!text || !text.trim()) throw new Error("Message text required");
  if (text.length > 500) throw new Error("Message too long");
  const col = db.collection("streams").doc(streamId).collection("messages");
  await col.add({
    uid,
    displayName,
    text: text.trim(),
    createdAt: serverTimestamp(),
  });
}

// ---------- SUBSCRIPTIONS ----------
export function subscribeToLiveUsers(callback) {
  const cutoff = new Date(Date.now() - 90 * 1000); // require recent heartbeat
  const q = db
    .collection('liveStreams')
    .where('status', '==', 'live')
    .where('lastHeartbeatAt', '>=', cutoff)
    .orderBy('lastHeartbeatAt', 'desc');

  return q.onSnapshot((snap) => {
    console.log('[LIVE][SNAPSHOT] Raw live stream docs count:', snap.docs.length);

    const live = snap.docs.map((dSnap, idx) => {
      const data = dSnap.data() || {};
      console.log(`  Stream Doc ${idx}:`, dSnap.id, data);
      return {
        id: dSnap.id,
        streamId: dSnap.id,
        userId: data.userId || null,
        displayName: data.userName || data.displayName || 'Anonymous',
        photoURL: data.userPhotoURL || data.photoURL || null,
        status: data.status || 'live',
        lastHeartbeatAt: data.lastHeartbeatAt,
      };
    });

    console.log('[LIVE][PROCESSED_STREAMS] Total live streams after mapping:', live.length);
    live.forEach((stream, idx) => {
      console.log(`  Processed Stream ${idx}:`, stream.streamId, stream.displayName);
    });

    callback(live);
  }, (error) => {
    console.error('Error subscribing to live streams:', error);
    callback([]);
  });
}

/**
 * Subscribe to active live streams (primary source of truth).
 * Source: liveStreams collection with status === 'live'
 */
export function subscribeToLiveStreams({ onChange, onError } = {}) {
  // 90 second grace window: only show streams with recent heartbeat
  const ACTIVE_GRACE_MS = 90 * 1000;
  const activeSince = new Date(Date.now() - ACTIVE_GRACE_MS);

  const colRef = db.collection('liveStreams');
  const q = colRef
    .where('status', '==', 'live')
    .where('lastHeartbeatAt', '>=', activeSince)
    .orderBy('lastHeartbeatAt', 'desc');

  return q.onSnapshot(
    snapshot => {
      const streams = snapshot.docs.map(doc => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          streamId: data.streamId || doc.id,
          hostUid: data.hostUid || data.userId || null,
          hostDisplayName: data.hostDisplayName || data.userName || 'Unknown',
          title: data.title || '',
          playbackUrl:
            data.playbackUrl ||
            data.hlsPlaybackUrl ||
            (data.hls && data.hls.playbackUrl) ||
            null,
          status: data.status || 'unknown',
          lastHeartbeatAt: data.lastHeartbeatAt || null,
        };
      });

      console.log('[LIVE][DIRECTORY][SNAPSHOT]', {
        count: streams.length,
        ids: streams.map(s => s.streamId),
        graceWindowMs: ACTIVE_GRACE_MS,
      });

      if (typeof onChange === 'function') {
        onChange(streams);
      } else {
        console.warn(
          '[LiveService][subscribeToLiveStreams] onChange is not a function; skipping UI update',
          { onChangeType: typeof onChange }
        );
      }
    },
    error => {
      console.error('[LIVE][DIRECTORY][SNAPSHOT_ERROR]', {
        code: error.code,
        message: error.message,
      });
      if (typeof onError === 'function') {
        onError(error);
      } else if (typeof onChange === 'function') {
        onChange([]); // fail closed
      }
    },
  );
}

export function subscribeToStreamMessages(streamId, callback) {
  const col = db.collection("streams").doc(streamId).collection("messages");
  return col.onSnapshot((snap) => {
    callback(snap.docs.map(dSnap => ({ id: dSnap.id, ...dSnap.data() })));
  }, (error) => {
    console.error('Error subscribing to stream messages:', error);
    callback([]);
  });
}
