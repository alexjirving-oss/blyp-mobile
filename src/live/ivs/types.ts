/**
 * IVS Core Types
 * 
 * Type definitions for Amazon IVS streaming integration.
 */

export type IVSRole = 'host' | 'guest' | 'viewer';

export type IVSStreamIdentity = {
  streamId: string;       // Blyp-level stream id
  hostUserId: string;
};

export type IVSSessionToken = {
  token: string;          // ephemeral auth token from backend
  expiresAt: number;      // epoch ms
};

export type IVSJoinParams = {
  role: IVSRole;
  identity: IVSStreamIdentity;
  sessionToken: IVSSessionToken;
};

export type IVSConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type IVSLocalMediaState = {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  isFrontCamera: boolean;
};

export type IVSRemoteParticipant = {
  userId: string;
  displayName?: string;
  isHost: boolean;
  isGuest: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
};
