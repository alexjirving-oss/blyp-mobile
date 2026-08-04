/**
 * AWS IVS and IVS Real-Time client initialization and helpers.
 * 
 * Uses AWS SDK v3 (modular):
 * - IVS (Interactive Video Service): For low-latency streaming setup
 * - IVS Real-Time: For multi-participant stage management
 * 
 * Configuration via environment:
 * - AWS_REGION: AWS region (e.g., 'us-east-1')
 * - IVS_STAGE_ARN (optional): Pre-created stage ARN; if omitted, stages are created per session
 * - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: AWS credentials (auto-loaded from environment)
 */

import {
  IVSRealTimeClient,
  CreateStageCommand,
  CreateStageCommandInput,
  DeleteStageCommand,
} from '@aws-sdk/client-ivs-realtime';
import { IvsClient } from '@aws-sdk/client-ivs';
import { ParticipantTokenDetails } from './liveTypes';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

if (!AWS_REGION) {
  throw new Error(
    '[LIVE_AWS] AWS_REGION environment variable is required for IVS integration.'
  );
}

/**
 * IVS Real-Time client for stage and participant token management.
 */
export const ivsRealtimeClient = new IVSRealTimeClient({
  region: AWS_REGION,
  credentials: {
    // Credentials auto-loaded from environment or IAM role
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * IVS client for channel and playback key management.
 */
export const ivsClient = new IvsClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * Create a new IVS Stage for a live session.
 * 
 * A Stage represents a real-time interactive venue where host and guests can publish/subscribe.
 * Max participants per stage is typically 12 (1 host + 11 guests).
 * 
 * @param sessionId - Unique session identifier
 * @param displayName - Human-readable stage name (informational, may not be used by AWS)
 * @returns StageArn for the created stage
 */
export async function createStage(sessionId: string, displayName: string): Promise<string> {
  const input: CreateStageCommandInput = {
    name: `blyp-live-${sessionId}`,
  };

  try {
    const command = new CreateStageCommand(input);
    const response = await ivsRealtimeClient.send(command);

    if (!response.stage?.arn) {
      throw new Error('[LIVE_AWS][CREATE_STAGE] Response missing stageArn');
    }

    console.log('[LIVE_AWS][CREATE_STAGE_SUCCESS]', {
      sessionId,
      stageArn: response.stage.arn,
      stageName: response.stage.name,
      displayName,
    });

    return response.stage.arn;
  } catch (error) {
    console.error('[LIVE_AWS][CREATE_STAGE_ERROR]', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete an IVS Stage when session ends.
 * 
 * @param stageArn - ARN of stage to delete
 */
export async function deleteStage(stageArn: string): Promise<void> {
  try {
    const command = new DeleteStageCommand({ arn: stageArn });
    await ivsRealtimeClient.send(command);

    console.log('[LIVE_AWS][DELETE_STAGE_SUCCESS]', { stageArn });
  } catch (error) {
    console.error('[LIVE_AWS][DELETE_STAGE_ERROR]', {
      stageArn,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Create a participant token for joining a stage.
 * 
 * Token encodes:
 * - Stage ARN
 * - User ID
 * - Capabilities (publish/subscribe based on role)
 * - Expiration (typically 1 hour, configurable)
 * 
 * @param stageArn - Stage to join
 * @param userId - User requesting token
 * @param capabilities - Array of capabilities: 'PUBLISH', 'SUBSCRIBE'
 * @param durationSeconds - Token lifetime (default 3600 = 1 hour)
 * @returns Token and expiration details
 */
/**
 * DEPRECATED / DISABLED. This legacy helper never produced a real AWS-signed
 * participant token — it returned a fake base64 placeholder, so any flow routed
 * here could never publish/subscribe to an IVS stage. Authoritative token
 * minting lives in the `blyp-live-service` backend (`/api/live/*`), which calls
 * the real `CreateParticipantToken` IVS API.
 *
 * It now throws explicitly so a fake token can never be silently issued. The
 * endpoint itself is retained (not deleted) until older app builds that may
 * still reach legacy routes have aged out (see the client version-negotiation
 * workstream); at that point the legacy routes can be removed wholesale.
 */
export async function createParticipantToken(
  _stageArn: string,
  _userId: string,
  _capabilities: ('PUBLISH' | 'SUBSCRIBE')[],
  _durationSeconds: number = 3600
): Promise<ParticipantTokenDetails> {
  throw new Error(
    '[LIVE_AWS] Legacy createParticipantToken is disabled — it only ever produced ' +
    'non-functional placeholder tokens. Use the blyp-live-service /api/live/* endpoints, ' +
    'which mint real IVS participant tokens.'
  );
}

/**
 * DEPRECATED / DISABLED. Previously returned a fabricated `*.example.com`
 * playback URL that never resolved to a real stream. Real playback comes from
 * an IVS channel fed by server-side composition (see the transport workstream).
 * Throws so a fake URL can never be handed to a client.
 */
export function getPlaybackUrl(_stageArn: string): string {
  throw new Error(
    '[LIVE_AWS] Legacy getPlaybackUrl is disabled — it only ever produced a fake ' +
    'placeholder URL. Real playback is served from an IVS channel via composition.'
  );
}
