/**
 * Streaming Feature Configuration
 * 
 * Central configuration for streaming backend selection.
 * Single source of truth for which backend is active.
 */

import { StreamingBackend, DEFAULT_STREAMING_BACKEND } from './StreamingBackend';

type StreamingConfig = {
  backend: StreamingBackend;
  // later: per-backend settings, toggles, etc.
};

export const streamingConfig: StreamingConfig = {
  backend: DEFAULT_STREAMING_BACKEND,
};
