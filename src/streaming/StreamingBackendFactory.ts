/**
 * Streaming Backend Factory
 *
 * Central point for selecting the active streaming backend (HLS vs IVS).
 * Reads the single source of truth from StreamingFeatureConfig and applies
 * platform guards so iOS / Expo Go fall back to HLS.
 */

import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import { HLSStreamingBackend } from './HLSStreamingBackend';
import type { StreamingBackendId, StreamingBackendAPI } from '../types/StreamingTypes';
import { streamingConfig } from '../config/StreamingFeatureConfig';
import { StreamingBackend } from '../config/StreamingBackend';

function isExpoGo(): boolean {
  const ownership = (Constants as any)?.appOwnership;
  return ownership === 'expo';
}

/**
 * Whether the native IVS modules are actually linked into this binary.
 * Used to gate IVS on iOS so non-prebuilt / Expo Go builds keep using HLS
 * with zero regression, and only upgrade to IVS once the native bridge ships.
 */
function hasNativeIVSModules(): boolean {
  return !!(NativeModules?.IVSBroadcastModule && NativeModules?.IVSPlayerModule);
}

/**
 * Get the configured streaming backend ID from unified config
 */
export function getStreamingBackendId(): StreamingBackendId {
  const target = streamingConfig.backend;
  // Android: platform-gated (existing, unchanged behavior).
  const androidCapable = Platform.OS === 'android' && !isExpoGo();
  // iOS: additionally require the native bridge to be present so we never
  // degrade an iOS build that doesn't yet include the IVS native modules.
  const iosCapable = Platform.OS === 'ios' && !isExpoGo() && hasNativeIVSModules();

  if (target === StreamingBackend.IVS && (androidCapable || iosCapable)) {
    return 'IVS';
  }

  return 'HLS';
}

/**
 * Get the active streaming backend implementation.
 * IVS uses native modules (IVSNativeClient); this factory keeps HLS available
 * as the data/analytics fallback and for iOS/Expo Go.
 */
export function getStreamingBackend(): StreamingBackendAPI {
  const backendId = getStreamingBackendId();

  if (backendId === 'HLS') {
    return HLSStreamingBackend;
  }

  if (backendId === 'IVS') {
    console.warn('[StreamingBackend] IVS selected – returning HLS fallback for data APIs');
    return HLSStreamingBackend;
  }

  // AGORA backend placeholder - not implemented yet
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
      return () => {};
    },
  };
}
