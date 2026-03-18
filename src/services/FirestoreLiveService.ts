import {
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  Timestamp,
  getDoc
} from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import * as FirebaseConfig from '../config/firebase';
// Unified live model constants & flags
import {
  PRESENCE_STREAMS_COLLECTION,
  ENABLE_LIVE_FEATURES,
  LIVE_STREAMS_COLLECTION,
  SEGMENTS_SUBCOLLECTION,
  ENABLE_LIVE_SEGMENTS_SUBCOLLECTION,
  ENABLE_LEGACY_SEGMENTS_MAP,
} from '../config/liveStreamModel';
// Bind the modular Firestore instance to a typed const for use below
const db = (FirebaseConfig as unknown as { firestore: unknown }).firestore as Firestore;

export interface StreamData {
  streamId: string;
  hostUid: string;
  title: string;
  thumbnailUrl?: string;
}

export interface MessageData {
  uid: string;
  displayName: string;
  text: string;
}

/**
 * Create a new live stream document in Firestore
 */
export async function createStream({
  streamId,
  hostUid,
  title,
  thumbnailUrl
}: StreamData): Promise<void> {
  try {
    if (!ENABLE_LIVE_FEATURES) {
      console.warn('[LIVE] createStream disabled by kill switch');
      return;
    }
    // Presence/chat collection retains legacy tracking; main live video docs are in LIVE_STREAMS_COLLECTION
    await setDoc(doc(db, PRESENCE_STREAMS_COLLECTION, streamId), {
      hostUid,
      title,
      status: 'live',
      createdAt: serverTimestamp(),
      viewerCount: 0,
      thumbnailUrl: thumbnailUrl ?? null,
    }, { merge: true });
    
    console.log('✅ Stream created:', streamId);
  } catch (error) {
    console.error('❌ Error creating stream:', error);
    throw error;
  }
}

/**
 * Mark a stream as ended
 */
export async function endStream(streamId: string): Promise<void> {
  try {
    if (!ENABLE_LIVE_FEATURES) {
      console.warn('[LIVE] endStream disabled by kill switch');
      return;
    }
    await updateDoc(doc(db, PRESENCE_STREAMS_COLLECTION, streamId), {
      status: 'ended',
      endedAt: serverTimestamp(),
    });
    
    console.log('✅ Stream ended:', streamId);
  } catch (error) {
    console.error('❌ Error ending stream:', error);
    throw error;
  }
}

/**
 * Atomically increment/decrement viewer count
 * @param delta +1 to increment, -1 to decrement
 */
export async function incrementViewer(streamId: string, delta: number): Promise<void> {
  const ref = doc(db, PRESENCE_STREAMS_COLLECTION, streamId);
  
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        console.warn('⚠️ Stream does not exist:', streamId);
        return;
      }
      
      const current = snap.data().viewerCount ?? 0;
      const newCount = Math.max(0, current + delta);
      
      tx.update(ref, { viewerCount: newCount });
      console.log(`📊 Viewer count updated: ${current} → ${newCount}`);
    });
  } catch (error) {
    console.error('❌ Error updating viewer count:', error);
    // Don't throw - viewer count is non-critical
  }
}

/**
 * Send a chat message to the stream
 */
export async function sendMessage(
  streamId: string,
  { uid, displayName, text }: MessageData
): Promise<void> {
  // Validate input
  if (!text || text.trim().length === 0) {
    throw new Error('Message text cannot be empty');
  }
  
  if (text.length > 500) {
    throw new Error('Message too long (max 500 characters)');
  }
  
  try {
    if (!ENABLE_LIVE_FEATURES) {
      console.warn('[LIVE] sendMessage disabled by kill switch');
      return;
    }
    const col = collection(db, PRESENCE_STREAMS_COLLECTION, streamId, 'messages');
    await addDoc(col, {
      uid,
      displayName: displayName || 'Anonymous',
      text: text.trim(),
      createdAt: serverTimestamp(),
    });
    
    console.log('💬 Message sent:', text.substring(0, 30));
  } catch (error) {
    console.error('❌ Error sending message:', error);
    throw error;
  }
}
/**
 * Get stream data (for testing/debugging)
 */
export async function getStreamData(streamId: string) {
  const snap = await getDoc(doc(db, PRESENCE_STREAMS_COLLECTION, streamId));
  return snap.exists() ? snap.data() : null;
}

// TODO(stage2-live-unification): Migrate presence/chat into unified liveStreams or keep separate domain boundary.
// TODO(stage2-live-unification): Segment writes/reads to use LIVE_STREAMS_COLLECTION + SEGMENTS_SUBCOLLECTION directly in a future pass.