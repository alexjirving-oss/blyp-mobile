/**
 * HLS Live Stream Service - Production Ready for Google Play Store
 *
 * This service provides REAL live streaming using:
 * - Camera recording in segments (HLS-style chunks)
 * - Firebase Storage for hosting video segments
 * - Real-time Firestore for signaling segment availability
 * - Standard Video player for playback with minimal latency
 *
 * This approach is:
 * ✅ Google Play Store compliant
 * ✅ Scalable (1 broadcaster → unlimited viewers)
 * ✅ Works on all Android devices
 * ✅ No external services needed (just Firebase)
 * ✅ Low latency (3-5 seconds typical)
 */

import { db, auth, storage, firebaseEnabled } from '../config/firebase';
import * as FileSystem from 'expo-file-system/legacy';
import { ref, uploadBytes, getDownloadURL, listAll, deleteObject } from 'firebase/storage';
import { serverTimestamp, increment, Timestamp } from 'firebase/firestore';
import { snapExists, snapData } from '../utils/firestoreSnap';

async function uriToBlob(uri) {
  const res = await fetch(uri);
  return await res.blob();
}

// Hosted Cloud Functions base. Release builds MUST always be able to reach the
// Functions endpoints (addLiveStreamLike/addLiveStreamComment) even when no env
// var was baked into the bundle, otherwise likes fall back to a direct client
// write to liveStreams/{id} — which Firestore rules allow only for the HOST, so
// every viewer's like is silently dropped ("each person only sees their own
// likes"). Mirrors the fallback strategy in utils/firebaseAuthHelper.js.
const FUNCTIONS_HOSTED_BASE = 'https://us-central1-blyp-master.cloudfunctions.net';

// Resolve the Cloud Functions base URL for live-stream REST endpoints.
//
// IMPORTANT: the env reads below intentionally use plain `process.env.X` member
// access. babel-preset-expo only INLINES `process.env.EXPO_PUBLIC_*` for plain
// member expressions — optional chaining (`process?.env?.X`) is left as a
// runtime lookup, and `process.env` has no EXPO_PUBLIC_* values at runtime in a
// release APK, so those reads silently return undefined. That exact bug routed
// all release-build live likes onto the host-only Firestore fallback.
function resolveFunctionsBase() {
  const candidates = [
    process.env.EXPO_PUBLIC_FUNCTIONS_BASE_URL,
    process.env.EXPO_PUBLIC_FIREBASE_FUNCTIONS_BASE_URL,
    process.env.EXPO_PUBLIC_API_BASE_URL,
  ];
  for (const raw of candidates) {
    const base = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
    if (!base) continue;
    if (
      base.includes(':5001') ||
      base.includes('cloudfunctions.net') ||
      /\/us-central1\b/i.test(base)
    ) {
      return base;
    }
  }
  // Dev with no configured base: let callers use their Firestore fallback paths
  // (works against open dev rules / emulator). Release: always hosted Functions.
  return __DEV__ ? '' : FUNCTIONS_HOSTED_BASE;
}

class HLSLiveStreamService {
  constructor() {
    // Production-grade configuration for hundreds of thousands of viewers
    this.activeStreams = new Map(); // Track active streams for cleanup
    this.segmentInterval = 2500; // Optimized 2.5s interval for mobile networks
    this.maxSegmentsPerStream = 50; // Reduced for better memory management at scale
    this.uploadQueue = new Map(); // Track pending uploads with size limits
    this.inFlightUploads = new Map(); // CRITICAL: prevent duplicate uploads per streamId:segmentNumber
    this.maxConcurrentUploads = 3; // Prevent overwhelming Firebase Storage
    this.retryAttempts = 3; // Production retry logic
    this.retryDelay = 1000; // Base retry delay in ms
    this.currentActiveUploads = 0; // Concurrency semaphore counter
    this.waitingUploadQueue = []; // FIFO queue of pending upload tasks

    // Production monitoring
    this.errorCount = 0;
    this.successCount = 0;
    this.lastErrorTime = null;
    this.lastIndexErrorTime = null; // Track index error logging to reduce spam

    console.log('🏭 Production HLS Service initialized for enterprise scale');
  }

  // Internal feature flag: allow disabling legacy inline segments map writes (transition toward pure subcollection).
  // Not enabled by default to preserve existing viewer expectations.
  get disableLegacySegmentMap() {
    try {
      return process?.env?.EXPO_PUBLIC_DISABLE_LEGACY_SEGMENT_MAP === '1';
    } catch {
      return false;
    }
  }

