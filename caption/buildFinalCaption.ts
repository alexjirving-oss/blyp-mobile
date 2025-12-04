import { mergeCaptionSmartMode } from './captionMergePolicy';

export type CaptionSource = 'manual' | 'ai-generated-post' | 'smart-merge' | 'ai' | 'voice' | 'none';

export interface PhotoLike {
  id: string;
  // Allow additional fields without constraining callers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type AiCaptionMap = Record<string, string | undefined>;

export interface BuildFinalCaptionParams {
  manualCaption?: string | null;
  voiceCaption?: string | null;
  aiCaptionsByPhotoId?: AiCaptionMap | null;
  aiGeneratedCaption?: string | null;
  editedAfterAI?: boolean;
  photos: PhotoLike[];
}

export interface BuildFinalCaptionResult {
  finalCaption: string;
  source: CaptionSource;
}

/**
 * Pure, deterministic builder that resolves the final caption text + source.
 *
 * Priority:
 * 1. Manual caption (if user edited after AI generation)
 * 2. AI-generated post caption (if generated and not edited)
 * 3. Smart merge of voice + per-photo AI
 * 4. Fallback to empty string
 */
export function buildFinalCaption(
  params: BuildFinalCaptionParams,
): BuildFinalCaptionResult {
  const trimmedManual = (params.manualCaption ?? '').trim();
  const trimmedAiGenerated = (params.aiGeneratedCaption ?? '').trim();

  // Priority 1: Manual caption if user edited after AI
  if (trimmedManual.length > 0 && params.editedAfterAI === true) {
    return {
      finalCaption: trimmedManual,
      source: 'manual',
    };
  }

  // Priority 2: AI-generated post caption if present and not edited
  if (trimmedAiGenerated.length > 0 && params.editedAfterAI !== true) {
    return {
      finalCaption: trimmedAiGenerated,
      source: 'ai-generated-post',
    };
  }

  // Priority 3: Manual caption (for non-AI flows)
  if (trimmedManual.length > 0) {
    return {
      finalCaption: trimmedManual,
      source: 'manual',
    };
  }

  // Priority 4: Smart merge of voice + per-photo AI
  return mergeCaptionSmartMode({
    voiceCaption: params.voiceCaption,
    aiCaptionsByPhotoId: params.aiCaptionsByPhotoId ?? {},
    photos: params.photos,
  });
}

// Re-export types so orchestrator / tests can depend on a single source of truth.
export type { BuildFinalCaptionParams as BuildFinalCaptionInput };