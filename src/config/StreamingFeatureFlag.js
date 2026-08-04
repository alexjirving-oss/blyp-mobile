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
import Constants from 'expo-constants';
import { firestore as db } from './firebase';

// Single source of truth default from env/manifest: EXPO_PUBLIC_ENABLE_STREAMING
// Note: in production builds, `process.env.*` is often undefined; Expo recommends using Constants.expoConfig.extra.
const readStreamingFlag = () => {
  const fromProcessEnv = (process?.env?.EXPO_PUBLIC_ENABLE_STREAMING || '').toString();
  const fromExpoConfig = (
    Constants?.expoConfig?.extra?.EXPO_PUBLIC_ENABLE_STREAMING ??
    Constants?.manifest?.extra?.EXPO_PUBLIC_ENABLE_STREAMING ??
    Constants?.manifest2?.extra?.EXPO_PUBLIC_ENABLE_STREAMING ??
    ''
  ).toString();

  const raw = (fromProcessEnv || fromExpoConfig || '').toString().trim().toLowerCase();
  // Explicit off only. Empty/missing defaults ON so preview builds aren't silently dead.
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  return true;
};

export const BUILD_ENABLE_LIVE_STREAMING = readStreamingFlag();

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
  // Preview/prod builds that bake ENABLE_STREAMING=1 stay on even if Firestore
  // appConfig/streaming is missing or historically set to false.
  if (BUILD_ENABLE_LIVE_STREAMING) return true;
  const remote = await fetchRemoteStreamingFlag();
  if (typeof remote === 'boolean') return remote;
  return false;
}

// Sync accessor used by Live entry points. Build-time ENABLE=1 wins;
// remote Firestore is only consulted when the build did not enable streaming.
export function isLiveStreamingEnabled() {
  if (BUILD_ENABLE_LIVE_STREAMING) return true;
  if (typeof cachedRemoteValue === 'boolean') return cachedRemoteValue;
  return false;
}

// Helper to prime remote flag early in app startup (call in root)
export function primeStreamingFlag() {
  fetchRemoteStreamingFlag().catch(() => {});
}

// Emergency disable for builds without ENABLE_STREAMING baked in:
// set appConfig/streaming.enabled = false in Firestore.
// For preview/prod with EXPO_PUBLIC_ENABLE_STREAMING=1, ship a new binary
// with the env off, or set local AsyncStorage STREAMING_FEATURE_OVERRIDE=0.
