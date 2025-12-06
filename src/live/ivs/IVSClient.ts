/**
 * IVS Client Wrapper (Legacy)
 * 
 * This is a legacy wrapper class kept for backward compatibility with existing tests.
 * The active production code path uses LiveStreamingClient and IVSNativeClient instead.
 * 
 * Real Amazon IVS SDK integration is in:
 * - src/streaming/LiveStreamingClient.ts (abstraction layer)
 * - src/streaming/IVSNativeClient.ts (Android bridge)
 * - android/app/src/main/java/com/blyp/ivs/* (native modules)
 */

import { getIVSEnv } from '../../config/IVSEnv';
import {
  IVSJoinParams,
  IVSConnectionState,
  IVSLocalMediaState,
  IVSRemoteParticipant,
} from './types';

export class IVSClient {
  private connectionState: IVSConnectionState = 'idle';
  private localMediaState: IVSLocalMediaState = {
    cameraEnabled: true,
    microphoneEnabled: true,
    isFrontCamera: true,
  };

  constructor() {
    const env = getIVSEnv();
    console.log('[IVS][INIT]', env.region);
  }

  getConnectionState(): IVSConnectionState {
    return this.connectionState;
  }

  getLocalMediaState(): IVSLocalMediaState {
    return this.localMediaState;
  }

  async join(params: IVSJoinParams): Promise<void> {
    this.connectionState = 'connecting';
    console.log('[IVS][JOIN_REQUEST]', params);
    // Legacy placeholder: real implementation is in LiveStreamingClient via IVSNativeClient
    this.connectionState = 'connected';
  }

  async leave(): Promise<void> {
    console.log('[IVS][LEAVE]');
    this.connectionState = 'disconnected';
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    this.localMediaState = { ...this.localMediaState, cameraEnabled: enabled };
    // Legacy placeholder: real implementation is in LiveStreamingClient via IVSNativeClient
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.localMediaState = { ...this.localMediaState, microphoneEnabled: enabled };
    // Legacy placeholder: real implementation is in LiveStreamingClient via IVSNativeClient
  }

  async switchCamera(): Promise<void> {
    this.localMediaState = {
      ...this.localMediaState,
      isFrontCamera: !this.localMediaState.isFrontCamera,
    };
    // Legacy placeholder: real implementation is in LiveStreamingClient via IVSNativeClient
  }

  // Subscription interface (legacy placeholder)
  onRemoteParticipantsUpdated(
    _cb: (participants: IVSRemoteParticipant[]) => void,
  ): () => void {
    // Legacy placeholder: real implementation is in LiveStreamingClient via IVSNativeClient
    return () => {};
  }
}
