import type { PostMetadata } from './preparePostMetadata';

export interface UploadPostParams {
  metadata: PostMetadata;
  // other transport-specific fields (media, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

/**
 * Uploads a post.
 *
 * IMPORTANT:
 * - No caption logic here. We assume metadata.caption already contains
 *   the final frozen caption produced by the caption orchestrator.
 * - This function must never recompute or override the caption.
 */
export async function uploadPost(params: UploadPostParams): Promise<void> {
  const { metadata, payload } = params;

  // Intentionally do not touch metadata.caption.
  // All routing / network concerns happen below.

  // Example (placeholder) transport – replace with real implementation:
  // await apiClient.post('/posts', {
  //   ...payload,
  //   caption: metadata.caption,
  // });

  void metadata;
  void payload;
}