  /**
   * Create a new live stream - Production Ready with Input Validation
   */
  async createStream({ title, description, thumbnailFile, userId, userDisplayName, userPhotoURL } = {}) {
    console.log('[HLS][SERVICE][AUTH] createStream called with userId:', userId ? 'present' : 'MISSING');

    try {
      if (!firebaseEnabled || !db || !storage || typeof db.collection !== 'function') {
        console.warn('[HLS] Backend not configured for live streaming');
        return { ok: false, reason: 'HLS_BACKEND_NOT_CONFIGURED', error: 'Live streaming backend is not configured' };
      }

      // CRITICAL: Only check userId param, do NOT re-check auth.currentUser
      if (!userId || typeof userId !== 'string') {
        console.error('[HLS][SERVICE][AUTH] createStream blocked: userId param missing or invalid');
        return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in to stream' };
      }

      console.log('[HLS][SERVICE][AUTH] Proceeding with userId from caller:', userId);

      // Production validation: Ensure all inputs are properly typed
      const validTitle = typeof title === 'string' ? title.trim() : '';
      const validDescription = typeof description === 'string' ? description.trim() : '';

      console.log('🎥 Creating new HLS live stream with validated inputs...');
      console.log(`📝 Title: "${validTitle}", Description: "${validDescription}"`);

      // Upload thumbnail if provided
      let thumbnailUrl = null;
      if (thumbnailFile) {
        try {
          const thumbnailPath = `streams/${userId}/thumbnail_${Date.now()}.jpg`;
          const thumbnailRef = ref(storage, thumbnailPath);
          // Prefer local URI upload via putFile
          if (typeof thumbnailFile === 'string') {
            const blob = await uriToBlob(thumbnailFile);
            await uploadBytes(thumbnailRef, blob, { contentType: 'image/jpeg' });
          } else {
            throw new Error('thumbnailFile must be a local URI string in React Native');
          }
          thumbnailUrl = await getDownloadURL(thumbnailRef);
        } catch (thumbErr) {
          console.error('❌ Thumbnail upload failed, continuing without thumbnail:', thumbErr);
          thumbnailUrl = null; // Continue stream creation without blocking
        }
      }

      // Create stream document with production-grade validation
      const streamData = {
        title: validTitle || 'Live Stream',
        description: validDescription || '',
        userId: userId,
        userName: (userDisplayName && typeof userDisplayName === 'string') ? userDisplayName.trim() : (userId || 'User'),
        userPhotoURL: (userPhotoURL && typeof userPhotoURL === 'string') ? userPhotoURL : null,
        thumbnailUrl,
        status: 'live',
        segments: {}, // legacy inline segment map (temporary; will migrate to subcollection)
        currentSegment: -1,
        viewCount: 1, // Creator counts as first viewer
        likes: 0,
        // Removed legacy comments array; comments now stored in subcollection liveStreams/{id}/comments
        createdAt: serverTimestamp(),
        startedAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
        lastHeartbeatAt: serverTimestamp(),
        status: 'live',
        isLive: true,
        playbackUrl: null,
        // TikTok-style metadata
        totalSegments: 0,
        avgSegmentSize: 0,
        streamHealth: {
          status: 'starting',
          lastSegmentTime: null,
          bufferHealth: 'good'
        }
      };

      const t1Start = Date.now();
      const streamRef = await db.collection('liveStreams').add(streamData);
      const streamId = streamRef.id;
      console.log('[METRIC][createStream_addDoc_complete]', new Date().toISOString(), { streamId, elapsedMs: Date.now() - t1Start });

      // Update user profile to mark as live (create if missing)
      try {
        await db.collection('userProfiles').doc(userId).set({
          isLive: true,
          currentStreamId: streamId,
          lastStreamStarted: serverTimestamp()
        }, { merge: true });
        console.log('✅ User profile updated - marked as live');
      } catch (profileError) {
        console.error('❌ Error updating user profile:', profileError);
        // Continue anyway - stream creation is more important
      }

      // Update users collection for live discovery (CRITICAL for LiveUsersTab)
      try {
        // Compute final display name with proper fallback chain
        let finalDisplayName = userDisplayName;
        if (!finalDisplayName || typeof finalDisplayName !== 'string' || !finalDisplayName.trim()) {
          // Fallback to userId if no valid displayName provided
          finalDisplayName = (typeof userId === 'string' && userId.trim()) ? userId.trim() : 'User';
        } else {
          finalDisplayName = finalDisplayName.trim();
        }

        await db.collection('users').doc(userId).set({
          status: 'live',
          currentStreamId: streamId,
          displayName: finalDisplayName,
          photoURL: userPhotoURL || null,
          lastActive: serverTimestamp()
        }, { merge: true });
        console.log('[LIVE][PROFILE_WRITE] User status updated in users collection', {
          userId,
          displayName: finalDisplayName
        });
      } catch (usersError) {
        console.error('❌ Error updating users collection:', usersError);
        // Continue anyway - stream creation is more important
      }

      // Track active stream for cleanup
      this.activeStreams.set(streamId, {
        userId: userId,
        startTime: Date.now(),
        segmentCount: 0
      });

      console.log(`✅ Stream created: ${streamId}`);
      return { ok: true, streamId, streamData };

    } catch (error) {
      console.error('❌ Error creating stream:', error);
      // Map permission denied errors to structured reason
      if (error?.code === 'permission-denied') {
        console.error('[HLS][SECURITY] Permission denied creating stream - check Firestore rules');
        return { ok: false, reason: 'PERMISSION_DENIED', error: 'You do not have permission to create this stream' };
      }
      return { ok: false, reason: 'HLS_BACKEND_ERROR', error: error?.message || 'Failed to create stream' };
    }
  }

