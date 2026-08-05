import { db, auth } from '../config/firebase';
import { serverTimestamp, increment } from 'firebase/firestore';
import { snapExists, snapData } from '../utils/firestoreSnap';
import { filterBlocked } from './BlockService';
import { isDirectoryVisible } from './liveDirectory';

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

// A Cognito `sub` is a UUID. Some legacy/early-bridge writes saved the raw uid
// as the display name (when token attributes weren't hydrated yet). Treat such
// UUID/opaque-id values — and the user's own id — as placeholders so a real
// name replaces them on the next sign-in instead of sticking forever.
function looksLikeOpaqueId(value) {
  const t = String(value || '').trim();
  if (!t) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

function isPlaceholderName(name, userId) {
  if (!name) return true;
  const trimmed = String(name).trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_NAMES.includes(trimmed)) return true;
  if (userId && trimmed === String(userId).trim()) return true;
  if (looksLikeOpaqueId(trimmed)) return true;
  return false;
}

function toTrimmedString(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function pickHostIdentityFromUserDoc(userDocData, fallbackUserId) {
  const username = toTrimmedString(userDocData?.username || userDocData?.handle);
  const displayName = toTrimmedString(userDocData?.displayName);
  const photoURL = toTrimmedString(userDocData?.photoURL);

  // Prefer username; otherwise prefer non-placeholder displayName; otherwise fallback to uid.
  const bestDisplayName =
    username || (displayName && !isPlaceholderName(displayName, fallbackUserId) ? displayName : null) || fallbackUserId;

  return {
    hostUsername: username,
    hostDisplayName: bestDisplayName,
    hostPhotoURL: photoURL,
  };
}

// Session cache of inputs we've already reconciled, so repeated callers (login,
// auth bridge, etc.) don't re-read/re-write the same profile on a loop.
const ensuredProfiles = new Map();

function profileSignature({ displayName, username, photoURL, email }) {
  return JSON.stringify({
    d: typeof displayName === 'string' ? displayName.trim() : '',
    u: typeof username === 'string' ? username.trim() : '',
    p: photoURL === undefined ? '∅' : photoURL === null ? '' : String(photoURL).trim(),
    e: email === undefined ? '∅' : email === null ? '' : String(email).trim(),
  });
}

export async function ensureUserProfile({ userId, displayName, photoURL, email, username, birthdate, ageVerified } = {}) {
  if (!userId) {
    console.warn('[LiveService][ensureUserProfile] Missing userId, aborting profile ensure');
    return;
  }

  // Skip entirely if we've already reconciled these exact inputs this session.
  const incomingSig = profileSignature({ displayName, username, photoURL, email });
  if (ensuredProfiles.get(userId) === incomingSig) {
    return;
  }

  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();

  const existing = snapData(snap) || {};
  const existingDisplayName =
    typeof existing.displayName === 'string' && !isPlaceholderName(existing.displayName, userId)
      ? existing.displayName
      : null;

  const finalUsername = (() => {
    if (typeof username !== 'string') return null;
    const s = username.trim().replace(/^@/, '');
    if (!s) return null;
    // Never persist Cognito opaque ids / uuids as Blyp screen names.
    if (isPlaceholderName(s, userId)) return null;
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(s)) return null;
    return s;
  })();

  const finalPhotoURL = (() => {
    // Undefined means: don't touch existing value.
    // Null means: explicitly clear.
    if (photoURL === undefined) return undefined;
    if (photoURL === null) return null;
    if (typeof photoURL !== 'string') return null;
    const s = photoURL.trim();
    return s ? s : null;
  })();

  const finalEmail = (() => {
    // Undefined means: don't touch existing value.
    // Null means: explicitly clear.
    if (email === undefined) return undefined;
    if (email === null) return null;
    if (typeof email !== 'string') return null;
    const s = email.trim();
    return s ? s : null;
  })();

  // IMPORTANT:
  // - On normal login we call ensureUserProfile to create a doc if missing.
  // - We must NOT overwrite a meaningful, user-edited displayName on every login.
  // Strategy:
  //   * If an existing non-placeholder displayName exists, preserve it.
  //   * Otherwise prefer a real name: provided displayName -> username ->
  //     email local-part. Only fall back to the raw uid as an absolute last
  //     resort (and isPlaceholderName treats that as replaceable, so a real
  //     name takes over on the next sign-in that has identity).
  const emailForName =
    (typeof finalEmail === 'string' && finalEmail)
      ? finalEmail
      : (typeof existing.email === 'string' ? existing.email : '');
  const emailPrefix = emailForName ? String(emailForName).split('@')[0].trim() : '';

  let finalDisplayName;
  if (existingDisplayName) {
    finalDisplayName = existingDisplayName;
  } else {
    const incoming = typeof displayName === 'string' ? displayName.trim() : '';
    const safeIncoming = incoming && !isPlaceholderName(incoming, userId) ? incoming : '';
    const safeUser = finalUsername || '';
    const safeEmail = emailPrefix && !isPlaceholderName(emailPrefix, userId) ? emailPrefix : '';
    // Never fall back to raw uid as displayName — that made Profile show a UUID.
    finalDisplayName = safeIncoming || safeUser || safeEmail || 'User';
  }

  // Also repair an existing username that is an opaque Cognito id.
  const existingUsernameRaw = typeof existing.username === 'string' ? existing.username.trim() : '';
  const existingHandleRaw = typeof existing.handle === 'string' ? existing.handle.trim() : '';
  const existingUsernameBad =
    (existingUsernameRaw && isPlaceholderName(existingUsernameRaw, userId)) ||
    (existingHandleRaw && isPlaceholderName(existingHandleRaw, userId));
  // undefined = leave alone; null = clear bad value; string = set
  const usernameToWrite = finalUsername || (existingUsernameBad ? null : undefined);

  // Only write when something actually changed (or the doc doesn't exist yet).
  // This avoids bumping `updatedAt` on every login, which previously churned any
  // listener watching users/{uid} and cost a write per call.
  const finalBirthdate = (typeof birthdate === 'string' && birthdate.trim()) ? birthdate.trim() : undefined;
  const finalAgeVerified = ageVerified === true ? true : undefined;

  const needsWrite =
    !snapExists(snap) ||
    existing.sub !== userId ||
    existing.displayName !== finalDisplayName ||
    (usernameToWrite !== undefined && existing.username !== usernameToWrite) ||
    (usernameToWrite !== undefined && existing.handle !== usernameToWrite) ||
    (finalPhotoURL !== undefined && existing.photoURL !== finalPhotoURL) ||
    (finalEmail !== undefined && existing.email !== finalEmail) ||
    (finalBirthdate !== undefined && existing.birthdate !== finalBirthdate) ||
    (finalAgeVerified !== undefined && existing.ageVerified !== finalAgeVerified);

  if (needsWrite) {
    await ref.set(
      {
        sub: userId,
        displayName: finalDisplayName,
        ...(usernameToWrite !== undefined
          ? { username: usernameToWrite, handle: usernameToWrite }
          : {}),
        ...(finalPhotoURL !== undefined ? { photoURL: finalPhotoURL } : {}),
        ...(finalEmail !== undefined ? { email: finalEmail } : {}),
        ...(finalBirthdate !== undefined ? { birthdate: finalBirthdate } : {}),
        ...(finalAgeVerified !== undefined ? { ageVerified: finalAgeVerified } : {}),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    console.log('[LiveService][ensureUserProfile] wrote profile', {
      docPath: `users/${userId}`,
      created: !snapExists(snap),
    });
  }

  // Remember these inputs so identical subsequent calls are no-ops.
  ensuredProfiles.set(userId, incomingSig);
}

// ---------- STREAMS ----------
export async function createStream({ streamId, title, thumbnailUrl, userId }) {
  console.log('[LiveService][AUTH] createStream called with userId:', userId ? 'present' : 'MISSING');

  // CRITICAL: Trust userId param, do NOT fallback to auth.currentUser
  if (!userId || typeof userId !== 'string') {
    console.error('[LiveService][AUTH] createStream blocked: userId param missing or invalid');
    return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in to stream' };
  }

  try {
  // Enrich stream directory info with the host profile so viewers can render avatar + @username.
  let hostIdentity = { hostUsername: null, hostDisplayName: userId, hostPhotoURL: null };
  try {
    const userSnap = await db.collection('users').doc(userId).get();
    const userData = snapData(userSnap);
    hostIdentity = pickHostIdentityFromUserDoc(userData, userId);
  } catch (e) {
    console.warn('[LiveService][createStream] Failed to load host user profile; using fallbacks', {
      userId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Write to BOTH collections:
  // 1. streams collection (for stream metadata)
  await db.collection("streams").doc(streamId).set({
    hostUid: userId,
    hostDisplayName: hostIdentity.hostDisplayName,
    hostUsername: hostIdentity.hostUsername,
    hostPhotoURL: hostIdentity.hostPhotoURL,
    title,
    status: "live",
    directoryReady: true,
    createdAt: serverTimestamp(),
    viewerCount: 0,
    peakViewerCount: 0,
    totalViews: 0,
    likes: 0,
    thumbnailUrl: thumbnailUrl || null,
  }, { merge: true });

  // 2. liveStreams collection (for directory/discovery with heartbeat)
  await db.collection("liveStreams").doc(streamId).set({
    streamId,
    userId,
    hostUid: userId,
    hostDisplayName: hostIdentity.hostDisplayName,
    hostUsername: hostIdentity.hostUsername,
    hostPhotoURL: hostIdentity.hostPhotoURL,
    title,
    status: "live",
    directoryReady: true,
    viewerCount: 0,
    peakViewerCount: 0,
    totalViews: 0,
    likes: 0,
    lastHeartbeatAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    thumbnailUrl: thumbnailUrl || null,
  }, { merge: true });

  // Update user profile to "live" with streamId
  await setUserStatus(userId, "live", streamId);

  console.log('[LIVE][DIRECTORY][REGISTER_OK]', { streamId, userId });
  return { ok: true, streamId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[LIVE][DIRECTORY][REGISTER_FAIL]', { streamId, userId, message });
    return { ok: false, reason: 'REGISTER_FAILED', error: message };
  }
}

export async function endStream(streamId, userId) {
  console.log('[LiveService][AUTH] endStream called with userId:', userId ? 'present' : 'MISSING');

  // CRITICAL: Trust userId param, do NOT fallback to auth.currentUser
  if (!userId || typeof userId !== 'string') {
    console.error('[LiveService][AUTH] endStream blocked: userId param missing or invalid');
    return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in' };
  }

  // Mark stream ended in BOTH collections. Each update is independent so a
  // failure on one (e.g. a missing `streams` doc) never prevents the directory
  // (`liveStreams`) from being cleaned — otherwise the stream would keep showing
  // as "live" after the host ends it.
  // Reset concurrent viewerCount to 0 (no one is watching an ended stream), but
  // preserve cumulative stats (likes, totalViews, peakViewerCount) for the summary.
  try {
    await db.collection("streams").doc(streamId).update({
      status: "ended",
      endedAt: serverTimestamp(),
      viewerCount: 0,
    });
  } catch (error) {
    console.warn('[LiveService][endStream] streams update failed', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await db.collection("liveStreams").doc(streamId).update({
      status: "ended",
      endedAt: serverTimestamp(),
      viewerCount: 0,
    });
  } catch (error) {
    console.warn('[LiveService][endStream] liveStreams update failed', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Update user profile to "offline" and clear streamId (best-effort).
  try {
    await setUserStatus(userId, "offline", null);
  } catch (error) {
    console.warn('[LiveService][endStream] setUserStatus failed', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------- VIEWERS ----------
// Uses atomic FieldValue.increment so concurrent joins/leaves never clobber each
// other (the previous read-then-write pattern lost updates and let the counter
// drift / get stuck). After the atomic write we read back once to (a) clamp any
// negative drift to 0 and (b) maintain peakViewerCount, both best-effort.
export async function incrementViewer(streamId, delta) {
  if (!streamId || !Number.isFinite(delta) || delta === 0) return;

  const streamRef = db.collection("streams").doc(streamId);
  const liveStreamRef = db.collection("liveStreams").doc(streamId);

  const update = { viewerCount: increment(delta) };
  // totalViews is a monotonic, cumulative count of joins (never decremented).
  if (delta > 0) update.totalViews = increment(delta);

  try {
    await streamRef.update(update);
  } catch (error) {
    // Stream doc may not exist yet / already removed; nothing to count.
    return;
  }

  // Best-effort: clamp negatives, track peak, and mirror to the directory doc.
  try {
    const snap = await streamRef.get();
    const data = snapData(snap) || {};
    const rawCount = typeof data.viewerCount === 'number' ? data.viewerCount : 0;
    const clampedCount = Math.max(0, rawCount);
    const peak = typeof data.peakViewerCount === 'number' ? data.peakViewerCount : 0;

    const corrections = {};
    if (rawCount !== clampedCount) corrections.viewerCount = clampedCount;
    if (clampedCount > peak) corrections.peakViewerCount = clampedCount;
    if (Object.keys(corrections).length > 0) {
      await streamRef.update(corrections);
    }

    await liveStreamRef.update({
      viewerCount: clampedCount,
      ...(clampedCount > peak ? { peakViewerCount: clampedCount } : {}),
      ...(delta > 0 ? { totalViews: increment(delta) } : {}),
    });
  } catch (error) {
    console.warn('[LiveService][incrementViewer] post-write reconcile failed', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function incrementLikes(streamId, delta = 1) {
  if (!streamId || !Number.isFinite(delta) || delta === 0) return;

  const streamRef = db.collection('streams').doc(streamId);
  const liveStreamRef = db.collection('liveStreams').doc(streamId);

  try {
    await streamRef.update({ likes: increment(delta) });
  } catch (error) {
    // Stream doc may not exist; ignore.
    return;
  }

  try {
    await liveStreamRef.update({ likes: increment(delta) });
  } catch (error) {
    console.warn('[LiveService][incrementLikes] liveStreams mirror update failed', {
      streamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Refresh a live stream's heartbeat so the directory keeps it visible while the
// host is actually broadcasting. The directory query only returns streams whose
// lastHeartbeatAt is within a 90s grace window, so a host that crashes / is
// force-quit (and therefore stops sending heartbeats) naturally falls off the
// "live now" list instead of lingering as a stale, un-joinable card.
export async function heartbeatStream(streamId) {
  if (!streamId) return;
  try {
    await db.collection('liveStreams').doc(streamId).update({
      lastHeartbeatAt: serverTimestamp(),
    });
  } catch (error) {
    // Doc may be gone/ended; nothing to keep alive.
  }
}

// Mirror the on-stage guest roster onto the stream doc so that every viewer
// (not just the host, who is the only side with the IVS participant list) can
// see who is on stage and therefore choose to gift a guest, not only the host.
// `guests` is an array of { userId, name, photoUrl, slotIndex }.
export async function setLiveGuests(streamId, guests) {
  if (!streamId) return;
  try {
    await db.collection('liveStreams').doc(streamId).update({
      guests: Array.isArray(guests) ? guests.slice(0, 16) : [],
      guestsUpdatedAt: serverTimestamp(),
    });
  } catch (error) {
    // Doc may be gone/ended; non-fatal.
  }
}

/** Host-selected multi-guest composition; mirrored so every viewer matches. */
export async function setGuestLayoutMode(streamId, guestLayoutMode) {
  if (!streamId || !guestLayoutMode) return;
  try {
    await db.collection('liveStreams').doc(streamId).update({
      guestLayoutMode: String(guestLayoutMode),
      guestLayoutModeUpdatedAt: serverTimestamp(),
    });
  } catch (error) {
    // Doc may be gone/ended; non-fatal.
  }
}

/**
 * Mirror the active 1v1 match onto the stream doc so viewers (who joined without
 * a battleId route param) pick up MatchBar / dual-stage chrome in real time.
 * Pass null to clear after the live ends or the host dismisses the match UI.
 */
export async function setActiveBattleId(streamId, battleId) {
  if (!streamId) return;
  try {
    await db.collection('liveStreams').doc(streamId).update({
      activeBattleId: battleId ? String(battleId) : null,
      activeBattleIdUpdatedAt: serverTimestamp(),
    });
  } catch (error) {
    // Doc may be gone/ended; non-fatal.
  }
}

// ---------- GUEST REQUESTS (Firestore mirror) ----------
// The live-service owns the authoritative guest state machine, but the host's
// only way of LEARNING about a new request was a 2.5s poll of that service —
// which proved flaky in the field ("host never sees the request"). We mirror
// the request into Firestore, the channel that already delivers comments,
// viewer counts and the guest roster reliably, so the host gets an instant,
// dependable notification. Doc id is the requester's uid (one open request per
// viewer per stream). These are best-effort: a failure here never blocks the
// authoritative live-service request.
export async function mirrorGuestRequest(streamId, { userId, displayName, photoURL, slotIndex } = {}) {
  if (!streamId || !userId) return;
  try {
    await db.collection('liveStreams').doc(streamId)
      .collection('guestRequests').doc(userId)
      .set({
        userId,
        displayName: displayName || null,
        photoURL: photoURL || null,
        slotIndex: typeof slotIndex === 'number' ? slotIndex : null,
        status: 'REQUESTED',
        requestedAt: serverTimestamp(),
      }, { merge: true });
  } catch (error) {
    // Non-fatal: the live-service request is authoritative.
  }
}

export async function setGuestRequestStatus(streamId, userId, status) {
  if (!streamId || !userId || !status) return;
  try {
    await db.collection('liveStreams').doc(streamId)
      .collection('guestRequests').doc(userId)
      .set({ status, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    // Non-fatal.
  }
}

export async function clearGuestRequest(streamId, userId) {
  if (!streamId || !userId) return;
  try {
    await db.collection('liveStreams').doc(streamId)
      .collection('guestRequests').doc(userId)
      .delete();
  } catch (error) {
    // Non-fatal.
  }
}

// Host-side: subscribe to pending guest requests in real time. Calls back with
// an array of { userId, displayName, photoURL, slotIndex } for every request
// still in the REQUESTED state. Returns an unsubscribe function.
export function subscribeToGuestRequests(streamId, onChange) {
  if (!streamId || typeof onChange !== 'function') return () => {};
  try {
    return db.collection('liveStreams').doc(streamId)
      .collection('guestRequests')
      .onSnapshot(
        (snap) => {
          const out = [];
          snap.forEach((doc) => {
            const d = (doc && typeof doc.data === 'function' ? doc.data() : null) || {};
            if (d.status === 'REQUESTED') {
              out.push({
                userId: d.userId || doc.id,
                displayName: d.displayName || null,
                photoURL: d.photoURL || null,
                slotIndex: typeof d.slotIndex === 'number' ? d.slotIndex : null,
              });
            }
          });
          onChange(out);
        },
        () => { /* best-effort: poll path remains as fallback */ }
      );
  } catch (error) {
    return () => {};
  }
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

        const hostUid = data.hostUid || data.userId || null;
        const hostUsername =
          toTrimmedString(data.hostUsername || data.username || data.handle) || null;
        const hostDisplayName =
          toTrimmedString(data.hostDisplayName || data.userName || data.displayName) ||
          hostUsername ||
          hostUid ||
          'Unknown';
        const photoURL =
          toTrimmedString(data.hostPhotoURL || data.userPhotoURL || data.photoURL) || null;

        return {
          id: doc.id,
          streamId: data.streamId || doc.id,
          hostUid,
          hostUsername,
          hostDisplayName,
          photoURL,
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

      const registeredStreams = streams.filter((s) => {
        const raw = snapshot.docs.find((d) => d.id === s.id);
        return isDirectoryVisible(raw?.data?.() || {});
      });

      // Hide streams hosted by anyone the viewer has blocked. (Block list is
      // loaded into the BlockService cache at app start / sign-in.)
      const visibleStreams = filterBlocked(registeredStreams, (s) => s.hostUid);

      console.log('[LIVE][DIRECTORY][SNAPSHOT]', {
        count: visibleStreams.length,
        ids: visibleStreams.map(s => s.streamId),
        graceWindowMs: ACTIVE_GRACE_MS,
      });

      if (typeof onChange === 'function') {
        onChange(visibleStreams);
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
