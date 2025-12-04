import {
  AiCaptionEntry,
  AiCaptionMap,
  BuildFinalCaptionInput,
  CaptionState,
  FinalCaption,
  NormalizedPhoto,
  PhotoCaptionState,
  PhotoCaptionStateMap,
  PhotoKey,
  UiComposerState,
} from './types';
import { buildFinalCaption } from './buildFinalCaption';
import { createFinalCaption, isEmptyCaption, trimToNull } from './utils';

export interface CaptionOrchestratorOptions {
  initialPhotos?: NormalizedPhoto[];
  initialVoiceCaption?: string | null;
  initialAiCaptions?: AiCaptionMap;
}

// Central orchestrator for caption flow.
// Owns:
// - per-photo AI state machines
// - attemptId tracking and stale-response filtering
// - derived CaptionState
// - canonical inputs into buildFinalCaption
// - frozen caption after upload
export class CaptionOrchestrator {
  private photos: NormalizedPhoto[] = [];
  private aiCaptions: AiCaptionMap = {} as AiCaptionMap;
  private photoStates: PhotoCaptionStateMap = {} as PhotoCaptionStateMap;
  private voiceCaption: string | null = null; // canonical (whitespace → null)
  private captionState: CaptionState = { state: 'ready', activeAttemptId: 0 };
  private hardError: string | null = null;

  private frozenCaption: FinalCaption | null = null;
  private previewCache: string = '';
  private previewDirty = true;

  constructor(options?: CaptionOrchestratorOptions) {
    if (options?.initialPhotos) {
      this.setPhotos(options.initialPhotos);
    }

    if (options?.initialVoiceCaption !== undefined) {
      this.setVoiceCaption(options.initialVoiceCaption);
    }

    if (options?.initialAiCaptions) {
      // Clone to avoid external mutations.
      this.aiCaptions = { ...options.initialAiCaptions };
      this.syncPhotoStatesWithAiCaptions();
      this.recomputeCaptionState();
    }
  }

  // ----- PUBLIC API: USED BY UI / UPLOAD -----

  // UI: read-only caption state.
  public getCaptionState(): CaptionState {
    return this.captionState;
  }

  // UI: canonical preview caption for display.
  public getPreviewCaption(): string {
    // After freeze, preview must always reflect frozenCaption.
    if (this.frozenCaption) {
      return this.frozenCaption;
    }

    if (!this.previewDirty) {
      return this.previewCache;
    }

    const result = buildFinalCaption(this.getCanonicalInputs());
    this.previewCache = result.finalCaption;
    this.previewDirty = false;

    return this.previewCache;
  }

  // Upload: single canonical input bundle.
  public getCanonicalInputs(): BuildFinalCaptionInput {
    // Shallow copies to maintain purity at call sites.
    return {
      photos: [...this.photos],
      aiCaptions: { ...this.aiCaptions },
      voiceCaption: this.voiceCaption,
    };
  }

  // Upload: final frozen caption, branded and immutable.
  // Once computed, it will NEVER change, even if AI finishes later or UI edits occur.
  public computeFinalCaption(): FinalCaption {
    if (this.frozenCaption) {
      return this.frozenCaption;
    }

    const { finalCaption } = buildFinalCaption(this.getCanonicalInputs());
    // Freeze the caption: from now on, all retries MUST reuse this value.
    this.frozenCaption = finalCaption;
    // Ensure preview always shows frozen value after this point.
    this.previewCache = finalCaption;
    this.previewDirty = false;

    return this.frozenCaption;
  }

  // Upload gating: upload is allowed if:
  // - captionState === 'ready'
  // OR
  // - voiceCaption is non-empty (manual override)
  public isReadyForUpload(): boolean {
    if (this.voiceCaption !== null && !isEmptyCaption(this.voiceCaption)) {
      return true;
    }

    return this.captionState.state === 'ready';
  }

  // UI state snapshot, using canonical types only.
  public getUiState(): UiComposerState {
    return {
      photos: [...this.photos],
      voiceCaption: this.voiceCaption,
      aiCaptions: { ...this.aiCaptions },
      captionState: this.captionState,
    };
  }

  // ----- PUBLIC API: USED BY COMPOSER / AI HOOKS -----

  // Update the active photos list. This:
  // - ensures PhotoKey-based identity
  // - deletes aiCaptions for removed photos
  // - initializes entries for new photos
  // - keeps existing attemptId where possible
  public setPhotos(nextPhotos: NormalizedPhoto[]): void {
    this.photos = [...nextPhotos];

    const nextKeys = new Set<PhotoKey>(nextPhotos.map((p) => p.photoKey));

    // Remove aiCaptions and states for deleted photos.
    for (const key of Object.keys(this.aiCaptions) as PhotoKey[]) {
      if (!nextKeys.has(key)) {
        delete this.aiCaptions[key];
      }
    }

    for (const key of Object.keys(this.photoStates) as PhotoKey[]) {
      if (!nextKeys.has(key)) {
        delete this.photoStates[key];
      }
    }

    // Initialize state for new photos.
    for (const photo of nextPhotos) {
      const key = photo.photoKey;
      if (!this.photoStates[key]) {
        this.photoStates[key] = {
          state: 'idle',
          attemptId: 0,
        };
      }

      if (!this.aiCaptions[key]) {
        this.aiCaptions[key] = {
          attemptId: this.photoStates[key].attemptId,
          text: null,
        };
      }
    }

    this.markPreviewDirty();
    this.recomputeCaptionState();
  }

