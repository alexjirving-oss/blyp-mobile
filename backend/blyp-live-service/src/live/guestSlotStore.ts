import { docClient } from '../aws/dynamoClient';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ENV } from '../config/env';

export type GuestState = 'REQUESTED' | 'INVITED' | 'LIVE' | 'REJECTED' | 'KICKED' | 'LEFT';

export interface GuestSlot {
  sessionId: string;
  userId: string;
  state: GuestState;
  requestedAt: string;
  updatedAt: string;
  guestSessionId?: string;
  connectedAt?: string;
  lastHeartbeatAt?: string;
  disconnectedAt?: string;
  slotIndexRequested?: number;
  slotIndex?: number;
}

const TABLE_NAME = process.env.LIVE_GUESTS_TABLE || ENV.LIVE_GUESTS_TABLE;

if (!TABLE_NAME) {
  throw new Error('[config] LIVE_GUESTS_TABLE is required');
}

export async function requestGuestSlot(
  sessionId: string,
  userId: string,
  nowIso: string,
  slotIndexRequested?: number
): Promise<void> {
  try {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        sessionId,
        userId,
        state: 'REQUESTED',
        requestedAt: nowIso,
        updatedAt: nowIso,
        ...(typeof slotIndexRequested === 'number' ? { slotIndexRequested } : {}),
      },
      ConditionExpression: 'attribute_not_exists(sessionId) AND attribute_not_exists(userId)',
    }));
    return;
  } catch (err: any) {
    // If the record already exists (common after a guest leaves), treat this as an idempotent re-request.
    // For safety, do not overwrite an actively LIVE guest session.
    if (err?.name !== 'ConditionalCheckFailedException') {
      throw err;
    }

    const existing = await getGuest(sessionId, userId);
    if (!existing) {
      throw err;
    }

    if (existing.state === 'LIVE') {
      // If the client crashed/restarted, the LIVE record can become stale.
      // Treat stale LIVE as left so the user can re-request.
      const last = existing.lastHeartbeatAt || existing.updatedAt || existing.connectedAt || '';
      const lastMs = Date.parse(String(last));
      const STALE_MS = 35_000;
      const isStale = !lastMs || Number.isNaN(lastMs) || (Date.now() - lastMs) > STALE_MS;

      if (!isStale) {
        const e: any = new Error('Guest session already active');
        e.code = 'GUEST_SESSION_ACTIVE';
        throw e;
      }

      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { sessionId, userId },
        UpdateExpression: 'SET #state = :state, disconnectedAt = :updatedAt, updatedAt = :updatedAt REMOVE guestSessionId',
        ExpressionAttributeNames: {
          '#state': 'state',
        },
        ExpressionAttributeValues: {
          ':state': 'LEFT',
          ':updatedAt': nowIso,
        },
        ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId)',
      }));
    }

    // If already invited, keep the invite state/slot and just refresh timestamps.
    if (existing.state === 'INVITED') {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { sessionId, userId },
        UpdateExpression: [
          'set updatedAt = :updatedAt',
          ...(typeof slotIndexRequested === 'number' ? ['slotIndexRequested = :slotIndexRequested'] : []),
        ].join(', '),
        ExpressionAttributeValues: {
          ':updatedAt': nowIso,
          ...(typeof slotIndexRequested === 'number' ? { ':slotIndexRequested': slotIndexRequested } : {}),
        },
        ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId)',
      }));
      return;
    }

    // Reset to REQUESTED for prior terminal states (LEFT/REJECTED/KICKED) or refresh existing REQUESTED.
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { sessionId, userId },
      UpdateExpression: [
        'SET #state = :state, requestedAt = :requestedAt, updatedAt = :updatedAt',
        'REMOVE guestSessionId, connectedAt, lastHeartbeatAt, disconnectedAt, slotIndex',
      ].join(' '),
      ExpressionAttributeNames: {
        '#state': 'state',
      },
      ExpressionAttributeValues: {
        ':state': 'REQUESTED',
        ':requestedAt': nowIso,
        ':updatedAt': nowIso,
      },
      ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId)',
    }));

    // Apply/refresh slot preference if provided.
    if (typeof slotIndexRequested === 'number') {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { sessionId, userId },
        UpdateExpression: 'set slotIndexRequested = :slotIndexRequested, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':slotIndexRequested': slotIndexRequested,
          ':updatedAt': nowIso,
        },
        ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId)',
      }));
    }
  }
}

