/**
 * Streaming Backend Factory
 * 
 * Central point for selecting the active streaming backend (HLS, Agora, etc.).
 * Allows runtime switching based on environment configuration.
 */

import Constants from 'expo-constants';
import { HLSStreamingBackend } from './HLSStreamingBackend';
import type { StreamingBackendId, StreamingBackendAPI } from '../types/StreamingTypes';

/**
 * Get the configured streaming backend ID from environment
 */
export function getStreamingBackendId(): StreamingBackendId {
  const config: any =
    (Constants.expoConfig && (Constants.expoConfig as any).extra) ||
    (Constants.manifest && (Constants.manifest as any).extra) ||
    {};

  const backend = config.EXPO_PUBLIC_STREAMING_BACKEND || 'HLS';
  return backend === 'AGORA' ? 'AGORA' : 'HLS';
}

/**
 * Get the active streaming backend implementation
 * 
 * Returns the appropriate backend based on configuration.
 * Currently supports:
 * - HLS: Firebase-based pseudo-HLS streaming (production-ready)
 * - AGORA: Placeholder for future Agora RTC implementation
 */
export function getStreamingBackend(): StreamingBackendAPI {
  const backendId = getStreamingBackendId();

  if (backendId === 'HLS') {
    return HLSStreamingBackend;
  }

  // AGORA backend placeholder - not implemented yet
  // When ready, import and return AgoraStreamingBackend here
  console.warn('[StreamingBackend] AGORA backend requested but not implemented, returning stub');
  
  return {
    async createStream() {
      return {
        ok: false,
        reason: 'BACKEND_NOT_CONFIGURED',
        error: 'AGORA backend is not yet implemented. Please use HLS backend.',
      };
    },
    
    async uploadSegment() {
      return {
        ok: false,
        reason: 'BACKEND_NOT_CONFIGURED',
        error: 'AGORA backend is not yet implemented.',
      };
    },
    
    async endStream() {
      return {
        ok: false,
        reason: 'BACKEND_NOT_CONFIGURED',
        error: 'AGORA backend is not yet implemented.',
      };
    },
    
    subscribeToStream() {
      console.warn('[StreamingBackend] AGORA subscribeToStream called but not implemented');
      return () => {}; // Return no-op unsubscribe function
    },
  };
}