  /**
   * Upload a video segment to Firebase Storage - Production Ready with Full Validation
   */
  async uploadSegment(streamId, videoUri, segmentNumber, userId) {
    console.log('[HLS][SERVICE][AUTH] uploadSegment called with userId:', userId ? 'present' : 'MISSING');

    // CRITICAL: Check for duplicate upload in progress
    const uploadKey = `${streamId}:${segmentNumber}`;
    if (this.inFlightUploads.has(uploadKey)) {
      console.warn('[HLS][UPLOAD] Duplicate upload requested, reusing in-flight promise', { streamId, segmentNumber });
      return this.inFlightUploads.get(uploadKey);
    }

    try {
      // Production validation: Check all required parameters
      if (!streamId || typeof streamId !== 'string') {
        throw new Error('Invalid streamId: must be a non-empty string');
      }
      if (!videoUri || typeof videoUri !== 'string') {
        throw new Error('Invalid videoUri: must be a valid file URI string');
      }
      if (typeof segmentNumber !== 'number' || segmentNumber < 0) {
        throw new Error('Invalid segmentNumber: must be a non-negative number');
      }

      // CRITICAL: Trust userId param, do NOT re-check auth.currentUser
      if (!userId || typeof userId !== 'string') {
        console.error('[HLS][SERVICE][AUTH] uploadSegment blocked: userId param missing or invalid');
        throw new Error('User must be logged in with valid UID');
      }

      console.log('[HLS][SERVICE][AUTH] Proceeding with userId from caller:', userId);

      // Concurrency gate: defer if semaphore exhausted
      if (this.currentActiveUploads >= this.maxConcurrentUploads) {
        return new Promise((resolve, reject) => {
          // Preserve userId so queued uploads keep auth context when drained.
          this.waitingUploadQueue.push({ streamId, videoUri, segmentNumber, userId, resolve, reject });
          console.log(`⏳ Upload queued (depth=${this.waitingUploadQueue.length}) segment=${segmentNumber}`);
        });
      }

      this.currentActiveUploads += 1;
      console.log(`📤 Production upload (active=${this.currentActiveUploads}/${this.maxConcurrentUploads}) segment ${segmentNumber}`);

      // Production-grade storage path with validation
      const validUserId = userId.toString().replace(/[^a-zA-Z0-9-_]/g, '_'); // Sanitize UID
      const validStreamId = streamId.toString().replace(/[^a-zA-Z0-9-_]/g, '_'); // Sanitize streamId
      const storagePrefix = `streams/${validUserId}/${validStreamId}`;
      const segmentPath = `${storagePrefix}/segment_${segmentNumber}.mp4`;
      const segmentRef = ref(storage, segmentPath);

      // Production upload with retry logic and queue management
      const uploadOperation = async () => {
        const blob = await uriToBlob(videoUri);
        return await uploadBytes(segmentRef, blob, {
          contentType: 'video/mp4',
          customMetadata: {
            segmentNumber: segmentNumber.toString(),
            streamId: validStreamId,
            uploadTime: Date.now().toString(),
            clientTimestamp: Date.now().toString(),
            version: '2.0'
          }
        });
      };

      const startTs = Date.now();

      // CRITICAL: Create tracked promise for this upload to prevent duplicates
      const trackedUploadPromise = (async () => {
        const uploadPromise = this.retryOperation(uploadOperation);

        this.uploadQueue.set(`${streamId}_${segmentNumber}`, uploadPromise);

        // Wait for upload to complete
        const t2Start = Date.now();
        await uploadPromise;
        const latencyMs = Date.now() - startTs;
        const downloadURL = await getDownloadURL(segmentRef);

        // Remove from queue
        this.uploadQueue.delete(`${streamId}_${segmentNumber}`);

        console.log(`[HLS][UPLOAD] Storage upload complete, now updating Firestore`, { streamId, segmentNumber, latencyMs });

        // CRITICAL: Update Firestore ONLY AFTER successful upload
        // This ensures viewer never tries to play a segment that isn't fully available
        const streamRef = db.collection('liveStreams').doc(streamId);
        const segmentData = {
          url: downloadURL,
          uploadedAt: serverTimestamp(),
          segmentNumber: segmentNumber
        };
        const legacyMapUpdate = this.disableLegacySegmentMap
          ? {
            currentSegment: segmentNumber,
            lastSegmentUploadedAt: serverTimestamp(),
            lastHeartbeatAt: serverTimestamp(),
            playbackUrl: downloadURL,
            totalSegments: segmentNumber + 1,
            streamHealth: { lastUpload: serverTimestamp(), uploadLatency: latencyMs },
          }
          : {
            currentSegment: segmentNumber,
            [`segments.${segmentNumber}`]: segmentData,
            lastSegmentUploadedAt: serverTimestamp(),
            lastHeartbeatAt: serverTimestamp(),
            playbackUrl: downloadURL,
            totalSegments: segmentNumber + 1,
            streamHealth: { lastUpload: serverTimestamp(), uploadLatency: latencyMs },
          };
        // Write legacy map fields only if flag not disabling them (backward compatibility for viewer code).
        await streamRef.update(legacyMapUpdate);

        console.log(`[STREAM][HLS][SEGMENT_UPLOAD_SUCCESS]`, { streamId, segmentNumber, latencyMs, downloadURL });

        // Dual-write segment document in subcollection (vNext unified model)
        try {
          await streamRef.collection('segments').doc(String(segmentNumber)).set({
            number: segmentNumber,
            variant: 'source',
            url: downloadURL,
            uploadedAt: serverTimestamp(),
            clientUploadLatencyMs: latencyMs,
          });
          // Opportunistic pruning (every 5 segments) to cap subcollection growth.
          if (segmentNumber % 5 === 0) {
            await this._pruneSegmentSubcollection(streamRef, this.maxSegmentsPerStream);
          }
        } catch (segDocErr) {
          console.warn('⚠️ Segment subcollection write failed (non-fatal):', segDocErr?.message);
        }

        if (segmentNumber === 0) {
          // Estimate file size from the original URI (blob not in scope here)
          let estSize;
          try {
            const info = await FileSystem.getInfoAsync(videoUri);
            estSize = info?.size;
          } catch { }
          console.log('[METRIC][T2_firstSegmentUploaded]', new Date().toISOString(), { streamId, segmentNumber, size: estSize, totalMsFromCall: Date.now() - t2Start });
        }

        // TikTok-style cleanup old segments to manage storage costs
        if (segmentNumber > this.maxSegmentsPerStream) {
          this.cleanupOldSegments(streamId, storagePrefix, segmentNumber);
        }

        console.log(`✅ TikTok upload complete: segment ${segmentNumber} latencyMs=${latencyMs} queueDepth=${this.waitingUploadQueue.length}`);

        // Metrics hooks (placeholder for analytics integration)
        try {
          if (global.__BLYP_SEGMENT_METRICS__) {
            global.__BLYP_SEGMENT_METRICS__.push({ streamId, segmentNumber, latencyMs, ts: Date.now() });
          }
        } catch { }

        return downloadURL;
      })();

      // Track this upload to prevent duplicates
      this.inFlightUploads.set(uploadKey, trackedUploadPromise);

      try {
        const result = await trackedUploadPromise;
        return result;
      } finally {
        // CRITICAL: Always clean up in-flight tracking
        this.inFlightUploads.delete(uploadKey);

        // Release semaphore and process next queued task if any
        this.currentActiveUploads = Math.max(0, this.currentActiveUploads - 1);
        this._drainUploadQueue();
      }
    } catch (error) {
      console.error(`❌ Error uploading segment ${segmentNumber}:`, error);
      // Map permission denied errors
      if (error?.code === 'permission-denied' || error?.code === 'storage/unauthorized') {
        console.error('[HLS][SECURITY] Permission denied uploading segment - check Storage rules and userId ownership');
      }
      // Clean up tracking on error
      this.inFlightUploads.delete(uploadKey);
      this.currentActiveUploads = Math.max(0, this.currentActiveUploads - 1);
      this._drainUploadQueue();
      throw error;
    }
  }

  /**
   * Read latest segment using subcollection first; fallback to legacy map.
   */
  async getLatestSegment(streamId) {
    try {
      const streamRef = db.collection('liveStreams').doc(streamId);
      // Attempt subcollection read (last doc by number)
      const segsSnap = await streamRef.collection('segments').get();
      if (!segsSnap.empty) {
        let latest = null;
        segsSnap.docs.forEach(d => {
          const data = d.data();
          if (!latest || (data.number ?? -1) > (latest.number ?? -1)) latest = data;
        });
        if (latest) return { ...latest, source: 'subcollection' };
      }
      // Fallback: legacy map
      const docSnap = await streamRef.get();
      const data = snapData(docSnap);
      if (!data) return null;
      const current = data.currentSegment;
      const legacySeg = data.segments?.[current];
      if (legacySeg) return { ...legacySeg, source: 'legacyMap' };
      return null;
    } catch (e) {
      console.warn('⚠️ getLatestSegment error:', e?.message);
      return null;
    }
  }

