export interface MergePerPhotoAICaptionsParams<Photo extends { id: string }> {
  aiCaptionsByPhotoId: Record<string, string | undefined>;
  photos: Photo[];
}

/**
 * Builds a stable multi-photo AI caption by walking the photo list
 * and concatenating any non-empty AI caption belonging to each photo.
 *
 * Guarantees:
 * - No index-based mapping (uses photo.id)
 * - Deterministic ordering (photo order)
 */
export function mergePerPhotoAICaptions<Photo extends { id: string }>(
  params: MergePerPhotoAICaptionsParams<Photo>,
): string {
  const { aiCaptionsByPhotoId, photos } = params;

  const ordered: string[] = [];

  for (const photo of photos) {
    const raw = aiCaptionsByPhotoId[photo.id];
    if (!raw) continue;

    const trimmed = raw.trim();
    if (!trimmed) continue;

    ordered.push(trimmed);
  }

  if (ordered.length === 0) {
    return '';
  }

  return ordered.join('\n\n');
}