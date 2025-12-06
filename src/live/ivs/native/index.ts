/**
 * Native Module Bridge for IVS Real-Time SDK
 * 
 * These are TypeScript stubs for native modules that need to be implemented:
 * - iOS: Wrap IVS Broadcast SDK + IVS Player with RCTView/RCTEventEmitter
 * - Android: Wrap with ViewGroup + Java/Kotlin bridge
 * 
 * Implementation guide:
 * 1. iOS: Create RNIVSBroadcastView.swift + RNIVSPlayerView.swift
 * 2. Android: Create IVSBroadcastViewManager.kt + IVSPlayerViewManager.kt
 * 3. Expose methods via React Native's native module system
 * 4. Handle camera/mic permissions natively
 * 5. Stream lifecycle events back to JS via RCTEventEmitter
 */

import { NativeModules, NativeEventEmitter } from 'react-native';

// ============================================================================
// BROADCAST (Host/Guest)
// ============================================================================

export interface IVSBroadcastConfig {
  participantToken: string;
  stageArn: string;
  region: string;
}

export interface IVSBroadcastModule {
  /**
   * Initialize broadcast session with participant token
   * @param config - Stage connection config
   * @returns Promise<void>
   */
  startBroadcast(config: IVSBroadcastConfig): Promise<void>;

  /**
   * Stop broadcast and disconnect from stage
   * @returns Promise<void>
   */
  stopBroadcast(): Promise<void>;

  /**
   * Toggle camera on/off
   * @param enabled - true to enable camera
   * @returns Promise<void>
   */
  setCameraEnabled(enabled: boolean): Promise<void>;

  /**
   * Toggle microphone on/off
   * @param enabled - true to enable microphone
   * @returns Promise<void>
   */
  setMicrophoneEnabled(enabled: boolean): Promise<void>;

  /**
   * Flip camera (front/back)
   * @returns Promise<void>
   */
  flipCamera(): Promise<void>;
}

// ============================================================================
// PLAYER (Viewer)
// ============================================================================

export interface IVSPlayerConfig {
  participantToken: string;
  stageArn: string;
  region: string;
}

export interface IVSPlayerModule {
  /**
   * Join stage as viewer with participant token
   * @param config - Stage connection config
   * @returns Promise<void>
   */
  join(config: IVSPlayerConfig): Promise<void>;

  /**
   * Leave stage and stop playback
   * @returns Promise<void>
   */
  leave(): Promise<void>;

  /**
   * Set audio volume
   * @param volume - 0.0 to 1.0
   * @returns Promise<void>
   */
  setVolume(volume: number): Promise<void>;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

export type IVSBroadcastEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'participantJoined'; participantId: string }
  | { type: 'participantLeft'; participantId: string };

export type IVSPlayerEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'error'; error: string }
  | { type: 'buffering' }
  | { type: 'playing' };

// ============================================================================
// NATIVE MODULE GETTERS
// ============================================================================

/**
 * Get IVSBroadcast native module
 * Returns stub implementation if native module not available
 */
export function getIVSBroadcast(): IVSBroadcastModule {
  const nativeModule = NativeModules.IVSBroadcast;
  
  if (!nativeModule) {
    const fatalMessage = 'IVSBroadcast native module missing – falling back to HLS';
    console.error('[IVS_NATIVE_FATAL]', fatalMessage);
    return {
      startBroadcast: async (config) => {
        console.log('[IVS_NATIVE][STUB] startBroadcast', config);
        throw new Error(fatalMessage);
      },
      stopBroadcast: async () => {
        console.log('[IVS_NATIVE][STUB] stopBroadcast');
        throw new Error(fatalMessage);
      },
      setCameraEnabled: async (enabled) => {
        console.log('[IVS_NATIVE][STUB] setCameraEnabled', enabled);
        throw new Error(fatalMessage);
      },
      setMicrophoneEnabled: async (enabled) => {
        console.log('[IVS_NATIVE][STUB] setMicrophoneEnabled', enabled);
        throw new Error(fatalMessage);
      },
      flipCamera: async () => {
        console.log('[IVS_NATIVE][STUB] flipCamera');
        throw new Error(fatalMessage);
      },
    };
  }

  return nativeModule;
}

/**
 * Get IVSPlayer native module
 * Returns stub implementation if native module not available
 */
export function getIVSPlayer(): IVSPlayerModule {
  const nativeModule = NativeModules.IVSPlayer;
  
  if (!nativeModule) {
    const fatalMessage = 'IVSPlayer native module missing – falling back to HLS';
    console.error('[IVS_NATIVE_FATAL]', fatalMessage);
    return {
      join: async (config) => {
        console.log('[IVS_NATIVE][STUB] join', config);
        throw new Error(fatalMessage);
      },
      leave: async () => {
        console.log('[IVS_NATIVE][STUB] leave');
        throw new Error(fatalMessage);
      },
      setVolume: async (volume) => {
        console.log('[IVS_NATIVE][STUB] setVolume', volume);
        throw new Error(fatalMessage);
      },
    };
  }

  return nativeModule;
}

/**
 * Get IVSBroadcast event emitter
 * Use to subscribe to broadcast events
 */
export function getIVSBroadcastEventEmitter(): NativeEventEmitter | null {
  const nativeModule = NativeModules.IVSBroadcast;
  if (!nativeModule) return null;
  return new NativeEventEmitter(nativeModule);
}

/**
 * Get IVSPlayer event emitter
 * Use to subscribe to player events
 */
export function getIVSPlayerEventEmitter(): NativeEventEmitter | null {
  const nativeModule = NativeModules.IVSPlayer;
  if (!nativeModule) return null;
  return new NativeEventEmitter(nativeModule);
}
