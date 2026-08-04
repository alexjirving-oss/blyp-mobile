/**
 * Native Module Bridge for IVS Real-Time SDK (Android)
 * Uses the IVSBroadcastModule / IVSPlayerModule contract exposed by Kotlin.
 */

import { NativeModules, NativeEventEmitter } from 'react-native';

const broadcastModule = NativeModules.IVSBroadcastModule;
const playerModule = NativeModules.IVSPlayerModule;

export function getIVSBroadcast(): any {
  if (!broadcastModule) {
    const fatalMessage = 'IVSBroadcastModule missing – falling back to HLS';
    console.error('[IVS_NATIVE_FATAL]', fatalMessage);
    return {
      startHostSession: async () => {
        throw new Error(fatalMessage);
      },
      stopHostSession: async () => {
        throw new Error(fatalMessage);
      },
      startGuestSession: async () => {
        throw new Error(fatalMessage);
      },
      stopGuestSession: async () => {
        throw new Error(fatalMessage);
      },
      setMicEnabled: async () => {
        throw new Error(fatalMessage);
      },
      setCameraEnabled: async () => {
        throw new Error(fatalMessage);
      },
      switchCamera: async () => {
        throw new Error(fatalMessage);
      },
    };
  }
  return broadcastModule;
}

export function getIVSPlayer(): any {
  if (!playerModule) {
    const fatalMessage = 'IVSPlayerModule missing – falling back to HLS';
    console.error('[IVS_NATIVE_FATAL]', fatalMessage);
    return {
      joinAsViewer: async () => {
        throw new Error(fatalMessage);
      },
      leaveAsViewer: async () => {
        throw new Error(fatalMessage);
      },
      play: async () => {
        throw new Error(fatalMessage);
      },
      pause: async () => {
        throw new Error(fatalMessage);
      },
      stop: async () => {
        throw new Error(fatalMessage);
      },
    };
  }
  return playerModule;
}

export function getIVSBroadcastEventEmitter(): NativeEventEmitter | null {
  if (!broadcastModule) return null;
  return new NativeEventEmitter(broadcastModule);
}

export function getIVSPlayerEventEmitter(): NativeEventEmitter | null {
  if (!playerModule) return null;
  return new NativeEventEmitter(playerModule);
}
