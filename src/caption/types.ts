// Canonical caption-related types for Blyp.
// All caption logic must depend on these types only.

// Branded identifier for photos to avoid index-based bugs.
export type PhotoKey = string & { readonly brand: unique symbol };

// Branded final caption string to prevent accidental misuse.
export type FinalCaption = string & { readonly __finalCaptionBrand: unique symbol };

// Normalized photo shape used throughout the caption pipeline.
export interface NormalizedPhoto {
  photoKey: PhotoKey;
  uri: string;
  // Additional metadata can be added here as needed by AI, but must not affect caption logic.
  // e.g. width?: number; height?: number; exif?: Record<string, unknown>;
}

// Single AI caption entry for a given photoKey.
export interface AiCaptionEntry {
  attemptId: number;
  text: string | null;
}

// Normalized AI caption store, keyed by PhotoKey.
export type AiCaptionMap = Record<PhotoKey, AiCaptionEntry>;

// Global caption state for the post-level flow.
export type CaptionState =
  | { state: 'generating'; activeAttemptId: number }
  | { state: 'ready'; activeAttemptId: number }
  | { state: 'error'; activeAttemptId: number };

// Inputs into the pure caption builder.
export interface BuildFinalCaptionInput {
  photos: NormalizedPhoto[];
  aiCaptions: AiCaptionMap;
  voiceCaption: string | null;
}

// Source for analytics / debugging only.
export type FinalCaptionSource = 'voice' | 'ai' | 'none';

// Result of the pure caption builder.
export interface FinalCaptionResult {
  finalCaption: FinalCaption; // canonical, trimmed, stable & branded
  source: FinalCaptionSource;
}

// UI-side state for the composer, separate from upload payloads.
export interface UiComposerState {
  photos: NormalizedPhoto[];
  voiceCaption: string | null;
  aiCaptions: AiCaptionMap;
  captionState: CaptionState;
}

// Upload payload type: only branded FinalCaption is allowed.
export interface UploadPayload {
  frozenCaption: FinalCaption;
  // Other fields used by upload can be added here.
  // They MUST NOT include voiceCaption, aiCaptions, or CaptionState directly.
  [key: string]: unknown;
}

// Per-photo AI state machine.
export type PhotoCaptionMachineState = 'idle' | 'requesting' | 'ready' | 'failed';

export interface PhotoCaptionState {
  state: PhotoCaptionMachineState;
  attemptId: number;
  error?: string;
}

// Helper type for collections of per-photo states.
export type PhotoCaptionStateMap = Record<PhotoKey, PhotoCaptionState>;