export async function getGuest(sessionId: string, userId: string): Promise<GuestSlot | null> {
  const res = await docClient.send(new GetCommand({
    TableName: TABLE_NAME,
    Key: { sessionId, userId },
  }));
  return (res.Item as GuestSlot | undefined) || null;
}

export async function listGuestRequests(sessionId: string): Promise<GuestSlot[]> {
  const res = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'sessionId = :sessionId',
    ExpressionAttributeValues: {
      ':sessionId': sessionId,
    },
  }));

  const items = (res.Items as GuestSlot[] | undefined) || [];
  return items.filter((g) => g.state === 'REQUESTED');
}

export async function listGuests(sessionId: string): Promise<GuestSlot[]> {
  const res = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'sessionId = :sessionId',
    ExpressionAttributeValues: {
      ':sessionId': sessionId,
    },
  }));

  return ((res.Items as GuestSlot[] | undefined) || []).slice();
}

export async function updateGuestState(sessionId: string, userId: string, nextState: GuestState, nowIso: string): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId, userId },
    UpdateExpression: 'set #state = :state, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'state',
    },
    ExpressionAttributeValues: {
      ':state': nextState,
      ':updatedAt': nowIso,
    },
    ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId)',
  }));
}

export async function activateGuestSession(
  sessionId: string,
  userId: string,
  guestSessionId: string,
  nowIso: string,
): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId, userId },
    UpdateExpression: 'set #state = :state, guestSessionId = :guestSessionId, connectedAt = :connectedAt, lastHeartbeatAt = :lastHeartbeatAt, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'state',
    },
    ExpressionAttributeValues: {
      ':state': 'LIVE',
      ':guestSessionId': guestSessionId,
      ':connectedAt': nowIso,
      ':lastHeartbeatAt': nowIso,
      ':updatedAt': nowIso,
    },
    ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId)',
  }));
}

export async function heartbeatGuestSession(
  sessionId: string,
  userId: string,
  guestSessionId: string,
  nowIso: string,
): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId, userId },
    UpdateExpression: 'set lastHeartbeatAt = :lastHeartbeatAt, updatedAt = :updatedAt',
    ExpressionAttributeValues: {
      ':lastHeartbeatAt': nowIso,
      ':updatedAt': nowIso,
      ':guestSessionId': guestSessionId,
      ':expected': 'LIVE',
    },
    ExpressionAttributeNames: {
      '#state': 'state',
    },
    ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId) AND #state = :expected AND guestSessionId = :guestSessionId',
  }));
}

export async function leaveGuestSession(
  sessionId: string,
  userId: string,
  nowIso: string,
  opts?: { guestSessionId?: string; force?: boolean },
): Promise<void> {
  const force = opts?.force === true;
  const hasSessionId = typeof opts?.guestSessionId === 'string' && opts.guestSessionId.length > 0;

  const exprNames: Record<string, string> = { '#state': 'state' };
  const exprValues: Record<string, any> = {
    ':state': 'LEFT',
    ':updatedAt': nowIso,
  };

  let condition = 'attribute_exists(sessionId) AND attribute_exists(userId)';
  if (!force && hasSessionId) {
    exprValues[':guestSessionId'] = opts.guestSessionId;
    condition += ' AND guestSessionId = :guestSessionId';
  }

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId, userId },
    UpdateExpression: 'SET #state = :state, disconnectedAt = :updatedAt, updatedAt = :updatedAt REMOVE guestSessionId',
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprValues,
    ConditionExpression: condition,
  }));
}

export async function inviteGuest(
  sessionId: string,
  userId: string,
  slotIndex: number,
  nowIso: string
): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId, userId },
    UpdateExpression: 'set #state = :state, slotIndex = :slotIndex, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'state',
    },
    ExpressionAttributeValues: {
      ':state': 'INVITED',
      ':slotIndex': slotIndex,
      ':updatedAt': nowIso,
      ':expected': 'REQUESTED',
    },
    ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId) AND #state = :expected',
  }));
}

export async function rejectGuest(sessionId: string, userId: string, nowIso: string): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { sessionId, userId },
    UpdateExpression: 'set #state = :state, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#state': 'state',
    },
    ExpressionAttributeValues: {
      ':state': 'REJECTED',
      ':updatedAt': nowIso,
      ':expected': 'REQUESTED',
    },
    ConditionExpression: 'attribute_exists(sessionId) AND attribute_exists(userId) AND #state = :expected',
  }));
}
