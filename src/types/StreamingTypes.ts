/**
 * Streaming Backend Abstraction Types
 * 
 * Defines a clean interface for streaming backends (HLS, Agora, etc.)
 * to enable swapping implementations without changing UI/business logic.
 */

export type StreamingBackendId = 'HLS' | 'AGORA';

/**
 * Host stream metadata returned on creation
 */
export interface HostStreamMeta {
  streamId: string;
  userId: string;
  title?: string;
  createdAt: number; // ms since epoch
}

/**
 * Host-side stream state
 */
export interface HostStreamState {
  streamId: string;
  isLive: boolean;
  segmentCount: number;
  startedAt: number;
}

/**
 * Individual segment in viewer playback
 */
export interface ViewerStreamSegment {
  index: number;
  uri: string;
}

/**
 * Real-time snapshot of stream state for viewer
 */
export interface ViewerStreamSnapshot {
  streamId: string;
  title?: string;
  hostUserId: string;
  isLive: boolean;
  segments: ViewerStreamSegment[];
  currentSegment?: number;
  viewCount?: number;
  status?: string;
}

/**
 * Structured error reasons across all backends
 */
export type StreamingErrorReason =
  | 'NOT_LOGGED_IN'
  | 'BACKEND_NOT_CONFIGURED'
  | 'STREAM_NOT_FOUND'
  | 'STREAM_ENDED'
  | 'PERMISSION_DENIED'
  | 'BACKEND_ERROR';

/**
 * Streaming event types for observability
 */
export type StreamingEventType =
  | 'STREAM_START_REQUEST'
  | 'STREAM_START_SUCCESS'
  | 'STREAM_START_FAILURE'
  | 'STREAM_END_REQUEST'
  | 'STREAM_END_SUCCESS'
  | 'STREAM_END_FAILURE'
  | 'SEGMENT_UPLOAD_REQUEST'
  | 'SEGMENT_UPLOAD_SUCCESS'
  | 'SEGMENT_UPLOAD_FAILURE'
  | 'VIEWER_SUBSCRIBE_REQUEST'
  | 'VIEWER_SUBSCRIBE_SNAPSHOT'
  | 'VIEWER_SUBSCRIBE_END'
  | 'VIEWER_ERROR'
  | 'BACKEND_NOT_CONFIGURED'
  | 'PERMISSION_DENIED'
  | 'BACKEND_ERROR';

/**
 * Streaming log payload for structured events
 */
export interface StreamingLogPayload {
  backendId?: StreamingBackendId;
  streamId?: string;
  userId?: string;
  segmentNumber?: number;
  reason?: StreamingErrorReason;
  errorMessage?: string;
  status?: string;
  viewerCount?: number;
  source?: string; // 'UI' | 'viewer_ui' | 'backend'
  mode?: string; // 'host' | 'viewer'
  [key: string]: unknown;
}

/**
 * Unified result type for all streaming operations
 */
export interface StreamingResult<T = unknown> {
  ok: boolean;
  reason?: StreamingErrorReason;
  error?: string;
  data?: T;
}

/**
 * Host API - creating and managing streams
 */
export interface StreamingBackendHostAPI {
  createStream(params: {
    userId: string;
    title?: string;
    displayName?: string | null;
    photoURL?: string | null;
    email?: string | null;
  }): Promise<StreamingResult<HostStreamMeta>>;

  uploadSegment(params: {
    streamId: string;
    userId: string;
    fileUri: string;
    segmentNumber: number;
  }): Promise<StreamingResult<{ segmentNumber: number }>>;

  endStream(params: {
    streamId: string;
    userId: string;
  }): Promise<StreamingResult<void>>;
}

/**
 * Viewer API - subscribing to live streams
 */
export interface StreamingBackendViewerAPI {
  subscribeToStream(
    streamId: string,
    onSnapshot: (snapshot: ViewerStreamSnapshot | null) => void
  ): () => void;
}

/**
 * Complete streaming backend interface
 */
export interface StreamingBackendAPI
  extends StreamingBackendHostAPI,
    StreamingBackendViewerAPI {}
