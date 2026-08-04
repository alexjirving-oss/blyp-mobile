/**
 * Live Streaming Client Interface
 *
 * Unified abstraction for host, guest, and viewer streaming using IVS Real-Time.
 * Supports multi-participant architecture: 1 host + up to 11 guests (12 publishers max).
 * Events are emitted for local participant state and remote participant changes.
 */

/**
 * Network quality indicator for streaming.
 */
export enum NetworkQuality {
  EXCELLENT = 'excellent',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
  UNKNOWN = 'unknown',
}

/**
 * Represents a participant (host, guest, or self as viewer).
 * slotIndex is used for multi-guest UI layout (0..maxGuestSlots-1).
 */
export interface StreamParticipant {
  participantId: string;          // IVS participant ID (unique per stage/session)
  userId?: string;                // Blyp user ID (if known)
  slotIndex?: number;             // UI slot for layout (0 = host, 1..N = guests)
  role?: 'host' | 'guest' | 'viewer';
  isLocal: boolean;               // true if this is the current user
  isMuted: boolean;               // microphone state
  isCameraDisabled: boolean;      // camera state
}

/**
 * Payloads for streaming events.
 */
export interface LocalJoinedPayload {
  participantId: string;
  sessionId: string;
  role: 'host' | 'guest';
  slotIndex?: number;
}

export interface LocalLeftPayload {
  participantId: string;
  reason?: string;
}

export interface RemoteParticipantJoinedPayload {
  participantId: string;
  userId?: string;
  slotIndex?: number;
  role?: 'guest' | 'host';
}

export interface RemoteParticipantUpdatedPayload {
  participantId: string;
  isMuted?: boolean;
  isCameraDisabled?: boolean;
}

export interface RemoteParticipantLeftPayload {
  participantId: string;
  reason?: string;
}

export interface NetworkQualityUpdatedPayload {
  quality: NetworkQuality;
  isLocal: boolean;
}

export interface LocalMediaStatePayload {
  videoEnabled: boolean;
  audioEnabled: boolean;
}

export interface RemoteVideoTrackPayload {
  participantId: string;
  userId?: string;
  videoTrackCount?: number;
  streamKey?: string;
}

export interface SurfaceReadyPayload {
  ready: boolean;
  width?: number;
  height?: number;
}

export interface FirstFramePayload {
  streamKey?: string;
  sessionId?: string;
}

export interface BroadcastStatePayload {
  state: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  fatal?: boolean;  // if true, session is unrecoverable
}

/**
 * Event emitted by LiveStreamingClient.
 */
export type LiveStreamingEvent =
  | { type: 'localJoined'; payload: LocalJoinedPayload }
  | { type: 'localLeft'; payload: LocalLeftPayload }
  | { type: 'remoteParticipantJoined'; payload: RemoteParticipantJoinedPayload }
  | { type: 'remoteParticipantUpdated'; payload: RemoteParticipantUpdatedPayload }
  | { type: 'remoteParticipantLeft'; payload: RemoteParticipantLeftPayload }
  | { type: 'error'; payload: ErrorPayload }
  | { type: 'networkQualityUpdated'; payload: NetworkQualityUpdatedPayload }
  | { type: 'localMediaState'; payload: LocalMediaStatePayload }
  | { type: 'remoteVideoTrackAdded'; payload: RemoteVideoTrackPayload }
  | { type: 'remoteVideoTrackRemoved'; payload: RemoteVideoTrackPayload }
  | { type: 'surfaceReady'; payload: SurfaceReadyPayload }
  | { type: 'firstFrame'; payload: FirstFramePayload }
  | { type: 'broadcastStateChanged'; payload: BroadcastStatePayload };

/**
 * Handler for streaming events.
 */
export type LiveStreamingEventHandler = (event: LiveStreamingEvent) => void;

/**
 * Host session start parameters.
 */
export interface HostSessionParams {
  sessionId: string;
  stageArn: string;
  token: string;
  cameraPosition?: 'front' | 'back';
  title?: string;
}

/**
 * Guest session start parameters.
 */
export interface GuestSessionParams {
  sessionId: string;
  stageArn: string;
  token: string;
  slotIndex: number;
  title?: string;
}
/**
 * Viewer session join parameters.
 * For IVS Real-Time: includes stageArn and token for stage-based viewing.
 * For HLS: includes playbackUrl for traditional HLS playback.
 */
export interface ViewerSessionParams {
  sessionId: string;
  // HLS mode (optional, for traditional playback-based viewers)
  playbackUrl?: string;
  // IVS Real-Time mode (required for stage-based viewers)
  stageArn?: string;
  token?: string;
}

/**
 * Viewer playback parameters for IVS Player (HLS/low-latency).
 * Production-grade playback path for viewers.
 * This is the recommended viewer experience: use the Player SDK, not stage-based rendering.
 */
export interface ViewerPlaybackParams {
  sessionId: string;
  playbackUrl: string;  // Required: must be non-empty
}

/**
 * Unified Live Streaming Client interface for host, guest, and viewer.
 * All methods are Promise-based for better async/await ergonomics.
 */
export interface LiveStreamingClient {
  /**
   * Start a host publishing session to an IVS stage.
   * Local camera and microphone will be captured.
   */
  startHostSession(params: HostSessionParams): Promise<void>;

  /**
   * Stop the host publishing session.
   * Releases camera, microphone, and stage connection.
   */
  stopHostSession(): Promise<void>;

  /**
   * Start a guest publishing session to an IVS stage.
   * Guests are treated as additional publishers (same role as host in IVS, but slot-mapped for UI).
   */
  startGuestSession(params: GuestSessionParams): Promise<void>;

  /**
   * Stop the guest publishing session.
   */
  stopGuestSession(): Promise<void>;

  /**
   * Join an IVS low-latency stream as a viewer.
   * Playback is read-only; no camera/mic capture.
   */
  joinAsViewer(params: ViewerSessionParams): Promise<void>;

  /**
   * Join an IVS stream as a viewer using the Player SDK (HLS/low-latency playback).
   * Production-recommended path for viewers. Use this instead of joinAsViewer for
   * reliable, scalable playback without needing complex stage rendering.
   */
  joinAsViewerPlayback(params: ViewerPlaybackParams): Promise<void>;

  /**
   * Leave the viewer stream.
   */
  leaveAsViewer(): Promise<void>;

  /**
   * Enable or disable microphone (for host/guest sessions).
   */
  setMicEnabled(enabled: boolean): Promise<void>;

  /**
   * Enable or disable camera (for host/guest sessions).
   */
  setCameraEnabled(enabled: boolean): Promise<void>;

  /**
   * Switch camera between front and back (for host/guest sessions).
   */
  switchCamera(): Promise<void>;

  /**
   * Subscribe to a streaming event.
   * Returns an unsubscribe function.
   */
  on(event: LiveStreamingEvent['type'], handler: LiveStreamingEventHandler): () => void;

  /**
   * Get current list of participants (host + remote guests + self).
   */
  getParticipants(): StreamParticipant[];

  /**
   * Get current network quality.
   */
  getNetworkQuality(): NetworkQuality;

  /**
   * Check if the client is currently in a session (host, guest, or viewer).
   */
  isActive(): boolean;
}
