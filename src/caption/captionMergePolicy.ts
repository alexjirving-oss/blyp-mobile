import { AiCaptionMap, FinalCaptionSource, NormalizedPhoto } from './types';
import { isEmptyCaption, normalizeWhitespace, trimToNull, joinCaptions } from './utils';

// Normalize a single AI caption's text.
export function normalizeAiCaption(text: string | null | undefined): string | null {
  const trimmed = trimToNull(text);
  if (trimmed == null) {
    return null;
  }
  return normalizeWhitespace(trimmed);
}

// Deterministically merge AI captions for a set of photos.
// Rules:
// - iterate over photos[] in order
// - for each photo, look up aiCaptions[photo.photoKey]
// - if empty → skip
// - combine non-empty captions using single '\n' separators
// - trim ends only
// - if all empty → return null
export function mergeAiCaptions(
  photos: NormalizedPhoto[],
  aiCaptions: AiCaptionMap
): string | null {
  const merged: string[] = [];

  for (const photo of photos) {
    const entry = aiCaptions[photo.photoKey];
    if (!entry || entry.text == null) {
      continue;
    }

    const normalized = normalizeAiCaption(entry.text);
    if (normalized == null) {
      continue;
    }

    merged.push(normalized);
  }

  if (merged.length === 0) {
    return null;
  }

  return joinCaptions(merged);
}

export interface ApplyVoiceOverrideResult {
  value: string | null;
  source: FinalCaptionSource;
}

// Apply precedence rules between voice and AI captions.
// - Voice caption wins if non-empty (after trimming); AI is ignored in that case.
// - Otherwise, use AI caption if non-empty.
// - Otherwise, return null to trigger fallback.
export function applyVoiceOverride(
  voiceCaption: string | null,
  aiCaption: string | null
): ApplyVoiceOverrideResult {
  const normalizedVoice = trimToNull(voiceCaption);

  if (normalizedVoice !== null) {
    return {
      value: normalizeWhitespace(normalizedVoice),
      source: 'voice',
    };
  }

  if (aiCaption != null && !isEmptyCaption(aiCaption)) {
    return {
      value: normalizeWhitespace(aiCaption),
      source: 'ai',
    };
  }

  return {
    value: null,
    source: 'none',
  };
}

// Apply the ONLY allowed fallback: empty string.
// Fallback triggers ONLY when both voice and AI captions are empty.
export function applyFallback(candidate: string | null): string {
  if (candidate == null) {
    return '';
  }
  return candidate;
}