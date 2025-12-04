import type {
  BuildFinalCaptionResult,
  AiCaptionMap,
  PhotoLike,
} from './buildFinalCaption';
import { mergePerPhotoAICaptions } from './utils';

export interface MergeCaptionSmartModeParams {
  voiceCaption?: string | null;
  aiCaptionsByPhotoId: AiCaptionMap;
  photos: PhotoLike[];
}

/**
 * Smart merge strategy (Option B).
 *
 * Manual caption precedence is handled at the buildFinalCaption layer.
 *
 * Rules:
 * - voice + AI → voice + blank line + merged AI
 * - voice only → voice
 * - AI only → merged AI
 * - neither → empty string
 */
export function mergeCaptionSmartMode(
  params: MergeCaptionSmartModeParams,
): BuildFinalCaptionResult {
  const { voiceCaption, aiCaptionsByPhotoId, photos } = params;

  const mergedAi = mergePerPhotoAICaptions({
    aiCaptionsByPhotoId,
    photos,
  });

  const trimmedVoice = (voiceCaption ?? '').trim();
  const hasVoice = trimmedVoice.length > 0;
  const hasAi = mergedAi.length > 0;

  if (hasVoice && hasAi) {
    return {
      finalCaption: `${trimmedVoice}\n\n${mergedAi}`,
      source: 'smart-merge',
    };
  }

  if (hasVoice) {
    return {
      finalCaption: trimmedVoice,
      source: 'voice',
    };
  }

  if (hasAi) {
    return {
      finalCaption: mergedAi,
      source: 'ai',
    };
  }

  return {
    finalCaption: '',
    source: 'none',
  };
}