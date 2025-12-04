import type { CaptionState } from '../caption/orchestrator';

export interface PreparePostMetadataParams<
  Draft extends Record<string, unknown>,
  Photo extends { id: string },
> {
  draft: Draft;
  captionState: CaptionState<Photo>;
}

export interface PostMetadata extends Record<string, unknown> {
  caption: string;
}

/**
 * Prepares post metadata for upload.
 *
 * IMPORTANT:
 * - No caption logic here. Caption must already be frozen via the
 *   caption orchestrator before we reach this point.
 * - We simply forward the frozenCaption (or empty string) into the
 *   metadata payload.
 */
export function preparePostMetadata<
  Draft extends Record<string, unknown>,
  Photo extends { id: string },
>(params: PreparePostMetadataParams<Draft, Photo>): PostMetadata {
  const { draft, captionState } = params;

  const frozenCaption = captionState.frozenCaption ?? '';

  return {
    ...draft,
    caption: frozenCaption,
  };
}