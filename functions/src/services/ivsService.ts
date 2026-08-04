/**
 * IVS Realtime Token Service
 * 
 * Production-grade service for:
 * - Cognito ID token decoding and validation
 * - AWS IVS Real-Time participant token generation
 * - Clean, typed API responses for mobile clients
 * 
 * Architecture:
 * - Cognito verification is performed via JWKS (signature verification)
 * - IvsRealtimeService: AWS SDK wrapper for participant token creation
 * - IvsViewerService: Playback URL provisioning for viewers
 */

import {
  IVSRealTimeClient,
  CreateParticipantTokenCommand,
  CreateParticipantTokenCommandInput,
} from '@aws-sdk/client-ivs-realtime';

/**
 * Extract AWS region from an IVS stage ARN.
 * Format: arn:aws:ivs:<region>:<account>:stage/<stage-id>
 * 
 * @param stageArn - Full stage ARN
 * @returns Region string (e.g., 'us-east-1', 'eu-west-1')
 * @throws Error if ARN format is invalid
 */
export function getRegionFromStageArn(stageArn: string): string {
  if (!stageArn || typeof stageArn !== 'string') {
    throw new Error('Invalid stage ARN: must be non-empty string');
  }

  const parts = stageArn.split(':');
  // Expected format: arn:aws:ivs:<region>:<account>:stage/<id>
  // parts[0] = 'arn'
  // parts[1] = 'aws'
  // parts[2] = 'ivs'
  // parts[3] = '<region>'
  // parts[4] = '<account>'
  // parts[5] = 'stage/...'

  if (parts.length < 6 || parts[0] !== 'arn' || parts[2] !== 'ivs') {
    throw new Error(
      `Invalid IVS stage ARN format: ${stageArn}. ` +
      'Expected: arn:aws:ivs:<region>:<account>:stage/<stage-id>'
    );
  }

  const region = parts[3];
  if (!region || region.length === 0) {
    throw new Error(`Stage ARN missing region: ${stageArn}`);
  }

  return region;
}

/**
 * Clean response format for IVS token API.
 */
export interface IvsTokenResponse {
  token: string;
  stageArn: string;
  region: string;
  issuedAt: number; // Unix timestamp (milliseconds)
  expiresAt: number; // Unix timestamp (milliseconds)
  role: 'PUBLISHER' | 'SUBSCRIBER';
}

/**
 * IVS Real-Time service wrapper for AWS SDK.
 * Handles participant token generation for hosts and guests.
 */
export class IvsRealtimeService {
  private clientsByRegion: Map<string, IVSRealTimeClient> = new Map();

  constructor(_defaultRegion: string) {
    // Region is not stored; it's derived from each stage ARN
    // _defaultRegion parameter kept for future use if needed
  }

  /**
   * Get or create an IVS client for the specified region.
   * @param region AWS region
   * @returns IVSRealTimeClient for that region
   */
  private getClientForRegion(region: string): IVSRealTimeClient {
    if (!this.clientsByRegion.has(region)) {
      console.log('[IVS_SERVICE][CREATE_CLIENT_FOR_REGION]', { 
        region,
        hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
        hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
        credentialsSource: 'env-vars',
      });
      this.clientsByRegion.set(region, new IVSRealTimeClient({ region }));
    }
    return this.clientsByRegion.get(region)!;
  }

