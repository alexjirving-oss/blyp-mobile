// roomsService — orchestrates hostless group video rooms on top of IVS.
//
// This is the N-participant, no-host generalisation of the battle co-host
// pattern in liveService.ts (startBattleStage / joinBattleStage): every joiner
// who claims an open seat is pre-authorised to PUBLISH on ONE shared stage with
// no request/approve handshake. Capacity is enforced authoritatively here via a
// Firestore transaction (roomsStore.claimSlot) BEFORE a publish token is minted.

import { v4 as uuidv4 } from 'uuid';
import { CreateParticipantTokenCommand, CreateStageCommand } from '@aws-sdk/client-ivs-realtime';
import { ivsRealtimeClient } from '../aws/ivsRealtimeClient';
import { buildSafeStageName } from '../services/ivsStageName';
import { createSession } from './liveSessionStore';
import {
  ensureSeedRooms,
  listActiveRooms,
  getRoom,
  acquireStageProvisioningLock,
  setRoomStage,
  clearStageProvisioningLock,
  claimSlot,
  addViewer,
  releaseSlot,
  heartbeat as heartbeatStore,
  sweepStaleParticipants,
  type RoomDoc,
} from './roomsStore';
import { logger } from '../config/logger';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function publicRoom(room: RoomDoc) {
  const occupied = room.occupiedSlots || {};
  const publisherCount = typeof room.publisherCount === 'number' ? room.publisherCount : Object.keys(occupied).length;
  const capacity = room.capacity || 0;
  return {
    roomId: room.roomId,
    topicId: room.topicId,
    topicLabel: room.topicLabel,
    title: room.title,
    capacity,
    publisherCount,
    isFull: capacity > 0 && publisherCount >= capacity,
    isActive: !!room.isActive,
    hasStage: !!room.stageArn,
  };
}

export async function listRooms() {
  await ensureSeedRooms();
  const rooms = await listActiveRooms();
  return rooms.map(publicRoom);
}

/**
 * Ensure the room has a live IVS real-time stage, creating one lazily on first
 * publisher. Uses a short provisioning lock so concurrent first-joiners don't
 * each create a duplicate stage.
 */
export async function ensureRoomStage(roomId: string): Promise<{ stageArn: string; sessionId: string }> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const lock = await acquireStageProvisioningLock(roomId);

    if (lock.action === 'have') {
      return { stageArn: lock.stageArn, sessionId: lock.sessionId };
    }

    if (lock.action === 'wait') {
      await sleep(1200);
      continue;
    }

    // action === 'create' — we hold the lock; provision the stage.
    try {
      const sessionId = uuidv4();
      const appPrefix = process.env.IVS_STAGE_PREFIX ?? 'blyp-dev';
      const safeStageName = buildSafeStageName({ appPrefix, userId: roomId, rawTitle: `room-${roomId}`, sessionId });

      const stageRes = await ivsRealtimeClient.send(new CreateStageCommand({ name: safeStageName }));
      const stageArn = stageRes.stage?.arn;
      if (!stageArn) throw new Error('Failed to create IVS stage for room');

      // Mirror a lightweight session record so existing live tooling can resolve it.
      await createSession({
        sessionId,
        hostUserId: `room:${roomId}`,
        stageArn,
        title: `room:${roomId}`,
        status: 'LIVE',
        createdAt: new Date().toISOString(),
      }).catch((e) => logger.warn({ err: e?.message, roomId }, '[rooms] session mirror failed (non-fatal)'));

      await setRoomStage(roomId, stageArn, sessionId);
      logger.info({ roomId, stageArn, sessionId }, '[rooms] stage provisioned');
      return { stageArn, sessionId };
    } catch (err: any) {
      await clearStageProvisioningLock(roomId);
      logger.error({ err: err?.message, roomId }, '[rooms] stage provisioning failed');
      throw err;
    }
  }
  const err: any = new Error('Timed out waiting for room stage to provision');
  err.code = 'ROOM_STAGE_TIMEOUT';
  throw err;
}

async function mintToken(
  stageArn: string,
  userId: string,
  capabilities: Array<'PUBLISH' | 'SUBSCRIBE'>,
  attributes: Record<string, string>,
): Promise<string> {
  const tokenRes = await ivsRealtimeClient.send(new CreateParticipantTokenCommand({
    stageArn,
    userId,
    capabilities,
    attributes,
    duration: 60,
  }));
  const token = tokenRes.participantToken?.token;
  if (!token) throw new Error('Failed to mint participant token');
  return token;
}

export interface JoinPublisherResult {
  token: string;
  stageArn: string;
  sessionId: string;
  roomId: string;
  slotIndex: number;
  role: 'participant';
}

/**
 * Join a room as a PUBLISHER, claiming an open seat. Server enforces capacity:
 * if the room is full this throws { code: 'ROOM_FULL' } and the client should
 * fall back to viewer mode.
 */
export async function joinRoomAsPublisher(
  roomId: string,
  userId: string,
  displayName?: string,
): Promise<JoinPublisherResult> {
  const room = await getRoom(roomId);
  if (!room || !room.isActive) {
    const err: any = new Error('Room not found or inactive');
    err.code = 'ROOM_NOT_FOUND';
    throw err;
  }

  // Reclaim seats from dead clients first so capacity reflects reality.
  await sweepStaleParticipants(roomId).catch(() => {});

  const { stageArn, sessionId } = await ensureRoomStage(roomId);

  // Authoritative seat claim (transaction). Throws ROOM_FULL when no seat free.
  const { slotIndex } = await claimSlot(roomId, userId, displayName);

  const token = await mintToken(stageArn, userId, ['PUBLISH', 'SUBSCRIBE'], {
    role: 'participant',
    roomId,
    sessionId,
    slotIndex: String(slotIndex),
  });

  return { token, stageArn, sessionId, roomId, slotIndex, role: 'participant' };
}

export interface JoinViewerResult {
  token: string;
  stageArn: string;
  sessionId: string;
  roomId: string;
  role: 'viewer';
}

/** Join a room as a SUBSCRIBE-only viewer (room full, or just watching). */
export async function joinRoomAsViewer(
  roomId: string,
  userId: string,
  displayName?: string,
): Promise<JoinViewerResult> {
  const room = await getRoom(roomId);
  if (!room || !room.isActive) {
    const err: any = new Error('Room not found or inactive');
    err.code = 'ROOM_NOT_FOUND';
    throw err;
  }

  const { stageArn, sessionId } = await ensureRoomStage(roomId);
  await addViewer(roomId, userId, displayName).catch(() => {});

  const token = await mintToken(stageArn, userId, ['SUBSCRIBE'], {
    role: 'viewer',
    roomId,
    sessionId,
  });

  return { token, stageArn, sessionId, roomId, role: 'viewer' };
}

export async function leaveRoom(roomId: string, userId: string): Promise<void> {
  await releaseSlot(roomId, userId);
}

export async function heartbeatRoom(roomId: string, userId: string): Promise<void> {
  await heartbeatStore(roomId, userId);
}

export async function sweepRoom(roomId: string): Promise<number> {
  return sweepStaleParticipants(roomId);
}
