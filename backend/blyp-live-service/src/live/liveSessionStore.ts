import { docClient } from '../aws/dynamoClient';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export type LiveStatus = 'PENDING' | 'LIVE' | 'ENDED';

export interface LiveSession {
  sessionId: string;
  hostUserId: string;
  stageArn: string;
  channelArn?: string;
  /**
   * AWS region the stage/channel lives in. Stored explicitly (rather than always
   * re-parsing it from the stage ARN) so the session/registry is region-aware
   * for multi-region routing and discovery. Optional for backward compatibility
   * with sessions created before this field existed — callers should fall back
   * to deriving it from `stageArn` when absent.
   */
  region?: string;
  /**
   * User IDs the host has appointed as moderators for this session. Stored as a
   * DynamoDB String Set (so it reads back as a Set at runtime — use
   * `sessionHasModerator` to test membership rather than Array methods).
   * Moderators may mute/kick guests; they cannot invite guests or end the room.
   */
  moderatorIds?: string[];
  title: string;
  status: LiveStatus;
  createdAt: string;
  endedAt?: string;
}

const TABLE_NAME = process.env.LIVE_SESSIONS_TABLE;

if (!TABLE_NAME) {
  throw new Error('[config] LIVE_SESSIONS_TABLE is required');
}

export async function createSession(input: LiveSession): Promise<void> {
  await docClient.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: input,
    ConditionExpression: 'attribute_not_exists(sessionId)',
  }));
}

export async function getSessionById(sessionId: string): Promise<LiveSession | null> {
  const res = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { sessionId },
  }));
  return (res.Item as LiveSession | undefined) || null;
}

export async function addModerator(sessionId: string, userId: string): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId },
    UpdateExpression: 'ADD moderatorIds :ids',
    ExpressionAttributeValues: { ':ids': new Set([userId]) },
    ConditionExpression: 'attribute_exists(sessionId)',
  }));
}

export async function removeModerator(sessionId: string, userId: string): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId },
    UpdateExpression: 'DELETE moderatorIds :ids',
    ExpressionAttributeValues: { ':ids': new Set([userId]) },
    ConditionExpression: 'attribute_exists(sessionId)',
  }));
}

/** Membership test that tolerates the field being a Set (DynamoDB) or array. */
export function sessionHasModerator(session: LiveSession, userId: string): boolean {
  const mods = session.moderatorIds as unknown as Set<string> | string[] | undefined;
  if (!mods) return false;
  if (mods instanceof Set) return mods.has(userId);
  return Array.isArray(mods) ? mods.includes(userId) : false;
}

export async function updateSessionStatus(sessionId: string, status: LiveStatus, endedAt?: string): Promise<void> {
  const updateExpr = ['set #status = :status'];
  const exprValues: Record<string, any> = { ':status': status };
  const exprNames: Record<string, string> = { '#status': 'status' };
  if (endedAt) {
    updateExpr.push('#endedAt = :endedAt');
    exprValues[':endedAt'] = endedAt;
    exprNames['#endedAt'] = 'endedAt';
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId },
    UpdateExpression: updateExpr.join(', '),
    ExpressionAttributeValues: exprValues,
    ExpressionAttributeNames: exprNames,
    ConditionExpression: 'attribute_exists(sessionId)',
  }));
}
