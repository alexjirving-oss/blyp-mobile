// Centralized streaming feature flag module.
// Supports both static build-time flag and dynamic remote override.
// Usage:
// import { isLiveStreamingEnabled } from '../config/StreamingFeatureFlag';
// if (isLiveStreamingEnabled()) { ... }
//
// Remote priority order (highest wins):
// 1. Remote Firestore/Remote Config override (cached in-memory)
// 2. Local async storage temporary override (for QA force-disable)
// 3. Hardcoded build constant (fallback)
//
// This allows an emergency kill-switch without shipping a new binary.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from 'firebase/firestore';
import { firestore as db } from './firebase';

// Single source of truth default from env: EXPO_PUBLIC_ENABLE_STREAMING
const __ENV_STREAMING = (process?.env?.EXPO_PUBLIC_ENABLE_STREAMING || '').toString().toLowerCase();
export const BUILD_ENABLE_LIVE_STREAMING = __ENV_STREAMING === '1' || __ENV_STREAMING === 'true';

// Firestore document path for remote toggle (create if absent):
// collection: appConfig, doc: streaming
// { enabled: true, reason?: string, updatedAt: serverTimestamp() }
const FIRESTORE_COLLECTION = 'appConfig';
const FIRESTORE_DOC = 'streaming';

let cachedRemoteValue = null; // null = unknown, boolean once resolved
let lastFetchedAt = 0;
const REFRESH_INTERVAL_MS = 60 * 1000; // 1 min

export async function fetchRemoteStreamingFlag(force = false) {
  const now = Date.now();
  if (!force && cachedRemoteValue !== null && (now - lastFetchedAt) < REFRESH_INTERVAL_MS) {
    return cachedRemoteValue;
  }
  try {
    const ref = doc(db, FIRESTORE_COLLECTION, FIRESTORE_DOC);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (typeof data.enabled === 'boolean') {
        cachedRemoteValue = data.enabled;
      }
    }
    lastFetchedAt = now;
    return cachedRemoteValue;
  } catch (e) {
    // Swallow errors; fallback to cached or null
    return cachedRemoteValue;
  }
}

export async function setLocalOverride(value) {
  if (value === null || value === undefined) {
    await AsyncStorage.removeItem('STREAMING_FEATURE_OVERRIDE');
  } else {
    await AsyncStorage.setItem('STREAMING_FEATURE_OVERRIDE', value ? '1' : '0');
  }
}

async function getLocalOverride() {
  try {
    const v = await AsyncStorage.getItem('STREAMING_FEATURE_OVERRIDE');
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch {
    return null;
  }
}

// Async version for places you can await
export async function isLiveStreamingEnabledAsync() {
  const local = await getLocalOverride();
  if (typeof local === 'boolean') return local;
  const remote = await fetchRemoteStreamingFlag();
  if (typeof remote === 'boolean') return remote;
  return BUILD_ENABLE_LIVE_STREAMING;
}

// Synchronous optimistic accessor (may not reflect remote yet)
export function isLiveStreamingEnabled() {
  if (typeof cachedRemoteValue === 'boolean') return cachedRemoteValue;
  return BUILD_ENABLE_LIVE_STREAMING; // optimistic until remote loads
}

// Helper to prime remote flag early in app startup (call in root)
export function primeStreamingFlag() {
  fetchRemoteStreamingFlag().catch(() => {});
}

// Developer note: To emergency-disable feature in production:
// 1. Set appConfig/streaming.enabled = false in Firestore.
// 2. (Optional) Add reason field for auditing.
// 3. Users will see the change within a minute or on cold start.
