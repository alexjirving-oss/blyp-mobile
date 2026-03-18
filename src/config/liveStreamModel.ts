/**
 * Canonical Live Stream Firestore Model & Feature Flags
 * Stage 2.1 – Unified definition for live stream documents & segment records.
 *
 * This file is the single source of truth for:
 *  - Collection / subcollection names
 *  - Live stream document & segment document shapes
 *  - Feature flags / kill switches controlling legacy map, subcollection, playlist/ABR, global live enable
 *
 * IMPORTANT:
 *  - Do NOT perform direct string literals for collection names outside this module.
 *  - Use the exported booleans to gate behaviour instead of ad-hoc env checks elsewhere.
 */

import type { Timestamp } from 'firebase/firestore';

// Collection / Path Constants
export const LIVE_STREAMS_COLLECTION = 'liveStreams';
export const SEGMENTS_SUBCOLLECTION = 'segments';
// Presence / chat legacy collection (still used by LiveService / FirestoreLiveService)
export const PRESENCE_STREAMS_COLLECTION = 'streams'; // TODO(stage2-live-unification): Migrate presence/chat to unified liveStreams or dedicated presence subcollection.

// Environment helpers
const env = (typeof process !== 'undefined' && process?.env) ? process.env : {} as Record<string, string | undefined>;

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined) return defaultValue;
  return raw === '1' || raw === 'true';
}

// Global kill switch for ALL live features (screen entry, creation, viewing)
export const ENABLE_LIVE_FEATURES = envFlag('EXPO_PUBLIC_DISABLE_LIVE_FEATURES', false) ? false : true;

// Subcollection enable flag (preferred canonical storage for segments)
export const ENABLE_LIVE_SEGMENTS_SUBCOLLECTION = envFlag('EXPO_PUBLIC_DISABLE_LIVE_SEGMENTS_SUBCOLLECTION', false) ? false : true;

// Legacy inline segments map (maintain for backward compatibility while migrating)
// Existing env used elsewhere: EXPO_PUBLIC_DISABLE_LEGACY_SEGMENT_MAP === '1' disables map writes.
const legacyMapDisabled = envFlag('EXPO_PUBLIC_DISABLE_LEGACY_SEGMENT_MAP', false);
export const ENABLE_LEGACY_SEGMENTS_MAP = !legacyMapDisabled; // TODO(stage2-live-unification): Remove legacy segments map flag after full migration.

// Playlist / manifest / ABR experimental viewer mode
// Reuse prior feature flag semantics if already provided by existing FeatureFlags helpers.
export const ENABLE_PLAYLIST_MANIFEST_VIEWER = envFlag('EXPO_PUBLIC_ENABLE_PLAYLIST_MANIFEST_VIEWER', false); // TODO(stage2-live-unification): Reassess experimental playlist flag; unify ABR under canonical adaptation service.

// Type Definitions
export interface LiveStreamDocument {
  id?: string; // convenience when composed client-side
  hostId: string;
  userId?: string; // alias if older code used userId
  title?: string;
  description?: string;
  thumbnailUrl?: string | null;
  status: 'live' | 'ended' | 'scheduled';
  createdAt: Timestamp | any; // Firestore serverTimestamp placeholder tolerated in writes
  updatedAt: Timestamp | any;
  startedAt?: Timestamp | any;
  endedAt?: Timestamp | any;
  viewerCount?: number; // some legacy code paths may use viewerCount
  viewCount?: number; // current implementation uses viewCount
  likes?: number;
  currentSegment?: number; // latest segment index
  totalSegments?: number;
  streamHealth?: {
    status?: string;
    lastSegmentTime?: Timestamp | any;
    bufferHealth?: string;
    lastUpload?: Timestamp | any;
    engagementActivity?: Timestamp | any;
    viewerActivity?: Timestamp | any;
    endReason?: string;
    uploadLatency?: number | any;
  };
  // Legacy embedded inline segment map (to be deprecated). Key = segment index string.
  segments?: Record<string, { url?: string; uploadedAt?: Timestamp | any; segmentNumber?: number; type?: string } | null>;
  lastSegmentUploadedAt?: Timestamp | any;
}

export interface LiveSegmentDocument {
  index: number; // canonical numeric sequential index
  number?: number; // legacy field name used in current subcollection writes
  url: string;
  uploadedAt: Timestamp | any;
  durationMs?: number; // optional if known
  variant?: string; // quality label e.g. 'source', '480p', etc.
  clientUploadLatencyMs?: number;
}

// Helper to decide active segment source for viewers.
export type SegmentSource = 'playlist' | 'subcollection' | 'legacyMap';
export function decideSegmentSource(): SegmentSource {
  if (ENABLE_PLAYLIST_MANIFEST_VIEWER) return 'playlist';
  if (ENABLE_LIVE_SEGMENTS_SUBCOLLECTION) return 'subcollection';
  if (ENABLE_LEGACY_SEGMENTS_MAP) return 'legacyMap';
  return 'legacyMap'; // safe fallback
}

// Centralized path helpers
export function liveStreamDocPath(streamId: string): string {
  return `${LIVE_STREAMS_COLLECTION}/${streamId}`;
}

export function segmentDocPath(streamId: string, index: number): string {
  return `${LIVE_STREAMS_COLLECTION}/${streamId}/${SEGMENTS_SUBCOLLECTION}/${index}`;
}

// Guard utilities
export function assertLiveEnabled() {
  if (!ENABLE_LIVE_FEATURES) throw new Error('Live features disabled by kill switch');
}

// Lightweight runtime summary (can be logged for diagnostics, not persisted automatically)
export const liveModelRuntimeSummary = {
  ENABLE_LIVE_FEATURES,
  ENABLE_LIVE_SEGMENTS_SUBCOLLECTION,
  ENABLE_LEGACY_SEGMENTS_MAP,
  ENABLE_PLAYLIST_MANIFEST_VIEWER,
  collections: {
    LIVE_STREAMS_COLLECTION,
    SEGMENTS_SUBCOLLECTION,
    PRESENCE_STREAMS_COLLECTION,
  },
};

// NOTE: Any future migration should update this file first, then adjust service helpers to align.
// END liveStreamModel.ts
