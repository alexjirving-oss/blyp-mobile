/**
 * IVS Native Client
 *
 * Concrete implementation of LiveStreamingClient that wraps native IVS modules.
 * Bridges JS React Native layer to native Android/iOS IVS SDKs.
 *
 * Platform Support:
 * - Android: Full support via Amazon IVS Broadcast + Player SDKs (Kotlin)
 * - iOS: Full support via Amazon IVS Broadcast (Stages) + Player SDKs (Swift),
 *   integrated through the `withIVSiOS` config plugin. Availability is gated on
 *   the native modules being present (see constructor + StreamingBackendFactory).
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { getIVSEnv } from '../config/IVSEnv';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Constants = require('expo-constants');
import {
  LiveStreamingClient,
  LiveStreamingEvent,
  LiveStreamingEventHandler,
  StreamParticipant,
  NetworkQuality,
  HostSessionParams,
  GuestSessionParams,
  ViewerSessionParams,
  ViewerPlaybackParams,
} from './LiveStreamingClient';

const { IVSBroadcastModule, IVSPlayerModule } = NativeModules;

type EventSubscription = {
  remove: () => void;
};

/**
 * IVS Native Client – Production implementation for Android and iOS.
 * Both platforms bridge to the native Amazon IVS Stages + Player SDKs.
 */
export class IVSNativeClient implements LiveStreamingClient {
  private eventHandlers: Map<string, Set<LiveStreamingEventHandler>> = new Map();
  private broadcastEventEmitter: NativeEventEmitter | null = null;
  private playerEventEmitter: NativeEventEmitter | null = null;
  private broadcastSubscriptions: EventSubscription[] = [];
  private playerSubscriptions: EventSubscription[] = [];

  private participants: Map<string, StreamParticipant> = new Map();
  private remoteVideoTrackCounts: Map<string, number> = new Map();
  private localMediaState = { videoEnabled: false, audioEnabled: false };
  private networkQuality: NetworkQuality = NetworkQuality.UNKNOWN;
  private isHostOrGuestActive = false;
  private isViewerActive = false;
  private currentSessionId: string | null = null;
  private ivsEnv = getIVSEnv();

  constructor() {
    // Validate platform support at construction time
    this.logConfig();

    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      throw new Error(
        `IVS Real-Time streaming is not supported on platform: ${Platform.OS}. ` +
        'Supported platforms are Android and iOS (native dev client / EAS build).'
      );
    }

    // Verify native modules are available. On iOS these ship via the withIVSiOS
    // config plugin; on Android via the IVSPackage. Missing modules means this
    // build wasn't prebuilt with IVS (e.g. Expo Go) – callers fall back to HLS.
    if (!IVSBroadcastModule || !IVSPlayerModule) {
      console.error('[IVS_NATIVE][MISSING_MODULES]', {
        platform: Platform.OS,
        hasBroadcast: !!IVSBroadcastModule,
        hasPlayer: !!IVSPlayerModule,
        hint: 'Use Expo dev client / EAS build; IVS is not available in Expo Go.',
      });
      throw new Error(
        'IVS native modules not found. Build and install the dev client (EAS) with IVS native modules; Expo Go cannot load IVS.'
      );
    }

