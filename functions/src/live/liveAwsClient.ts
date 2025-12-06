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
export async function createParticipantToken(
  stageArn: string,
  userId: string,
  capabilities: ('PUBLISH' | 'SUBSCRIBE')[],
  durationSeconds: number = 3600
): Promise<ParticipantTokenDetails> {
  try {
    // AWS SDK v3 handles token generation via a separate API
    // We call a service endpoint that returns the token
    // This is a simplified example; actual implementation may differ based on AWS SDK behavior

    // For now, we return a placeholder that will be replaced by real SDK behavior
    // In production, this would call AWS STS or IVS Real-Time service
    const expiresAt = new Date(Date.now() + durationSeconds * 1000);

    // Construct token (in reality, AWS SDK would do this)
    const tokenPayload = {
      stageArn,
      userId,
      capabilities,
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
    };

    // This is where we'd call the real AWS token endpoint
    // For now, return structure for integration testing
    const token = `ivs-${Buffer.from(JSON.stringify(tokenPayload)).toString('base64')}`;

    console.log('[LIVE_AWS][CREATE_PARTICIPANT_TOKEN_SUCCESS]', {
      userId,
      stageArn,
      capabilities,
      expiresAt,
    });

    return {
      token,
      expiresAt,
      durationSeconds,
    };
  } catch (error) {
    console.error('[LIVE_AWS][CREATE_PARTICIPANT_TOKEN_ERROR]', {
      stageArn,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get playback URL for a stage (for viewers to watch).
 * 
 * In production, this would derive from stage metadata or a separate channel.
 * For now, returns a placeholder that mobile can use.
 * 
 * @param stageArn - Stage to get playback for
 * @returns HLS playback URL
 */
export function getPlaybackUrl(stageArn: string): string {
  // Example derivation: extract stage ID from ARN and construct playback URL
  // Actual implementation depends on AWS IVS channel setup
  const stageId = stageArn.split('/').pop() || 'unknown';
  const playbackUrl = `https://d${stageId}.ivs.aws.example.com/index.m3u8`;
  return playbackUrl;
}
