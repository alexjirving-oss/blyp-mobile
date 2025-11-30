import { db, auth } from '../config/firebase';
// Unified live model constants & flags
import {
  LIVE_STREAMS_COLLECTION,
  PRESENCE_STREAMS_COLLECTION,
  ENABLE_LIVE_FEATURES,
  ENABLE_LIVE_SEGMENTS_SUBCOLLECTION,
  ENABLE_LEGACY_SEGMENTS_MAP,
  ENABLE_PLAYLIST_MANIFEST_VIEWER,
  decideSegmentSource,
} from '../config/liveStreamModel';
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

export async function ensureUserProfile() {
  const user = auth.currentUser;
  if (!user) {
    console.warn("Cannot ensure user profile: No authenticated user");
    return;
  }

  const ref = db.collection("users").doc(user.uid);
  await ref.set({
    displayName: user.displayName || user.email?.split("@")[0] || "Anonymous",
    photoURL: user.photoURL || null,
    email: user.email || null,
    updatedAt: serverTimestamp()
    // ❌ Removed forced status: "offline" to prevent overwriting "live" status
  }, { merge: true });
  
  console.log("✅ User profile ensured for:", user.uid);
}

// ---------- STREAMS ----------
export async function createStream({ streamId, title, thumbnailUrl }) {
  if (!ENABLE_LIVE_FEATURES) {
    console.warn('[LIVE] createStream disabled by kill switch');
    return;
  }
  const uid = auth.currentUser.uid;

  // Create/merge stream doc with merge:true to avoid overwriting
  // Use presence/chat collection (legacy) constant; stream viewer data lives separately in liveStreams
  await db.collection(PRESENCE_STREAMS_COLLECTION).doc(streamId).set({ // TODO(stage2-live-unification): Merge presence/chat into unified liveStreams document or dedicated presence subcollection.
    hostUid: uid,
    title,
    status: "live",
    createdAt: serverTimestamp(),
    viewerCount: 0,
    thumbnailUrl: thumbnailUrl || null,
  }, { merge: true });

  // Update user profile to "live" with streamId
  await setUserStatus(uid, "live", streamId);
}

export async function endStream(streamId) {
  const uid = auth.currentUser?.uid;
  
  if (!uid) {
    console.warn('Cannot end stream: No authenticated user');
    return;
  }
  if (!ENABLE_LIVE_FEATURES) {
    console.warn('[LIVE] endStream disabled by kill switch');
    return;
  }

  // Mark stream ended
  await db.collection(PRESENCE_STREAMS_COLLECTION).doc(streamId).update({ // TODO(stage2-live-unification): Presence end logic to merge with unified endLiveStream helper.
    status: "ended",
    endedAt: serverTimestamp(),
  });

  // Update user profile to "offline" and clear streamId
  await setUserStatus(uid, "offline", null);
}

// ---------- VIEWERS ----------
export async function incrementViewer(streamId, delta) {
  const ref = db.collection(PRESENCE_STREAMS_COLLECTION).doc(streamId);
  // Note: runTransaction not available in compatibility wrapper
  // Using a simple update instead
  const snap = await ref.get();
  if (!snap.exists) return;
  const current = snap.data()?.viewerCount ?? 0;
  await ref.update({ viewerCount: Math.max(0, current + delta) });
}

// ---------- MESSAGES ----------
export async function sendMessage(streamId, { uid, displayName, text }) {
  if (!ENABLE_LIVE_FEATURES) {
    console.warn('[LIVE] sendMessage disabled by kill switch');
    return;
  }
  if (!text || !text.trim()) throw new Error("Message text required");
  if (text.length > 500) throw new Error("Message too long");
  const col = db.collection(PRESENCE_STREAMS_COLLECTION).doc(streamId).collection("messages");
  await col.add({
    uid,
    displayName,
    text: text.trim(),
    createdAt: serverTimestamp(),
  });
}

// ---------- SUBSCRIPTIONS ----------
export function subscribeToLiveUsers(callback) {
  const q = db.collection("users").where("status", "==", "live");
  return q.onSnapshot((snap) => {
    const live = snap.docs.map(dSnap => {
      const data = dSnap.data() || {};
      return {
        id: dSnap.id,
        displayName: data.displayName || "Anonymous",
        photoURL: data.photoURL || null,
        currentStreamId: data.currentStreamId || null,
        status: data.status || "offline",
      };
    });
    console.log("📡 Live users snapshot:", live);
    callback(live);
  }, (error) => {
    console.error("Error subscribing to live users:", error);
    callback([]);
  });
}

export function subscribeToStreamMessages(streamId, callback) {
  const col = db.collection(PRESENCE_STREAMS_COLLECTION).doc(streamId).collection("messages");
  return col.onSnapshot((snap) => {
    callback(snap.docs.map(dSnap => ({ id: dSnap.id, ...dSnap.data() })));
  }, (error) => {
    console.error('Error subscribing to stream messages:', error);
    callback([]);
  });
}

// TODO(stage2-live-unification): Presence/chat split vs liveStreams consolidation to be revisited.
// TODO(stage2-live-unification): Decide segment source here if segment presence logic is added later.
