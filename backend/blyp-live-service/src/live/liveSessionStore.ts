import { docClient } from '../aws/dynamoClient';
import { PutCommand, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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

export interface LiveSessionListItem {
  sessionId: string;
  status: LiveStatus;
  hostUserId?: string;
  createdAt?: string;
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

export async function listSessionsByStatus(status: LiveStatus, limit = 10): Promise<LiveSessionListItem[]> {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 10;
  const res = await docClient.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: '#status = :status',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': status,
    },
    ProjectionExpression: 'sessionId, #status, hostUserId, createdAt',
    Limit: boundedLimit,
  }));

  const items = Array.isArray(res.Items) ? (res.Items as LiveSessionListItem[]) : [];
  return items
    .map((item) => ({
      sessionId: String(item.sessionId || ''),
      status: item.status,
      hostUserId: item.hostUserId ? String(item.hostUserId) : undefined,
      createdAt: item.createdAt ? String(item.createdAt) : undefined,
    }))
    .filter((item) => item.sessionId.length > 0)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
}
