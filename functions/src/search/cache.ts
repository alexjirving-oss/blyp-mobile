/**
 * Firestore-backed response cache. Keeps supplier costs down and makes repeat
 * queries instant. Keyed by queryHash (query + coarse country).
 */

import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { COLLECTIONS, SCHEMA_VERSION, SearchCacheDoc, BlypSearchResponse } from '../platform/types';

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 min

export async function getCache(queryHash: string): Promise<BlypSearchResponse | null> {
  try {
    initFirebaseAdmin();
    const ref = admin.firestore().collection(COLLECTIONS.searchCache).doc(queryHash);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const data = snap.data() as SearchCacheDoc;
    if (!data || data.schemaVersion !== SCHEMA_VERSION) return null;
    if (Date.now() > data.expiresAt) return null;
    return data.payload;
  } catch {
    return null;
  }
}

export async function setCache(queryHash: string, payload: BlypSearchResponse, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  try {
    initFirebaseAdmin();
    const doc: SearchCacheDoc = {
      schemaVersion: SCHEMA_VERSION,
      queryHash,
      ts: Date.now(),
      expiresAt: Date.now() + ttlMs,
      payload,
    };
    await admin.firestore().collection(COLLECTIONS.searchCache).doc(queryHash).set(doc);
  } catch {
    // cache write failures are non-fatal
  }
}
