/**
 * IVS Native Client
 *
 * Concrete implementation of LiveStreamingClient that wraps native IVS modules.
 * Bridges JS React Native layer to native Android/iOS IVS SDKs.
 *
 * Platform Support:
 * - Android: Full support via Amazon IVS Broadcast + Player SDKs
 * - iOS: Not yet implemented; throws clear unsupported error
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import {
  LiveStreamingClient,
  LiveStreamingEvent,
  LiveStreamingEventHandler,
  StreamParticipant,
  NetworkQuality,
  HostSessionParams,
  GuestSessionParams,
  ViewerSessionParams,
} from './LiveStreamingClient';

const { IVSBroadcastModule, IVSPlayerModule } = NativeModules;

type EventSubscription = {
  remove: () => void;
};

/**
 * IVS Native Client – Production implementation for Android.
 * iOS support to be implemented; currently throws unsupported error.
 */
export class IVSNativeClient implements LiveStreamingClient {
  private eventHandlers: Map<string, Set<LiveStreamingEventHandler>> = new Map();
  private broadcastEventEmitter: NativeEventEmitter | null = null;
  private playerEventEmitter: NativeEventEmitter | null = null;
  private broadcastSubscriptions: EventSubscription[] = [];
  private playerSubscriptions: EventSubscription[] = [];

  private participants: Map<string, StreamParticipant> = new Map();
  private networkQuality: NetworkQuality = NetworkQuality.UNKNOWN;
  private isHostOrGuestActive = false;
  private isViewerActive = false;
  private currentSessionId: string | null = null;

  constructor() {
    // Validate platform support at construction time
    if (Platform.OS === 'ios') {
      throw new Error(
        'IVS Real-Time streaming is not yet supported on iOS. ' +
        'Please use HLS backend (legacy) or implement iOS native modules. ' +
        'See: https://docs.aws.amazon.com/ivs/latest/userguide/real-time.html'
      );
    }

    if (Platform.OS !== 'android') {
      throw new Error(
        `IVS Real-Time streaming is not supported on platform: ${Platform.OS}. ` +
        'Only Android and iOS (future) are supported.'
      );
    }

    // Verify native modules are available on Android
    if (!IVSBroadcastModule || !IVSPlayerModule) {
      throw new Error(
        'IVS native modules not found. ' +
        'Ensure IVSBroadcastModule and IVSPlayerModule are properly linked. ' +
        'This usually means the app was not built with the native modules included.'
      );
    }

    this.initializeEventEmitters();
  }

  private initializeEventEmitters() {
    // Broadcast emitter for host/guest sessions (Android verified in constructor)
    this.broadcastEventEmitter = new NativeEventEmitter(IVSBroadcastModule);
    this.setupBroadcastEventListeners();

    // Player emitter for viewer sessions (Android verified in constructor)
    this.playerEventEmitter = new NativeEventEmitter(IVSPlayerModule);
    this.setupPlayerEventListeners();
  }