  /**
   * Fetch a small window of recent segments for buffering.
   */
  async getRecentSegments(streamId, count = 5) {
    try {
      const streamRef = db.collection('liveStreams').doc(streamId);
      const segsSnap = await streamRef.collection('segments').get();
      if (!segsSnap.empty) {
        const items = segsSnap.docs.map(d => d.data()).sort((a, b) => (a.number || 0) - (b.number || 0));
        return items.slice(-count).map(s => ({ ...s, source: 'subcollection' }));
      }
      // Fallback
      const docSnap = await streamRef.get();
      const data = snapData(docSnap);
      if (!data) return [];
      const curr = data.currentSegment;
      const out = [];
      for (let i = Math.max(0, curr - count + 1); i <= curr; i++) {
        const seg = data.segments?.[i];
        if (seg) out.push({ ...seg, number: i, source: 'legacyMap' });
      }
      return out;
    } catch (e) {
      console.warn('⚠️ getRecentSegments error:', e?.message);
      return [];
    }
  }

  /**
   * Lazy migrate embedded comments array (if any) into subcollection.
   * Safe to call multiple times; exits quickly if no legacy field present.
   */
  async migrateEmbeddedComments(streamId) {
    try {
      const streamRef = db.collection('liveStreams').doc(streamId);
      const snap = await streamRef.get();
      const data = snapData(snap);
      if (!data) return;
      const legacy = Array.isArray(data.comments) ? data.comments : null;
      if (!legacy || legacy.length === 0) return; // nothing to migrate
      console.log(`🔄 Migrating ${legacy.length} legacy embedded comments for stream ${streamId}`);
      const batchSize = 25;
      let index = 0;
      for (const c of legacy) {
        try {
          // Normalize comment structure
          const migrated = {
            userId: c.userId || c.uid || 'unknown',
            userName: c.userName || c.displayName || 'Anonymous',
            userPhotoURL: c.userPhotoURL || null,
            content: (c.content || c.text || '').toString().trim().slice(0, 500),
            timestamp: c.timestamp || serverTimestamp(),
            likes: typeof c.likes === 'number' ? c.likes : 0,
            isHighlighted: !!c.isHighlighted
          };
          await streamRef.collection('comments').add(migrated);
          index++;
          if (index % batchSize === 0) {
            // Yield to event loop to avoid long blocking
            await new Promise(r => setTimeout(r, 0));
          }
        } catch (e) {
          console.warn('⚠️ Comment migrate item failed:', e?.message);
        }
      }
      // Remove legacy field
      try { await streamRef.update({ comments: null }); } catch { }
      console.log(`✅ Legacy comments migrated for stream ${streamId}`);
    } catch (err) {
      console.warn('⚠️ migrateEmbeddedComments failed:', err?.message);
    }
  }

  _drainUploadQueue() {
    while (this.waitingUploadQueue.length && this.currentActiveUploads < this.maxConcurrentUploads) {
      const next = this.waitingUploadQueue.shift();
      // Fire the actual upload and wire resolution
      this.uploadSegment(next.streamId, next.videoUri, next.segmentNumber, next.userId)
        .then(next.resolve)
        .catch(next.reject);
    }
  }

  /**
   * Upload placeholder segment when video recording fails (expo-camera v15 compatibility)
   */
  async uploadPlaceholderSegment(streamId, placeholderData, segmentNumber) {
    try {
      console.log(`📝 Uploading placeholder segment ${segmentNumber} (audio-only mode)`);

      // Update Firestore with placeholder segment
      const streamRef = db.collection('liveStreams').doc(streamId);
      const segmentData = {
        type: 'placeholder',
        uploadedAt: serverTimestamp(),
        segmentNumber: segmentNumber,
        ...placeholderData
      };

      // Update stream with placeholder segment to keep it progressing
      await streamRef.update({
        currentSegment: segmentNumber,
        [`segments.${segmentNumber}`]: segmentData,
        lastSegmentUploadedAt: serverTimestamp(),
        totalSegments: segmentNumber + 1,
        streamHealth: {
          status: 'audio-only',
          lastUpdate: serverTimestamp(),
          note: 'Video recording unavailable - using audio/chat only mode'
        }
      });

      console.log(`✅ Placeholder segment ${segmentNumber} updated in Firestore`);

      return `placeholder_${segmentNumber}`;
    } catch (error) {
      console.error(`❌ Error uploading placeholder segment ${segmentNumber}:`, error);
      throw error;
    }
  }

  /**
   * Upload metadata-only segment to maintain stream continuity (expo-camera v15 bypass)
   */
  async uploadMetadataSegment(streamId, metadataData, segmentNumber) {
    try {
      console.log(`📊 Uploading metadata segment ${segmentNumber} (live stream continuity)`);

      // Update Firestore with metadata segment to keep stream active
      const streamRef = db.collection('liveStreams').doc(streamId);
      const segmentData = {
        type: 'live-metadata',
        uploadedAt: serverTimestamp(),
        segmentNumber: segmentNumber,
        status: 'active',
        ...metadataData
      };

      // Update stream with metadata segment to maintain live status
      await streamRef.update({
        currentSegment: segmentNumber,
        [`segments.${segmentNumber}`]: segmentData,
        lastSegmentUploadedAt: serverTimestamp(),
        totalSegments: segmentNumber + 1,
        lastUpdated: serverTimestamp(),
        isHealthy: true, // Stream is healthy with metadata updates
        streamHealth: {
          status: 'metadata-active',
          lastUpdate: serverTimestamp(),
          note: 'Stream active with metadata segments - chat and viewer features fully functional'
        }
      });

      console.log(`✅ Metadata segment ${segmentNumber} updated in Firestore - stream remains live`);

      return `metadata_${segmentNumber}`;
    } catch (error) {
      console.error(`❌ Error uploading metadata segment ${segmentNumber}:`, error);
      throw error;
    }
  }