    this.initializeEventEmitters();
  }

  private logConfig() {
    try {
      // Read directly from process.env (used by ivsLiveApi.ts and other runtime code)
      // Constants.expoConfig.extra is less reliable in dev client
      const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
      const streamingBackend = process.env.EXPO_PUBLIC_STREAMING_BACKEND;

      console.log('[IVS_NATIVE][CONFIG]', {
        apiBaseUrl: apiBaseUrl || '❌ undefined',
        streamingBackend: streamingBackend || '❌ undefined',
        hasBroadcastModule: !!IVSBroadcastModule,
        hasPlayerModule: !!IVSPlayerModule,
      });
    } catch (e) {
      console.log('[IVS_NATIVE][CONFIG] unable to read config', e);
    }
  }

  private initializeEventEmitters() {
    // Broadcast emitter for host/guest sessions (Android verified in constructor)
    this.broadcastEventEmitter = new NativeEventEmitter(IVSBroadcastModule);
    this.setupBroadcastEventListeners();

    // Player emitter for viewer sessions (Android verified in constructor)
    this.playerEventEmitter = new NativeEventEmitter(IVSPlayerModule);
    this.setupPlayerEventListeners();
  }

  private inferNetworkQualityFromMetrics(data: any): NetworkQuality {
    const bitrate = typeof data?.bitrate === 'number' ? data.bitrate : undefined;
    const latency = typeof data?.liveLatency === 'number' ? data.liveLatency : undefined;

    if (latency !== undefined && latency > 5) return NetworkQuality.POOR;
    if (latency !== undefined && latency > 3.5) return NetworkQuality.FAIR;

    if (bitrate === undefined) return NetworkQuality.UNKNOWN;
    if (bitrate >= 3500) return NetworkQuality.EXCELLENT;
    if (bitrate >= 2500) return NetworkQuality.GOOD;
    if (bitrate >= 1500) return NetworkQuality.FAIR;
    if (bitrate > 0) return NetworkQuality.POOR;
    return NetworkQuality.UNKNOWN;
  }

  private setupBroadcastEventListeners() {
    if (!this.broadcastEventEmitter) return;

    // Broadcast session connection state
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_BROADCAST_STATE_CHANGED', (data: any) => {
        this.emit('broadcastStateChanged', {
          state: data.state,
        });
      })
    );

    // Surface readiness (host/viewer) emitted by native after configureStageForRendering
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_SURFACE_READY', (data: any) => {
        this.emit('surfaceReady', {
          ready: data.ready,
          width: data.width,
          height: data.height,
        });
      })
    );

    // First frame signal for remote video streams (viewer)
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_REMOTE_FIRST_FRAME_SIGNAL', (data: any) => {
        this.emit('firstFrame', {
          streamKey: data.streamKey,
          sessionId: data.sessionId,
        });
      })
    );

    // Local participant joined (host or guest)
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_HOST_LOCAL_JOINED', (data: any) => {
        console.log('[IVS_CLIENT] Local broadcast joined:', data);
        const participantId = data.participantId || data.sessionId || 'local';
        const role = data.role || 'host';
        const slotIndex = data.slotIndex;

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
          if (data.slotIndex !== undefined && data.slotIndex !== null) participant.slotIndex = data.slotIndex;
          if (data.role) participant.role = data.role;
          if (data.userId) participant.userId = data.userId;
        } else if (participantId) {
          this.participants.set(participantId, {
            participantId,
            userId: data.userId,
            slotIndex: data.slotIndex,
            role: data.role || 'guest',
            isLocal: false,
            isMuted: data.isMuted ?? false,
            isCameraDisabled: data.isCameraDisabled ?? false,
          });
        }

        this.emit('remoteParticipantUpdated', {
          participantId,
          isMuted: data.isMuted,
          isCameraDisabled: data.isCameraDisabled,
          slotIndex: data.slotIndex,
          role: data.role,
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
          details: data.details,
          exception: data.exception,
          cause: data.cause,
          causeException: data.causeException,
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

    // Local media availability (camera/mic) updates
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_LOCAL_TRACK_UPDATE', (data: any) => {
        const videoEnabled = !!data.videoEnabled;
        const audioEnabled = !!data.audioEnabled;
        console.log('[IVS_CLIENT] Local track update:', { videoEnabled, audioEnabled });
        this.localMediaState = { videoEnabled, audioEnabled };
        this.emit('localMediaState', this.localMediaState);
      })
    );

    // Remote video track added/removed events to help viewer diagnostics
    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_REMOTE_VIDEO_ADDED', (data: any) => {
        const participantId = data.participantId || 'unknown';
        const current = this.remoteVideoTrackCounts.get(participantId) || 0;
        const next = current + 1;
        this.remoteVideoTrackCounts.set(participantId, next);

        const slotIndex = data.slotIndex;
        const participant = this.participants.get(participantId) || {
          participantId,
          userId: data.userId,
          role: data.role || 'guest',
          slotIndex,
          isLocal: false,
          isMuted: false,
          isCameraDisabled: false,
        };
        participant.isCameraDisabled = false;
        if (slotIndex !== undefined && slotIndex !== null) {
          participant.slotIndex = slotIndex;
        }
        if (data.role) participant.role = data.role;
        this.participants.set(participantId, participant);

        this.emit('remoteParticipantUpdated', {
          participantId,
          isCameraDisabled: false,
        });

        this.emit('remoteVideoTrackAdded', {
          participantId,
          userId: data.userId,
          streamKey: data.streamKey,
          slotIndex,
          role: data.role,
          videoTrackCount: next,
        });
      })
    );

    this.broadcastSubscriptions.push(
      this.broadcastEventEmitter.addListener('IVS_REMOTE_VIDEO_REMOVED', (data: any) => {
        const participantId = data.participantId || 'unknown';
        const current = this.remoteVideoTrackCounts.get(participantId) || 0;
        const next = Math.max(0, current - 1);
        this.remoteVideoTrackCounts.set(participantId, next);

        const participant = this.participants.get(participantId);
        if (participant) {
          participant.isCameraDisabled = next === 0;
          this.participants.set(participantId, participant);
          this.emit('remoteParticipantUpdated', {
            participantId,
            isCameraDisabled: participant.isCameraDisabled,
            isMuted: participant.isMuted,
          });
        }

        this.emit('remoteVideoTrackRemoved', {
          participantId,
          userId: data.userId,
          streamKey: data.streamKey,
          videoTrackCount: next,
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
        const quality = (data.quality as NetworkQuality) || this.inferNetworkQualityFromMetrics(data);
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

    console.log('[IVS_CLIENT][START_HOST_SESSION]', {
      stageArn: params.stageArn,
      tokenLength: params.token.length,
      sessionId: params.sessionId,
      cameraPosition: params.cameraPosition,
      region: this.ivsEnv.region,
    });

    this.currentSessionId = params.sessionId;

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.startHostSession(
        params.stageArn,
        params.token,
        params.sessionId,
        (error: any) => {
          if (error) {
            console.error('[IVS_CLIENT][HOST_START_FAILED]', {
              error: error.message || error,
              code: error.code || 'unknown',
              stageArn: params.stageArn,
            });
            reject(new Error(error.message || 'Failed to start host session'));
          } else {
            console.log('[IVS_CLIENT][HOST_SESSION_STARTED]', {
              sessionId: params.sessionId,
            });
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
    this.remoteVideoTrackCounts.clear();
    this.localMediaState = { videoEnabled: false, audioEnabled: false };

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

  /**
   * Start a guest publishing session.
   * NOTE: The native module currently aliases guest -> host session start, but the
   * token capabilities/attributes (role=guest) still differ and allow testing.
   */
  async startGuestSession(params: GuestSessionParams): Promise<void> {
    // Guest publish is ON by default (opt-out only via explicit 0/false).
    const fromEnv = String(process?.env?.EXPO_PUBLIC_ENABLE_GUEST_PUBLISH ?? '').toLowerCase();
    const fromExtra = String(
      (Constants as { expoConfig?: { extra?: Record<string, unknown> } })?.expoConfig?.extra
        ?.EXPO_PUBLIC_ENABLE_GUEST_PUBLISH ?? '',
    ).toLowerCase();
    const flag = fromEnv || fromExtra;
    const guestDisabled = flag === '0' || flag === 'false';
    if (guestDisabled) {
      throw new Error(
        'Guest publish is disabled. Unset EXPO_PUBLIC_ENABLE_GUEST_PUBLISH (or set it to 1) to enable.'
      );
    }
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available');
    }

    console.log('[IVS_CLIENT] Starting guest session', {
      sessionId: params.sessionId,
      stageArn: params.stageArn,
      tokenLength: params.token?.length,
      slotIndex: params.slotIndex,
    });

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
            console.log('[IVS_CLIENT][GUEST_SESSION_STARTED]', { sessionId: params.sessionId });
            this.isHostOrGuestActive = true;
            resolve();
          }
        }
      );
    });
  }

  /**
   * Stop the guest publishing session.
   */
  async stopGuestSession(): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available');
    }

    console.log('[IVS_CLIENT] Stopping guest session');
    this.isHostOrGuestActive = false;
    this.participants.clear();
    this.remoteVideoTrackCounts.clear();
    this.localMediaState = { videoEnabled: false, audioEnabled: false };

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
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available on this platform');
    }

    console.log('[IVS_CLIENT] Joining as viewer via IVS Real-Time stage:', {
      stageArn: params.stageArn,
      tokenLength: params.token?.length,
      sessionId: params.sessionId,
      region: this.ivsEnv.region,
    });
    this.currentSessionId = params.sessionId;

    // For IVS Real-Time viewers, use the broadcast module's read-only stage join
    // instead of trying to load an HLS playback URL
    return new Promise((resolve, reject) => {
      IVSBroadcastModule.joinAsViewerReadOnly(
        params.stageArn,
        params.token,
        params.sessionId,
        (error: any) => {
          if (error) {
            console.error('[IVS_CLIENT] Viewer join failed:', error);
            reject(new Error(error.message || 'Failed to join as viewer'));
          } else {
            console.log('[IVS_CLIENT] Viewer session joined as read-only participant');
            this.isViewerActive = true;
            resolve();
          }
        }
      );
    });
  }

  /**
   * Join as a viewer using IVS Player (HLS/low-latency playback).
   * Production-recommended path for viewers.
   */
  async joinAsViewerPlayback(params: ViewerPlaybackParams): Promise<void> {
    if (!IVSPlayerModule) {
      throw new Error('IVSPlayerModule not available on this platform');
    }

    if (!params.playbackUrl || params.playbackUrl.trim().length === 0) {
      throw new Error('playbackUrl is required for viewer playback');
    }

    console.log('[IVS_CLIENT] Joining as viewer via IVS Player (playback):', {
      sessionId: params.sessionId,
      playbackUrlLength: params.playbackUrl.length,
    });
    this.currentSessionId = params.sessionId;

    return new Promise((resolve, reject) => {
      IVSPlayerModule.joinAsViewer(
        params.playbackUrl,
        params.sessionId,
        (error: any) => {
          if (error) {
            console.error('[IVS_CLIENT] Viewer playback join failed:', error);
            reject(new Error(error.message || 'Failed to join as viewer'));
          } else {
            console.log('[IVS_CLIENT] Viewer playback session joined');
            this.isViewerActive = true;
            resolve();
          }
        }
      );
    });
  }

  async forceReattach(reason: string): Promise<void> {
    if (!IVSBroadcastModule) throw new Error('IVS Broadcast module not available');

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.forceReattach(reason, (error: any) => {
        if (error) {
          reject(new Error(error.message || 'Failed to force reattach'));
        } else {
          resolve();
        }
      });
    });
  }

  async leaveAsViewer(): Promise<void> {
    if (!IVSBroadcastModule) {
      throw new Error('IVSBroadcastModule not available');
    }

    console.log('[IVS_CLIENT] Leaving viewer session');
    this.isViewerActive = false;
    this.remoteVideoTrackCounts.clear();

    return new Promise((resolve, reject) => {
      IVSBroadcastModule.leaveAsViewerReadOnly((error: any) => {
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
