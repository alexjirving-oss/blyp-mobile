import {
  buildFinalCaption,
  type BuildFinalCaptionResult,
  type CaptionSource,
  type PhotoLike,
} from './buildFinalCaption';

export interface CaptionState<Photo extends PhotoLike = PhotoLike> {
  photos: Photo[];
  manualCaption: string;
  voiceCaption: string;
  aiCaptionsByPhotoId: Record<string, string | undefined>;
  aiGeneratedCaption?: string | null;
  editedAfterAI?: boolean;
  frozenCaption: string | null;
  frozenCaptionSource: CaptionSource | null;
}

/**
 * Returns the caption to display in the UI for the current state.
 *
 * Behaviour:
 * - If a caption has been frozen, always return the frozen one.
 * - Otherwise, delegate to the smart-merge builder.
 */
export function getPreviewCaption<Photo extends PhotoLike>(
  state: CaptionState<Photo>,
): BuildFinalCaptionResult {
  if (state.frozenCaption != null) {
    const source: CaptionSource = state.frozenCaptionSource ?? 'none';

    return {
      finalCaption: state.frozenCaption,
      source,
    };
  }

  return buildFinalCaption({
    manualCaption: state.manualCaption,
    voiceCaption: state.voiceCaption,
    aiCaptionsByPhotoId: state.aiCaptionsByPhotoId,
    aiGeneratedCaption: state.aiGeneratedCaption,
    editedAfterAI: state.editedAfterAI,
    photos: state.photos,
  });
}

/**
 * Freezes the caption for upload.
 *
 * Once frozen, the caption is never recomputed; upload always uses
 * the frozen value.
 */
export function freezeCaption<Photo extends PhotoLike>(
  state: CaptionState<Photo>,
): CaptionState<Photo> {
  if (state.frozenCaption != null) {
    // Already frozen – idempotent no-op.
    return state;
  }

  const { finalCaption, source } = buildFinalCaption({
    manualCaption: state.manualCaption,
    voiceCaption: state.voiceCaption,
    aiCaptionsByPhotoId: state.aiCaptionsByPhotoId,
    aiGeneratedCaption: state.aiGeneratedCaption,
    editedAfterAI: state.editedAfterAI,
    photos: state.photos,
  });

  return {
    ...state,
    frozenCaption: finalCaption,
    frozenCaptionSource: source,
  };
}