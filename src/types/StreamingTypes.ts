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
  | 'BACKEND_ERROR';

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
