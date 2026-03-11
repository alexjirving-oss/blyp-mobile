import { v4 as uuidv4 } from 'uuid';
import { CreateParticipantTokenCommand, CreateStageCommand } from '@aws-sdk/client-ivs-realtime';
import { ivsRealtimeClient } from '../aws/ivsRealtimeClient';
import { LiveSession, LiveStatus, createSession, getSessionById, updateSessionStatus } from './liveSessionStore';
import {
  requestGuestSlot as requestGuestSlotStore,
  updateGuestState,
  activateGuestSession,
  heartbeatGuestSession,
  leaveGuestSession,
  listGuestRequests as listGuestRequestsStore,
  listGuests as listGuestsStore,
  getGuest as getGuestStore,
  inviteGuest as inviteGuestStore,
  rejectGuest as rejectGuestStore,
} from './guestSlotStore';
import { buildSafeStageName } from '../services/ivsStageName';

function nowIso(): string {
  return new Date().toISOString();
}

const GUEST_HEARTBEAT_TTL_MS = Number(process.env.GUEST_HEARTBEAT_TTL_MS) || 45_000;

function isoToMs(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function isGuestStale(g: any): boolean {
  if (!g) return true;
  if (g.state !== 'LIVE') return false;
  const last = isoToMs(g.lastHeartbeatAt);
  if (!last) return true;
  return Date.now() - last > GUEST_HEARTBEAT_TTL_MS;
}

function pickSlotIndex(used: Set<number>, preferred?: number): number {
  const MIN = 1;
  const MAX = 16;
  if (typeof preferred === 'number' && preferred >= MIN && preferred <= MAX && !used.has(preferred)) {
    return preferred;
  }
  for (let i = MIN; i <= MAX; i++) {
    if (!used.has(i)) return i;
  }
  // Fallback (should never happen in normal use)
  return MIN;
}

type StartLiveSessionError = Error & {
  code?: string;
  stageName?: string;
  statusCode?: number;
  originalMessage?: string;
  $metadata?: { httpStatusCode?: number };
};

export async function startLiveSession(hostUserId: string, title: string): Promise<{ session: LiveSession; hostToken: string; }> {
  const sessionId = uuidv4();
  const appPrefix = process.env.IVS_STAGE_PREFIX ?? 'blyp-dev';
  const safeStageName = buildSafeStageName({
    appPrefix,
    userId: hostUserId,
    rawTitle: title,
    sessionId,
  });

  console.log('[IVS][CREATE_STAGE] Using name:', safeStageName);

  let stageArn: string | undefined;

  try {
    // 1. Create stage
    const stageRes = await ivsRealtimeClient.send(new CreateStageCommand({
      name: safeStageName,
    }));

    stageArn = stageRes.stage?.arn;
    if (!stageArn) {
      throw new Error('Failed to create IVS stage');
    }
  } catch (err: any) {
    const startErr = err as StartLiveSessionError;
    console.error('[IVS][CREATE_STAGE_ERROR]', {
      name: startErr?.name,
      message: startErr?.message,
      statusCode: startErr?.$metadata?.httpStatusCode ?? startErr?.statusCode,
      stageName: safeStageName,
    });

    const wrapped: StartLiveSessionError = new Error('IVS_CREATE_STAGE_FAILED');
    wrapped.code = 'IVS_CREATE_STAGE_FAILED';
    wrapped.stageName = safeStageName;
    wrapped.statusCode = startErr?.$metadata?.httpStatusCode ?? startErr?.statusCode;
    wrapped.originalMessage = startErr?.message;
    throw wrapped;
  }

  const createdAt = nowIso();

  const session: LiveSession = {
    sessionId,
    hostUserId,
    stageArn,
    title,
    status: 'LIVE',
    createdAt,
  };

  // 2. Persist session
  await createSession(session);

  // 3. Create host token
  const tokenRes = await ivsRealtimeClient.send(new CreateParticipantTokenCommand({
    stageArn,
    userId: hostUserId,
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    attributes: { role: 'host', sessionId, title },
    duration: 60, // minutes
  }));

  const hostToken = tokenRes.participantToken?.token;
  if (!hostToken) {
    throw new Error('Failed to create host participant token');
  }

  return { session, hostToken };
}

export async function createViewerToken(sessionId: string, viewerUserId: string): Promise<{ token: string; stageArn: string; }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  const tokenRes = await ivsRealtimeClient.send(new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId: viewerUserId,
    capabilities: ['SUBSCRIBE'],
    attributes: { role: 'viewer', sessionId },
    duration: 60,
  }));

  const token = tokenRes.participantToken?.token;
  if (!token) {
    throw new Error('Failed to create viewer participant token');
  }

  return { token, stageArn: session.stageArn };
}