  private setupBroadcastEventListeners() {
    if (!this.broadcastEventEmitter) return;

    // Local participant joined (host or guest)
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_HOST_LOCAL_JOINED', (data: any) => {
        console.log('[IVS_CLIENT] Local broadcast joined:', data);
        const participantId = data.participantId || data.sessionId || 'local';
        const role = data.role || 'host';
        const slotIndex = data.slotIndex ?? (role === 'host' ? 0 : undefined);

        this.participants.set(participantId, {
          participantId,
          userId: data.userId,
          slotIndex,
          role,
          isLocal: true,
          isMuted: false,
          isCameraDisabled: false,
        });

        this.emit('localJoined', {
          participantId,
          sessionId: this.currentSessionId || data.sessionId,
          role,
          slotIndex,
        });
      })
    );

    // Local participant left (host or guest)
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_HOST_LOCAL_LEFT', (data: any) => {
        console.log('[IVS_CLIENT] Local broadcast left:', data);
        const participantId = data.participantId || 'local';

        this.participants.delete(participantId);
        this.isHostOrGuestActive = false;

        this.emit('localLeft', {
          participantId,
          reason: data.reason,
        });
      })
    );

    // Remote participant joined (guest joining a host's stage)
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_REMOTE_PARTICIPANT_JOINED', (data: any) => {
        console.log('[IVS_CLIENT] Remote participant joined:', data);
        const participantId = data.participantId;
        const slotIndex = data.slotIndex;

        this.participants.set(participantId, {
          participantId,
          userId: data.userId,
          slotIndex,
          role: data.role || 'guest',
          isLocal: false,
          isMuted: data.isMuted ?? false,
          isCameraDisabled: data.isCameraDisabled ?? false,
        });

        this.emit('remoteParticipantJoined', {
          participantId,
          userId: data.userId,
          slotIndex,
          role: data.role || 'guest',
        });
      })
    );

    // Remote participant updated (mute/camera state change)
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_REMOTE_PARTICIPANT_UPDATED', (data: any) => {
        console.log('[IVS_CLIENT] Remote participant updated:', data);
        const participantId = data.participantId;
        const participant = this.participants.get(participantId);

        if (participant) {
          if (data.isMuted !== undefined) participant.isMuted = data.isMuted;
          if (data.isCameraDisabled !== undefined) participant.isCameraDisabled = data.isCameraDisabled;
        }

        this.emit('remoteParticipantUpdated', {
          participantId,
          isMuted: data.isMuted,
          isCameraDisabled: data.isCameraDisabled,
        });
      })
    );

    // Remote participant left
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_REMOTE_PARTICIPANT_LEFT', (data: any) => {
        console.log('[IVS_CLIENT] Remote participant left:', data);
        const participantId = data.participantId;

        this.participants.delete(participantId);

        this.emit('remoteParticipantLeft', {
          participantId,
          reason: data.reason,
        });
      })
    );

    // Broadcast error
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_BROADCAST_ERROR', (data: any) => {
        console.error('[IVS_CLIENT] Broadcast error:', data);
        this.emit('error', {
          code: data.code || 'BROADCAST_ERROR',
          message: data.message || 'Broadcast session error',
          fatal: data.fatal ?? true,
        });
        if (data.fatal) {
          this.isHostOrGuestActive = false;
        }
      })
    );

    // Network quality updated
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_NETWORK_QUALITY_UPDATED', (data: any) => {
        console.log('[IVS_CLIENT] Network quality:', data);
        const quality = (data.quality as NetworkQuality) || NetworkQuality.UNKNOWN;
        this.networkQuality = quality;

        this.emit('networkQualityUpdated', {
          quality,
          isLocal: true,
        });
      })
    );
  }

  private setupPlayerEventListeners() {
    if (!this.playerEventEmitter) return;

    // Player error
    this.playerSubscriptions.push(
      this.playerEventEmitter.addListener('IVS_PLAYER_ERROR', (data: any) => {
        console.error('[IVS_CLIENT] Player error:', data);
        this.emit('error', {
          code: data.code || 'PLAYER_ERROR',
          message: data.message || 'Playback error',
          fatal: data.fatal ?? true,
        });
        if (data.fatal) {
          this.isViewerActive = false;
        }
      })
    );

    // Network quality updated (viewer)
    this.playerSubscriptions.push(
      this.playerEventEmitter.addListener('IVS_PLAYER_NETWORK_QUALITY_UPDATED', (data: any) => {
        console.log('[IVS_CLIENT] Player network quality:', data);
        const quality = (data.quality as NetworkQuality) || NetworkQuality.UNKNOWN;
        this.networkQuality = quality;

        this.emit('networkQualityUpdated', {
          quality,
          isLocal: false,
        });
      })
    );
  }

  async startHostSession(params: HostSessionParams): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available on this platform');
    }

    console.log('[IVS_CLIENT] Starting host session:', params);
    this.currentSessionId = params.sessionId;

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.startHostSession(
        params.stageArn,
        params.token,
        params.sessionId,
        (error: any) => {
          if (error) {
            console.error('[IVS_CLIENT] Host start failed:', error);
            reject(new Error(error.message || 'Failed to start host session'));
          } else {
            console.log('[IVS_CLIENT] Host session started');
            this.isHostOrGuestActive = true;
            resolve();
          }
        }
      );
    });
  }

  async stopHostSession(): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available');
    }

    console.log('[IVS_CLIENT] Stopping host session');
    this.isHostOrGuestActive = false;
    this.participants.clear();

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.stopHostSession((error: any) => {
        if (error) {
          console.error('[IVS_CLIENT] Host stop failed:', error);
          reject(new Error(error.message || 'Failed to stop host session'));
        } else {
          console.log('[IVS_CLIENT] Host session stopped');
          resolve();
        }
      });
    });
  }

  async startGuestSession(params: GuestSessionParams): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available on this platform');
    }

    console.log('[IVS_CLIENT] Starting guest session:', params);
    this.currentSessionId = params.sessionId;

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.startGuestSession(
        params.stageArn,
        params.token,
        params.sessionId,
        params.slotIndex,
        (error: any) => {
          if (error) {
            console.error('[IVS_CLIENT] Guest start failed:', error);
            reject(new Error(error.message || 'Failed to start guest session'));
          } else {
            console.log('[IVS_CLIENT] Guest session started');
            this.isHostOrGuestActive = true;
            resolve();
          }
        }
      );
    });
  }

  async stopGuestSession(): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available');
    }

    console.log('[IVS_CLIENT] Stopping guest session');
    this.isHostOrGuestActive = false;
    this.participants.clear();

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.stopGuestSession((error: any) => {
        if (error) {
          console.error('[IVS_CLIENT] Guest stop failed:', error);
          reject(new Error(error.message || 'Failed to stop guest session'));
        } else {
          console.log('[IVS_CLIENT] Guest session stopped');
          resolve();
        }
      });
    });
  }

  async joinAsViewer(params: ViewerSessionParams): Promise<void> {
    if (!IVSPlayerModule) {
      throw new Error('IVSPlayerModule not available on this platform');
    }

    console.log('[IVS_CLIENT] Joining as viewer:', params);
    this.currentSessionId = params.sessionId;

    return new Promise((resolve, reject) => {
      IVSPlayerModule.joinAsViewer(params.playbackUrl, params.sessionId, (error: any) => {
        if (error) {
          console.error('[IVS_CLIENT] Viewer join failed:', error);
          reject(new Error(error.message || 'Failed to join as viewer'));
        } else {
          console.log('[IVS_CLIENT] Viewer session joined');
          this.isViewerActive = true;
          resolve();
        }
      });
    });
  }

  async leaveAsViewer(): Promise<void> {
    if (!IVSPlayerModule) {
      throw new Error('IVSPlayerModule not available');
    }

    console.log('[IVS_CLIENT] Leaving viewer session');
    this.isViewerActive = false;

    return new Promise((resolve, reject) => {
      IVSPlayerModule.leaveAsViewer((error: any) => {
        if (error) {
          console.error('[IVS_CLIENT] Viewer leave failed:', error);
          reject(new Error(error.message || 'Failed to leave viewer session'));
        } else {
          console.log('[IVS_CLIENT] Viewer session left');
          resolve();
        }
      });
    });
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available');
    }

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.setMicEnabled(enabled, (error: any) => {
        if (error) {
          reject(new Error(error.message || 'Failed to set mic'));
        } else {
          resolve();
        }
      });
    });
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available');
    }

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.setCameraEnabled(enabled, (error: any) => {
        if (error) {
          reject(new Error(error.message || 'Failed to set camera'));
        } else {
          resolve();
        }
      });
    });
  }

  async switchCamera(): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available');
    }

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.switchCamera((error: any) => {
        if (error) {
          reject(new Error(error.message || 'Failed to switch camera'));
        } else {
          resolve();
        }
      });
    });
  }

  on(eventType: string, handler: LiveStreamingEventHandler): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  private emit(eventType: string, payload: any) {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler({ type: eventType, payload } as LiveStreamingEvent);
        } catch (error) {
          console.error(`[IVS_CLIENT] Event handler error for ${eventType}:`, error);
        }
      });
    }
  }

  getParticipants(): StreamParticipant[] {
    return Array.from(this.participants.values());
  }

  getNetworkQuality(): NetworkQuality {
    return this.networkQuality;
  }

  isActive(): boolean {
    return this.isHostOrGuestActive || this.isViewerActive;
  }

  /**
   * Clean up all event subscriptions (call on app shutdown or component unmount).
   */
  dispose() {
    this.broadcastSubscriptions.forEach((sub) => sub.remove());
    this.playerSubscriptions.forEach((sub) => sub.remove());
    this.broadcastSubscriptions = [];
    this.playerSubscriptions = [];
    this.eventHandlers.clear();
    this.participants.clear();
  }
}

// Singleton instance
let ivsClientInstance: IVSNativeClient | null = null;

export function getIVSNativeClient(): IVSNativeClient {
  if (!ivsClientInstance) {
    ivsClientInstance = new IVSNativeClient();
  }
  return ivsClientInstance;
}