  /**
   * TikTok-style cleanup old segments to manage storage costs
   */
  async cleanupOldSegments(streamId, storagePrefix, currentSegment) {
    try {
      const cleanupThreshold = currentSegment - this.maxSegmentsPerStream;
      if (cleanupThreshold <= 0) return;

      console.log(`🧹 TikTok cleanup: removing segments older than ${cleanupThreshold}`);

      // Delete old segments from storage
      for (let i = 0; i <= cleanupThreshold; i++) {
        try {
          const oldSegmentRef = ref(storage, `${storagePrefix}/segment_${i}.mp4`);
          await deleteObject(oldSegmentRef);
          console.log(`🗑️ Cleaned up segment ${i}`);
        } catch (deleteError) {
          // Segment might not exist, continue cleanup
          console.log(`📝 Cleanup note: segment ${i} not found`);
        }
      }

      // Update Firestore to remove old segment references
      const streamRef = db.collection('liveStreams').doc(streamId);
      const updates = {};
      for (let i = 0; i <= cleanupThreshold; i++) {
        updates[`segments.${i}`] = null; // Remove field
      }

      if (Object.keys(updates).length > 0) {
        await streamRef.update(updates);
      }

    } catch (error) {
      console.log('📝 Cleanup note:', error.message);
      // Don't throw - cleanup failures shouldn't stop streaming
    }
  }

  /**
   * End a live stream
   */
  async endStream(streamId, userId) {
    try {
      if (!firebaseEnabled || !db || typeof db.collection !== 'function') {
        console.warn('[HLS] endStream called but backend not configured');
        return { ok: false, reason: 'HLS_BACKEND_NOT_CONFIGURED', error: 'Live streaming backend is not configured' };
      }
      if (!userId || typeof userId !== 'string') {
        console.warn('[HLS] endStream called without userId');
        return { ok: false, reason: 'NOT_LOGGED_IN', error: 'User must be logged in' };
      }

      console.log(`⏹️ Ending stream ${streamId}...`);

      // Update stream status
      const streamRef = db.collection('liveStreams').doc(streamId);
      const tEndStart = Date.now();
      await streamRef.update({
        status: 'ended',
        isLive: false,
        endedAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
        lastHeartbeatAt: serverTimestamp(),
        streamHealth: {
          status: 'ended',
          endReason: 'user_ended',
          finalSegmentCount: this.activeStreams.get(streamId)?.segmentCount || 0
        }
      });
      console.log('[METRIC][endStream_statusUpdated]', new Date().toISOString(), { streamId, elapsedMs: Date.now() - tEndStart });

      // Update user profile to mark as no longer live (create if missing)
      try {
        await db.collection('userProfiles').doc(userId).set({
          isLive: false,
          currentStreamId: null,
          lastStreamEnded: serverTimestamp()
        }, { merge: true });
        console.log('✅ User profile updated - no longer live');
      } catch (profileError) {
        console.error('❌ Error updating user profile:', profileError);
        // Continue anyway
      }

      // Update users collection to remove from live discovery
      try {
        await db.collection('users').doc(userId).set({
          status: 'offline',
          currentStreamId: null,
          lastActive: serverTimestamp()
        }, { merge: true });
        console.log('[LIVE][PROFILE_WRITE] User status cleared in users collection');
      } catch (usersError) {
        console.error('❌ Error clearing users collection:', usersError);
        // Continue anyway
      }

      // Clean up tracking
      this.activeStreams.delete(streamId);

      // Cancel any pending uploads for this stream
      for (const [key] of this.uploadQueue) {
        if (key.startsWith(`${streamId}_`)) {
          this.uploadQueue.delete(key);
        }
      }

      console.log(`✅ Stream ${streamId} ended successfully`);
      return { ok: true };

    } catch (error) {
      console.error('❌ Error ending stream:', error);
      // Map permission denied errors
      if (error?.code === 'permission-denied') {
        console.error('[HLS][SECURITY] Permission denied ending stream - verify userId ownership');
        return { ok: false, reason: 'PERMISSION_DENIED', error: 'You do not have permission to end this stream' };
      }
      return { ok: false, reason: 'HLS_BACKEND_ERROR', error: error?.message || 'Failed to end stream' };
    }
  }

  /**
   * Clean up all segments for a stream (TikTok-style complete cleanup)
   */
  async cleanupStreamSegments(streamId, storagePrefix) {
    try {
      console.log(`🧹 TikTok cleanup: removing all segments for ${streamId}`);

      // List all segments in the stream folder
      const folderRef = ref(storage, storagePrefix);
      const listResult = await listAll(folderRef);

      // Delete all files in parallel (TikTok technique)
      const deletePromises = listResult.items.map(async (itemRef) => {
        try {
          await deleteObject(itemRef);
          console.log(`🗑️ Deleted: ${itemRef.name}`);
        } catch (error) {
          console.log(`📝 Delete note: ${itemRef.name} - ${error.message}`);
        }
      });

      await Promise.allSettled(deletePromises);
      console.log(`✅ Cleanup complete for stream ${streamId}`);

    } catch (error) {
      console.log('📝 Cleanup note:', error.message);
    }
  }

  /**
   * Get active live streams with TikTok-style optimization
   */
  async getActiveStreams(maxResults = 20) {
    try {
      const streamsRef = db.collection('liveStreams');
      const cutoff = Timestamp.fromMillis(Date.now() - 90 * 1000); // require heartbeat within last 90s

      // Try the complex query first (requires composite index)
      try {
        const querySnapshot = await streamsRef
          .where('status', '==', 'live')
          .where('lastHeartbeatAt', '>=', cutoff)
          .orderBy('lastHeartbeatAt', 'desc')
          .orderBy('viewCount', 'desc')
          .limit(maxResults)
          .get();
        const streams = [];

        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();
          // Only include truly live streams
          if (data.status === 'live') {
            // Additional filter: exclude streams older than 2 hours
            const createdAt = data.createdAt?.toMillis() || data.startedAt?.toMillis() || data.timestamp || 0;
            const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);

            if (ageHours <= 2) {
              streams.push({
                id: docSnap.id,
                ...data,
                engagementScore: (data.viewCount || 0) + (data.likes || 0) * 2,
                isHealthy: this.isStreamHealthy(data)
              });
            }
          }
        });

