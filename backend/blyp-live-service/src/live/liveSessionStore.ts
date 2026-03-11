import { docClient } from '../aws/dynamoClient';
import { PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ENV } from '../config/env';

export type LiveStatus = 'PENDING' | 'LIVE' | 'ENDED';

export interface LiveSession {
  sessionId: string;
  hostUserId: string;
  stageArn: string;
  channelArn?: string;
  title: string;
  status: LiveStatus;
  createdAt: string;
  endedAt?: string;
}

const TABLE_NAME = process.env.LIVE_SESSIONS_TABLE || ENV.LIVE_SESSIONS_TABLE;

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
