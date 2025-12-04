import {
  BuildFinalCaptionInput,
  FinalCaptionResult,
} from './types';
import {
  mergeAiCaptions,
  applyFallback,
  applyVoiceOverride,
} from './captionMergePolicy';
import { createFinalCaption } from './utils';

// Single source of truth for final captions.
// Pure, deterministic, and side-effect free.
export function buildFinalCaption(input: BuildFinalCaptionInput): FinalCaptionResult {
  const { photos, aiCaptions, voiceCaption } = input;

  // 1) Deterministic AI merge (per policy)
  const mergedAiCaption = mergeAiCaptions(photos, aiCaptions);

  // 2) Apply voice override precedence
  const { value: chosenCaption, source } = applyVoiceOverride(
    voiceCaption,
    mergedAiCaption
  );

  // 3) Apply fallback (empty string only)
  const withFallback = applyFallback(chosenCaption);

  // 4) Brand the final string as FinalCaption
  const finalCaption = createFinalCaption(withFallback);

  return {
    finalCaption,
    source,
  };
}