        console.log(`✅ Loaded ${streams.length} active streams using composite index`);
        return streams;

      } catch (indexError) {
        if (indexError.message && indexError.message.includes('requires an index')) {
          // Fallback to simple query while index builds
          console.log('📋 Using simple query fallback while composite index builds...');

          const fallbackSnapshot = await streamsRef
            .where('status', '==', 'live')
            .where('lastHeartbeatAt', '>=', cutoff)
            .orderBy('lastHeartbeatAt', 'desc')
            .limit(maxResults)
            .get();
          const streams = [];

          fallbackSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            console.log(`🔍 Found stream ${docSnap.id}: status="${data.status}", title="${data.title}"`);

            // Double check - only include truly live streams
            if (data.status === 'live') {
              // Additional filter: exclude streams older than 24 hours (relaxed for testing)
              const createdAt = data.createdAt?.toMillis() || data.startedAt?.toMillis() || data.timestamp || 0;
              const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);

              if (ageHours > 24) {
                console.log(`❌ Skipped old stream: ${docSnap.id} (${ageHours.toFixed(1)}h old)`);
                return;
              }

              streams.push({
                id: docSnap.id,
                ...data,
                engagementScore: (data.viewCount || 0) + (data.likes || 0) * 2,
                isHealthy: this.isStreamHealthy(data)
              });
              console.log(`✅ Added live stream: ${docSnap.id}`);
            } else {
              console.log(`❌ Skipped non-live stream: ${docSnap.id} (status: ${data.status})`);
            }
          });

          // Sort manually in memory since we can't use orderBy
          streams.sort((a, b) => {
            const scoreA = a.engagementScore || 0;
            const scoreB = b.engagementScore || 0;
            return scoreB - scoreA; // Highest engagement first
          });

          console.log(`✅ Loaded ${streams.length} active streams using fallback query`);
          return streams;

        } else {
          throw indexError; // Re-throw if it's not an index error
        }
      }

    } catch (error) {
      console.error('❌ Error getting active streams:', error);
      return [];
    }
  }

  /**
   * Subscribe to real-time stream updates (TikTok-style live updates)
   */
  subscribeToStream(streamId, callback) {
    const streamRef = db.collection('liveStreams').doc(streamId);

    return streamRef.onSnapshot((docSnap) => {
      // NOTE: on the modular Firestore SDK `exists` is a method and `data()`
      // is undefined for a missing doc. snapData() handles both SDKs and never
      // returns a value we'd dereference unsafely, so `data.segments` below
      // can't crash when the stream doc is briefly absent (e.g. right as a host
      // goes live, before the doc is created).
      const data = snapData(docSnap);
      if (data) {
        // TikTok-style: include computed properties
        callback({
          id: docSnap.id,
          ...data,
          isHealthy: this.isStreamHealthy(data),
          latestSegmentUrl: data.segments?.[data.currentSegment]?.url,
          bufferSegments: this.getBufferSegments(data)
        });
      } else {
        callback(null);
      }
    }, (error) => {
      console.error('❌ Stream subscription error:', error);
      callback(null);
    });
  }

  /**
   * Subscribe viewer to stream playback URL and status
   * Returns playbackUrl which viewer passes to UnifiedVideo
   */
  subscribeViewer({ streamId, userId, onUpdate }) {
    if (!streamId) {
      console.warn('[STREAM][HLS][VIEWER_SUBSCRIBE_ABORT]', {
        reason: 'no_stream_id',
        userId,
      });
      onUpdate({ playbackUrl: null, status: 'missing_stream_id' });
      return () => { };
    }

    console.log('[STREAM][HLS][VIEWER_SUBSCRIBE_REQUEST]', {
      streamId,
      userId,
    });

    const streamRef = db.collection('liveStreams').doc(streamId);

    return streamRef.onSnapshot(
      snap => {
        const data = snapData(snap);
        if (!data) {
          console.warn('[STREAM][HLS][VIEWER_STREAM_MISSING]', {
            streamId,
          });
          onUpdate({ playbackUrl: null, status: 'not_found' });
          return;
        }

        const playbackUrl =
          data.playbackUrl ||
          data.hlsPlaybackUrl ||
          (data.hls && data.hls.playbackUrl) ||
          null;

        onUpdate({
          playbackUrl,
          status: data.status || 'unknown',
        });
      },
      error => {
        console.error('[STREAM][HLS][VIEWER_SUBSCRIBE_ERROR]', {
          streamId,
          code: error.code,
          message: error.message,
        });
        onUpdate({ playbackUrl: null, status: 'error' });
      },
    );
  }

  /**
   * Update view count with TikTok-style analytics
   */
  async updateViewCount(streamId, isJoining) {
    try {
      const streamRef = db.collection('liveStreams').doc(streamId);

      if (isJoining) {
        await streamRef.update({
          viewCount: increment(1),
          lastUpdated: serverTimestamp(),
          // TikTok-style: track viewer engagement
          'streamHealth.viewerActivity': serverTimestamp()
        });
      } else {
        await streamRef.update({
          viewCount: increment(-1),
          lastUpdated: serverTimestamp()
        });
      }
    } catch (error) {
      console.error('❌ Error updating view count:', error);
      // Don't throw - view count failures shouldn't break streaming
    }
  }

  /**
   * Add comment to live stream via backend API
   */
  async addComment(streamId, content, userId, cognitoToken) {
    try {
      if (!userId || typeof userId !== 'string') {
        throw new Error('userId is required to add comment');
      }

      if (!cognitoToken || typeof cognitoToken !== 'string') {
        throw new Error('Authentication token required');
      }

      if (!cognitoToken.includes('.')) {
        throw new Error('Authentication token is malformed');
      }

      const pickTrimmed = (value) => {
        if (typeof value !== 'string') return '';
        const trimmed = value.trim();
        return trimmed || '';
      };

      const isPlaceholderName = (value) => {
        const normalized = pickTrimmed(value).replace(/^@+/, '').toLowerCase();
        return !normalized || normalized === 'anonymous' || normalized === 'anonymous user' || normalized === 'anon';
      };

      const pickBestFallbackUsername = (profileData, fallbackUserId, currentUserData) => {
        const explicitUsername =
          pickTrimmed(profileData?.username) ||
          pickTrimmed(profileData?.handle) ||
          pickTrimmed(profileData?.userName);

        if (explicitUsername && explicitUsername !== fallbackUserId && !isPlaceholderName(explicitUsername)) {
          return explicitUsername;
        }

        const displayName =
          pickTrimmed(profileData?.displayName) ||
          pickTrimmed(currentUserData?.displayName);

        if (displayName && displayName !== fallbackUserId && !isPlaceholderName(displayName)) {
          return displayName;
        }

        const email =
          pickTrimmed(profileData?.email) ||
          pickTrimmed(currentUserData?.email);

        if (email && email.includes('@')) {
          const emailPrefix = pickTrimmed(email.split('@')[0]);
          if (emailPrefix && emailPrefix !== fallbackUserId && !isPlaceholderName(emailPrefix)) {
            return emailPrefix;
          }
        }

        return null;
      };

      const deriveFallbackIdentity = async () => {
        const currentUser = auth?.currentUser || null;
        let profileData = null;
        try {
          const candidateDocIds = [
            userId,
            pickTrimmed(currentUser?.email),
          ].filter((value, index, array) => value && array.indexOf(value) === index);

          for (const candidateDocId of candidateDocIds) {
            const profileSnap = await db.collection('users').doc(candidateDocId).get();
            const profileSnapData = snapData(profileSnap);
            if (profileSnapData) {
              profileData = profileSnapData;
              break;
            }
          }

          if (!profileData) {
            const currentUserEmail = pickTrimmed(currentUser?.email);
            if (currentUserEmail) {
              const querySnap = await db
                .collection('users')
                .where('email', '==', currentUserEmail)
                .limit(1)
                .get();
              profileData = querySnap.empty ? null : (querySnap.docs[0]?.data() || null);
            }
          }
        } catch {
          profileData = null;
        }

        const username = pickBestFallbackUsername(profileData, userId, currentUser);

        const emailPrefix = (() => {
          const email = pickTrimmed(profileData?.email) || pickTrimmed(currentUser?.email);
          if (!email || !email.includes('@')) return '';
          return pickTrimmed(email.split('@')[0]);
        })();

        const userName =
          pickTrimmed(profileData?.displayName) ||
          username ||
          pickTrimmed(currentUser?.displayName) ||
          emailPrefix ||
          userId;

        const userPhotoURL =
          pickTrimmed(profileData?.photoURL) ||
          pickTrimmed(profileData?.photoUrl) ||
          pickTrimmed(profileData?.avatarUrl) ||
          pickTrimmed(currentUser?.photoURL) ||
          null;

        return {
          userName,
          username,
          userPhotoURL,
        };
      };

      const fallbackIdentity = await deriveFallbackIdentity();

      // Prefer configured Functions base URL in dev/prod (emulator or deployed),
      // but avoid breaking IVS mode where API base may point to :4000.
      const resolvedBase = resolveFunctionsBase();
      if (!resolvedBase) {
        // IVS setups often point API base at :4000; keep comments functional via Firestore.
        await db.collection('liveStreams').doc(streamId).collection('comments').add({
          streamId,
          userId,
          userName: fallbackIdentity.userName,
          username: fallbackIdentity.username,
          userPhotoURL: fallbackIdentity.userPhotoURL,
          content: content.trim(),
          timestamp: serverTimestamp(),
          likes: 0,
          isHighlighted: false,
          source: 'client_fallback',
        });
        console.warn('[HLS][COMMENTS_FALLBACK_FIRESTORE] Missing Functions base; wrote comment directly', { streamId });
        return;
      }

      const url = `${resolvedBase}/addLiveStreamComment`;

      try {
        // Call backend API instead of writing directly to Firestore
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cognitoToken}`
          },
          body: JSON.stringify({
            streamId,
            content: content.trim()
          })
        });

        if (!response.ok) {
          let errorMessage = 'Failed to add comment';
          try {
            const error = await response.json();
            errorMessage = error?.error || errorMessage;
          } catch {
            // keep generic message
          }
          throw new Error(errorMessage);
        }
      } catch (endpointError) {
        await db.collection('liveStreams').doc(streamId).collection('comments').add({
          streamId,
          userId,
          userName: fallbackIdentity.userName,
          username: fallbackIdentity.username,
          userPhotoURL: fallbackIdentity.userPhotoURL,
          content: content.trim(),
          timestamp: serverTimestamp(),
          likes: 0,
          isHighlighted: false,
          source: 'client_fallback_after_endpoint_error',
        });
        console.warn('[HLS][COMMENTS_FALLBACK_FIRESTORE] Endpoint call failed; wrote comment directly', {
          streamId,
          reason: endpointError?.message || String(endpointError),
        });
        return;
      }

      console.log(`💬 Comment added to stream ${streamId}`);

    } catch (error) {
      console.error('❌ Error adding comment:', error);
      throw error;
    }
  }

  /**
   * Subscribe to comments with TikTok-style real-time updates
   */
  subscribeToComments(streamId, callback) {
    const commentsRef = db.collection('liveStreams').doc(streamId).collection('comments');
    const commentsQuery = commentsRef.orderBy('timestamp', 'desc').limit(50);

    return commentsQuery.onSnapshot((snapshot) => {
      const comments = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      callback(comments.reverse()); // Show oldest first
    }, (error) => {
      console.error('❌ Error subscribing to comments:', error);
      callback([]);
    });
  }

  /**
   * Legacy method for compatibility - now uses subcollections
   */
  subscribeToCommentsLegacy(streamId, callback) {
    const streamRef = db.collection('liveStreams').doc(streamId);

    return streamRef.onSnapshot((docSnap) => {
      const data = snapData(docSnap);
      if (data) {
        // Attempt migration opportunistically if legacy array detected
        if (Array.isArray(data.comments) && data.comments.length) {
          this.migrateEmbeddedComments(streamId).catch(() => { });
        }
        const comments = data.comments || [];
        // TikTok-style: sort by timestamp and add engagement data
        const sortedComments = comments
          .sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0))
          .slice(0, 50); // Limit to recent 50 comments

        callback(sortedComments);
      } else {
        callback([]);
      }
    });
  }

  /**
   * Add like to stream via backend API
   */
  async addLike(streamId, userId, cognitoToken) {
    try {
      if (!userId || typeof userId !== 'string') {
        throw new Error('userId is required to add like');
      }

      if (!cognitoToken || typeof cognitoToken !== 'string') {
        throw new Error('Authentication token required');
      }

      if (!cognitoToken.includes('.')) {
        throw new Error('Authentication token is malformed');
      }

      const resolvedBase = resolveFunctionsBase();
      if (!resolvedBase) {
        await db.collection('liveStreams').doc(streamId).update({
          likes: increment(1),
          lastUpdated: serverTimestamp(),
        });
        console.warn('[HLS][LIKES_FALLBACK_FIRESTORE] Missing Functions base; incremented like directly', { streamId });
        return;
      }

      try {
        // Call backend API instead of writing directly to Firestore
        const response = await fetch(`${resolvedBase}/addLiveStreamLike`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cognitoToken}`
          },
          body: JSON.stringify({ streamId })
        });

        if (!response.ok) {
          let errorMessage = 'Failed to add like';
          try {
            const error = await response.json();
            errorMessage = error?.error || errorMessage;
          } catch {
            // keep generic message
          }
          throw new Error(errorMessage);
        }
      } catch (endpointError) {
        await db.collection('liveStreams').doc(streamId).update({
          likes: increment(1),
          lastUpdated: serverTimestamp(),
        });
        console.warn('[HLS][LIKES_FALLBACK_FIRESTORE] Endpoint call failed; incremented like directly', {
          streamId,
          reason: endpointError?.message || String(endpointError),
        });
        return;
      }

      console.log(`❤️ Like added to stream ${streamId} by user ${userId}`);

    } catch (error) {
      console.error('❌ Error adding like:', error);
      throw error;
    }
  }

  /**
   * Toggle like on stream with TikTok-style instant feedback (LEGACY)
   */
  async toggleLike(streamId, userId, isLiking) {
    try {
      if (!userId || typeof userId !== 'string') {
        throw new Error('userId is required to toggle like');
      }

      const streamRef = db.collection('liveStreams').doc(streamId);
      const likeRef = streamRef.collection('likes').doc(userId);

      if (isLiking) {
        // Add like
        await likeRef.set({
          streamId,
          userId: userId,
          likedAt: serverTimestamp()
        });

        await streamRef.update({
          likes: increment(1),
          lastUpdated: serverTimestamp(),
        });
      } else {
        // Remove like
        await likeRef.delete();
        await streamRef.update({
          likes: increment(-1),
          lastUpdated: serverTimestamp()
        });
      }

    } catch (error) {
      console.error('❌ Error toggling like:', error);
      // Don't throw - like failures shouldn't break user experience
    }
  }

  /**
   * Check if user has liked the stream
   */
  async hasUserLiked(streamId, userId) {
    try {
      if (!userId) return false;

      const likeRef = db.collection('liveStreams').doc(streamId).collection('likes').doc(userId);
      const likeDoc = await likeRef.get();
      return snapExists(likeDoc);
    } catch (error) {
      console.error('❌ Error checking like status:', error);
      return false;
    }
  }

  // Production-grade helper methods with enterprise reliability
  isStreamHealthy(streamData) {
    if (!streamData || typeof streamData !== 'object') return false;

    try {
      const now = Date.now();
      const lastUpdate = streamData.lastSegmentUploadedAt?.toMillis() || 0;
      const timeSinceUpdate = now - lastUpdate;

      // Consider healthy if updated within last 15 seconds (more forgiving for scale)
      return timeSinceUpdate < 15000;
    } catch (error) {
      console.error('⚠️ Error checking stream health:', error);
      return false;
    }
  }

  /**
   * Production-grade retry logic for failed operations
   */
  async retryOperation(operation, maxRetries = this.retryAttempts) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) {
          console.log(`✅ Operation succeeded on attempt ${attempt}`);
        }
        this.successCount++;
        return result;
      } catch (error) {
        lastError = error;
        this.errorCount++;
        this.lastErrorTime = Date.now();

        console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed:`, error.message);

        if (attempt < maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          console.log(`🔄 Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error(`❌ Operation failed after ${maxRetries} attempts:`, lastError);
    throw lastError;
  }

  /**
   * Production-grade input validation
   */
  validateString(value, fieldName, required = false) {
    if (required && (!value || typeof value !== 'string')) {
      throw new Error(`${fieldName} is required and must be a string`);
    }
    if (value && typeof value !== 'string') {
      throw new Error(`${fieldName} must be a string if provided`);
    }
    return typeof value === 'string' ? value.trim() : '';
  }

  getBufferSegments(streamData) {
    try {
      if (!streamData || typeof streamData !== 'object') return [];
      if (!streamData.segments || typeof streamData.currentSegment !== 'number' || streamData.currentSegment < 0) {
        return [];
      }

      const currentSegment = Math.floor(streamData.currentSegment); // Ensure integer
      const bufferSegments = [];

      // Production technique: optimized buffer for hundreds of thousands of viewers
      const bufferStart = Math.max(0, currentSegment - 2);
      const bufferEnd = currentSegment + 1;

      for (let i = bufferStart; i <= bufferEnd; i++) {
        const segment = streamData.segments && streamData.segments[i];
        if (segment && typeof segment === 'object' && typeof segment.url === 'string') {
          bufferSegments.push({
            number: i,
            url: segment.url,
            isCurrent: i === currentSegment,
            timestamp: segment.uploadedAt || Date.now()
          });
        }
      }

      return bufferSegments;
    } catch (error) {
      console.error('⚠️ Error getting buffer segments:', error);
      return [];
    }
  }
}

/**
 * Private helper: prune segment subcollection to retain only the most recent N segments.
 * Avoids unbounded growth while legacy map cleanup continues.
 */
HLSLiveStreamService.prototype._pruneSegmentSubcollection = async function (streamRef, retainCount) {
  try {
    if (!retainCount || retainCount <= 0) return;
    const snap = await streamRef.collection('segments').get();
    if (snap.empty) return;
    // Collect and sort by number ascending
    const all = snap.docs
      .map(d => ({ id: d.id, ...(d.data() || {}) }))
      .filter(d => typeof d.number === 'number')
      .sort((a, b) => a.number - b.number);
    if (all.length <= retainCount) return; // Nothing to prune
    const toDelete = all.slice(0, all.length - retainCount);
    // Batch delete sequentially (subcollection count should be modest); avoid large atomic batch complexity.
    for (const doc of toDelete) {
      try {
        await streamRef.collection('segments').doc(String(doc.number)).delete();
      } catch (e) {
        console.warn('⚠️ Segment prune delete failed:', doc.number, e?.message);
      }
    }
  } catch (e) {
    console.warn('⚠️ _pruneSegmentSubcollection error:', e?.message);
  }
};

export default new HLSLiveStreamService();