  // Set voice caption, canonicalizing whitespace:
  // - whitespace-only becomes null before entering the pipeline.
  public setVoiceCaption(raw: string | null): void {
    this.voiceCaption = trimToNull(raw);
    this.markPreviewDirty();
  }

  // Get the current AI caption string (raw text) for a photo, or null if none.
  public getAiCaption(photoKey: PhotoKey): string | null {
    const entry = this.aiCaptions[photoKey];
    return entry ? entry.text : null;
  }

  // Begin an AI caption request for a given photo.
  // Returns the attemptId that MUST be associated with the resulting promise.
  public beginAiCaptionForPhoto(photoKey: PhotoKey): number {
    const current = this.ensurePhotoState(photoKey);
    const nextAttemptId = current.attemptId + 1;

    this.photoStates[photoKey] = {
      state: 'requesting',
      attemptId: nextAttemptId,
    };

    const existingEntry: AiCaptionEntry | undefined = this.aiCaptions[photoKey];
    this.aiCaptions[photoKey] = {
      attemptId: nextAttemptId,
      text: existingEntry ? existingEntry.text : null,
    };

    this.markPreviewDirty();
    this.recomputeCaptionState();

    return nextAttemptId;
  }

  // Complete an AI caption request. Stale responses are ignored via attemptId.
  public completeAiCaptionForPhoto(
    photoKey: PhotoKey,
    attemptId: number,
    text: string | null
  ): void {
    const state = this.ensurePhotoState(photoKey);

    if (attemptId < state.attemptId) {
      // Stale response; ignore.
      return;
    }

    this.photoStates[photoKey] = {
      state: 'ready',
      attemptId,
    };

    this.aiCaptions[photoKey] = {
      attemptId,
      text,
    };

    this.markPreviewDirty();
    this.recomputeCaptionState();
  }

  // Mark an AI caption request as failed for a photo (non-hard failure).
  public failAiCaptionForPhoto(
    photoKey: PhotoKey,
    attemptId: number,
    error: string
  ): void {
    const state = this.ensurePhotoState(photoKey);

    if (attemptId < state.attemptId) {
      // Stale response; ignore.
      return;
    }

    this.photoStates[photoKey] = {
      state: 'failed',
      attemptId,
      error,
    };

    // On failure, we still keep AI text as null, distinguishing from "none" via state.
    this.aiCaptions[photoKey] = {
      attemptId,
      text: null,
    };

    this.markPreviewDirty();
    this.recomputeCaptionState();
  }

  // Mark a hard, unrecoverable AI error for this attempt.
  // CaptionState will reflect 'error' until a new attempt begins.
  public markHardError(error: string): void {
    this.hardError = error;
    this.recomputeCaptionState();
  }

  // Clear any hard-error and recompute state based on per-photo machines.
  public clearHardError(): void {
    this.hardError = null;
    this.recomputeCaptionState();
  }

  // Reset frozen caption (e.g. when abandoning a post and starting a brand-new one).
  // This should only be used when the composer is re-initialized for a new post.
  public resetFrozenCaption(): void {
    this.frozenCaption = null;
    this.previewDirty = true;
  }

  // ----- INTERNAL HELPERS -----

  private ensurePhotoState(photoKey: PhotoKey): PhotoCaptionState {
    let state = this.photoStates[photoKey];
    if (!state) {
      state = {
        state: 'idle',
        attemptId: 0,
      };
      this.photoStates[photoKey] = state;
    }
    return state;
  }

  private syncPhotoStatesWithAiCaptions(): void {
    for (const key of Object.keys(this.aiCaptions) as PhotoKey[]) {
      const entry = this.aiCaptions[key];
      const existing = this.photoStates[key];
      if (!existing) {
        this.photoStates[key] = {
          state: 'ready',
          attemptId: entry.attemptId,
        };
      }
    }
  }

  private recomputeCaptionState(): void {
    const states = Object.values(this.photoStates);
    let activeAttemptId = 0;

    for (const s of states) {
      if (s.attemptId > activeAttemptId) {
        activeAttemptId = s.attemptId;
      }
    }

    // Hard error always wins.
    if (this.hardError) {
      this.captionState = {
        state: 'error',
        activeAttemptId,
      };
      return;
    }

    // Any in-flight request → generating.
    if (states.some((s) => s.state === 'requesting')) {
      this.captionState = {
        state: 'generating',
        activeAttemptId,
      };
      return;
    }

    // If no requests are in-flight, and we've reached this point,
    // we consider the current attempt "ready" (even if some photos failed).
    this.captionState = {
      state: 'ready',
      activeAttemptId,
    };
  }

  private markPreviewDirty(): void {
    if (this.frozenCaption) {
      // Once frozen, preview must not diverge, so we do not mark as dirty.
      return;
    }
    this.previewDirty = true;
  }
}