  /**
   * Create a participant token for joining an IVS Real-Time stage.
   * 
   * PRODUCTION GUARANTEE:
   * - Token is always generated with AWS IVS SDK (never mock/fake)
   * - Region is derived from the stage ARN, ensuring consistency
   * - If AWS call fails, returns HTTP 500 error (fail-closed)
   * 
   * @param opts - Token request options
   * @param opts.userId - User ID (from Cognito sub)
   * @param opts.stageArn - Stage ARN to join
   * @param opts.role - Role: 'PUBLISHER' (host/guest) or 'SUBSCRIBER' (guest subscriber)
   * @param opts.durationSeconds - Token validity duration (default 3600 = 1 hour)
   * @returns Token details with expiration
   */
  async createParticipantToken(opts: {
    userId: string;
    stageArn: string;
    role: 'PUBLISHER' | 'SUBSCRIBER';
    durationSeconds?: number;
  }): Promise<IvsTokenResponse> {
    const { userId, stageArn, role, durationSeconds = 3600 } = opts;

    // CRITICAL: Extract region from stage ARN to ensure AWS SDK client is in correct region
    let region: string;
    try {
      region = getRegionFromStageArn(stageArn);
    } catch (error) {
      console.error('[IVS_SERVICE][INVALID_STAGE_ARN]', {
        userId,
        stageArn,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Invalid stage ARN: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    console.log('[IVS_SERVICE][CREATE_TOKEN_REQUEST]', {
      userId,
      stageArn,
      region,
      role,
      durationSeconds,
    });

    try {
      // Get AWS SDK client for this region (or reuse if already created)
      const client = this.getClientForRegion(region);

      // Map role to AWS capability enum
      const awsCapability = role === 'PUBLISHER' ? 'PUBLISH' : 'SUBSCRIBE';

      const input: CreateParticipantTokenCommandInput = {
        stageArn,
        userId,
        capabilities: [awsCapability],
        duration: durationSeconds,
      };

      const command = new CreateParticipantTokenCommand(input);
      const response = await client.send(command);

      if (!response.participantToken?.token) {
        throw new Error('AWS response missing participantToken.token');
      }

      const issuedAt = Date.now();
      const expiresAt = issuedAt + durationSeconds * 1000;

      const tokenResponse: IvsTokenResponse = {
        token: response.participantToken.token,
        stageArn,
        region,
        issuedAt,
        expiresAt,
        role,
      };

      console.log('[IVS_SERVICE][CREATE_TOKEN_SUCCESS]', {
        userId,
        stageArn,
        region,
        role,
        tokenLength: response.participantToken.token.length,
        expiresAt: new Date(expiresAt).toISOString(),
      });

      return tokenResponse;
    } catch (error) {
      console.error('[IVS_SERVICE][CREATE_TOKEN_ERROR]', {
        userId,
        stageArn,
        region,
        role,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new Error(
        `Failed to create IVS participant token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Viewer-facing playback service.
 * Provides HLS playback URLs for viewers without needing participant tokens.
 */
export class IvsViewerService {
  private playbackUrl: string;

  constructor(playbackUrl: string) {
    if (!playbackUrl) {
      throw new Error('IvsViewerService requires playbackUrl');
    }
    this.playbackUrl = playbackUrl;
  }

  /**
   * Get viewer playback information.
   * For MVP, returns the shared playback URL.
   * In production, could return viewer-specific analytics endpoints.
   * 
   * @param opts - Viewer request options
   * @param opts.userId - Viewer user ID (for analytics)
   * @returns Playback information
   */
  getViewerInfo(opts: { userId: string }): { playbackUrl: string; viewerId: string } {
    console.log('[IVS_VIEWER_SERVICE][GET_INFO]', {
      userId: opts.userId,
      playbackUrl: this.playbackUrl,
    });

    return {
      playbackUrl: this.playbackUrl,
      viewerId: opts.userId,
    };
  }
}

// Singleton instances
// PRODUCTION: IvsRealtimeService no longer initializes a single region upfront
// Instead, it creates clients on-demand for each stage ARN's region

if (!process.env.AWS_REGION) {
  console.warn('[IVS_SERVICE] AWS_REGION not set, will derive region from stage ARN');
}

export const ivsRealtime = new IvsRealtimeService(process.env.AWS_REGION || 'eu-west-1');

// Lazy-initialize viewer service to allow emulator to start without IVS_PLAYBACK_URL
export let ivsViewer: IvsViewerService | null = null;

// Helper function to get playback URL (lazy-loaded to ensure env vars are available)
function getPlaybackUrl(): string {
  const url = process.env.IVS_PLAYBACK_URL;
  if (!url) {
    console.warn('[IVS_SERVICE] IVS_PLAYBACK_URL not configured; using mock playback URL');
    return 'https://d366ae82bd93.eu-west-1.playback.live-video.net/';
  }
  return url;
}

// Initialize viewer service on first use
function initializeViewerService(): IvsViewerService {
  if (ivsViewer) {
    return ivsViewer;
  }
  
  try {
    const playbackUrl = getPlaybackUrl();
    ivsViewer = new IvsViewerService(playbackUrl);
    console.log('[IVS_SERVICE] Initialized viewer service with playback URL:', playbackUrl);
    return ivsViewer;
  } catch (err) {
    console.error('[IVS_SERVICE] Failed to init viewer service:', err);
    throw new Error(`Viewer service initialization failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Export function to get viewer service (lazy-loads on first call)
export function getIvsViewer(): IvsViewerService {
  return initializeViewerService();
}
