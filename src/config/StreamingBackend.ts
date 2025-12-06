/**
 * Streaming Backend Enum
 * 
 * Defines available streaming backends for the Blyp app.
 * Allows switching between HLS (local segmented upload) and IVS (Amazon IVS).
 */

export enum StreamingBackend {
  HLS_LOCAL = 'hls-local',     // existing segmented upload system
  IVS = 'ivs',                 // new Amazon IVS-based pipeline
}

// DEFAULT BACKEND: IVS (Amazon IVS Real-Time for TikTok-style low-latency streaming)
// HLS_LOCAL is now LEGACY - use only via explicit feature flag
export const DEFAULT_STREAMING_BACKEND: StreamingBackend = StreamingBackend.IVS;