export async function createGuestToken(sessionId: string, guestUserId: string, guestSessionId?: string): Promise<{ token: string; stageArn: string; }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  // Enforce host approval: guest must be INVITED before we mint a publisher token.
  const record = await getGuestStore(sessionId, guestUserId);
  if (!record) {
    const err: any = new Error('Guest request not found');
    err.code = 'GUEST_REQUEST_NOT_FOUND';
    throw err;
  }

  if (record.state === 'REJECTED') {
    const err: any = new Error('Guest request rejected');
    err.code = 'GUEST_REQUEST_REJECTED';
    throw err;
  }

  if (record.state !== 'INVITED' && record.state !== 'LIVE') {
    const err: any = new Error('Guest not invited');
    err.code = 'GUEST_NOT_INVITED';
    throw err;
  }

  const desiredSessionId = (guestSessionId && String(guestSessionId)) || uuidv4();

  // If an active guest session exists and is still heartbeating, reject parallel rejoin.
  if (record.state === 'LIVE' && record.guestSessionId && record.guestSessionId !== desiredSessionId && !isGuestStale(record)) {
    const err: any = new Error('Guest session already active');
    err.code = 'GUEST_SESSION_ACTIVE';
    throw err;
  }

  const tokenRes = await ivsRealtimeClient.send(new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId: guestUserId,
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    attributes: { role: 'guest', sessionId },
    duration: 60,
  }));

  const token = tokenRes.participantToken?.token;
  if (!token) {
    throw new Error('Failed to create guest participant token');
  }

  // Transition to LIVE only after token issuance succeeds.
  // Also sets/refreshes guestSessionId + heartbeat timestamps for stale-slot recovery.
  await activateGuestSession(sessionId, guestUserId, desiredSessionId, nowIso());

  return { token, stageArn: session.stageArn };
}

export async function heartbeatGuest(sessionId: string, guestUserId: string, guestSessionId: string): Promise<void> {
  await heartbeatGuestSession(sessionId, guestUserId, guestSessionId, nowIso());
}

export async function leaveGuest(sessionId: string, guestUserId: string, opts?: { guestSessionId?: string; force?: boolean }): Promise<void> {
  await leaveGuestSession(sessionId, guestUserId, nowIso(), opts);
}

export async function requestGuestSlot(sessionId: string, guestUserId: string, slotIndexRequested?: number): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  // Create the guest request record. This is required before guest-token can transition to LIVE.
  await requestGuestSlotStore(sessionId, guestUserId, nowIso(), slotIndexRequested);
}

export async function listGuestRequests(sessionId: string) {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }
  return listGuestRequestsStore(sessionId);
}

export async function getGuest(sessionId: string, guestUserId: string) {
  return getGuestStore(sessionId, guestUserId);
}

export async function inviteGuest(sessionId: string, guestUserId: string): Promise<{ slotIndex: number; stageArn: string }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  const allGuests = await listGuestsStore(sessionId);
  const used = new Set<number>();
  for (const g of allGuests) {
    const active = g.state === 'INVITED' || (g.state === 'LIVE' && !isGuestStale(g));
    if (active && typeof g.slotIndex === 'number') used.add(g.slotIndex);
  }

  const record = await getGuestStore(sessionId, guestUserId);
  const preferred = typeof record?.slotIndexRequested === 'number' ? record.slotIndexRequested : undefined;
  const slotIndex = pickSlotIndex(used, preferred);

  await inviteGuestStore(sessionId, guestUserId, slotIndex, nowIso());
  return { slotIndex, stageArn: session.stageArn };
}

export async function rejectGuest(sessionId: string, guestUserId: string): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }
  await rejectGuestStore(sessionId, guestUserId, nowIso());
}

export async function joinLiveRealtime(
  sessionId: string,
  viewerUserId: string,
  displayName?: string
): Promise<{ token: string; stageArn: string; sessionId: string; userId: string; role: string }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  const tokenRes = await ivsRealtimeClient.send(new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId: viewerUserId,
    capabilities: ['SUBSCRIBE'],
    attributes: { role: 'viewer', sessionId, displayName: displayName || viewerUserId },
    duration: 60,
  }));

  const token = tokenRes.participantToken?.token;
  if (!token) {
    throw new Error('Failed to create viewer participant token');
  }

  return {
    token,
    stageArn: session.stageArn,
    sessionId,
    userId: viewerUserId,
    role: 'viewer',
  };
}

export async function endLiveSession(sessionId: string): Promise<void> {
  const endedAt = nowIso();
  await updateSessionStatus(sessionId, 'ENDED', endedAt);
}
