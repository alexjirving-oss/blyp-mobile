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

export async function ensureUserProfile({ userId, displayName, photoURL, email } = {}) {
  const effectiveUserId = userId || auth.currentUser?.uid;
  if (!effectiveUserId) {
    console.warn("Cannot ensure user profile: No userId provided");
    return;
  }

  const ref = db.collection("users").doc(effectiveUserId);
  await ref.set({
    displayName: displayName || auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Anonymous",
    photoURL: photoURL ?? auth.currentUser?.photoURL ?? null,
    email: email ?? auth.currentUser?.email ?? null,
    updatedAt: serverTimestamp()
    // ❌ Removed forced status: "offline" to prevent overwriting "live" status
  }, { merge: true });
  
  console.log("✅ User profile ensured for:", effectiveUserId);
}

// ---------- STREAMS ----------
export async function createStream({ streamId, title, thumbnailUrl, userId }) {
  const uid = userId || auth.currentUser?.uid;
  if (!uid) {
    console.warn('[LiveService] createStream called without userId');
    return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in to stream' };
  }

  // Create/merge stream doc with merge:true to avoid overwriting
  await db.collection("streams").doc(streamId).set({
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

export async function endStream(streamId, userId) {
  const uid = userId || auth.currentUser?.uid;
  if (!uid) {
    console.warn('[LiveService] endStream called without userId');
    return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in' };
  }

  // Mark stream ended
  await db.collection("streams").doc(streamId).update({
    status: "ended",
    endedAt: serverTimestamp(),
  });

  // Update user profile to "offline" and clear streamId
  await setUserStatus(uid, "offline", null);
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
  const col = db.collection("streams").doc(streamId).collection("messages");
  return col.onSnapshot((snap) => {
    callback(snap.docs.map(dSnap => ({ id: dSnap.id, ...dSnap.data() })));
  }, (error) => {
    console.error('Error subscribing to stream messages:', error);
    callback([]);
  });
}
