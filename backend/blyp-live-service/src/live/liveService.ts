import { v4 as uuidv4 } from 'uuid';
import { CreateParticipantTokenCommand, CreateStageCommand, DeleteStageCommand } from '@aws-sdk/client-ivs-realtime';
import { CreateChannelCommand, DeleteChannelCommand } from '@aws-sdk/client-ivs';
import {
  getIvsRealtimeClient,
  getRegionFromStageArn,
  resolveStageRegion,
  DEFAULT_IVS_REALTIME_REGION,
} from '../aws/ivsRealtimeClient';
import { getIvsLowLatencyClient } from '../aws/ivsLowLatencyClient';
import {
  LiveSession,
  LiveStatus,
  createSession,
  getSessionById,
  updateSessionStatus,
  addModerator as addModeratorStore,
  removeModerator as removeModeratorStore,
  sessionHasModerator,
} from './liveSessionStore';
import {
  requestGuestSlot as requestGuestSlotStore,
  updateGuestState,
  activateGuestSession,
  heartbeatGuestSession,
  leaveGuestSession,
  setGuestMuted,
  setGuestCameraOff,
  listGuestRequests as listGuestRequestsStore,
  listGuests as listGuestsStore,
  getGuest as getGuestStore,
  inviteGuest as inviteGuestStore,
  hostInviteGuest as hostInviteGuestStore,
  rejectGuest as rejectGuestStore,
} from './guestSlotStore';
import { buildSafeStageName } from '../services/ivsStageName';
import { emitRoomEvent } from '../realtime/realtimeBus';
import { getStreamPlaybackForViewer, enqueueGuestInviteNotification } from '../admin/firestoreAdmin';
import {
  MAX_GUEST_SLOTS,
  collectUsedGuestSlots,
  pickSlotIndex,
} from './guestSlotAllocator';
import { safeLiveDisplayName } from './liveDisplayName';
import {
  markBattleParticipantJoined,
  requireBattlePublisher,
} from '../battles/battleCoordinator';
import { attachBattleStage } from '../battles/battleRegistryService';
import { battleTokenAttributes } from '../battles/battleLifecycle';
import { endDuel } from '../games/reactionDuel/reactionDuelRoomService';
import { settleReactionDuelLiveCoins } from '../games/reactionDuel/reactionDuelEconomy';
import { stopCompositionBestEffort } from './programEgress';

function nowIso(): string {
  return new Date().toISOString();
}

/** Coded authorization error so routes can map to HTTP 403. */
function forbidden(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'FORBIDDEN';
  return err;
}

/** Coded error for when the on-stage publisher panel is full (host + 11 guests). */
function panelFull(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'PANEL_FULL';
  return err;
}

/** Host cannot occupy a guest box on their own stage (maps to HTTP 400). */
function hostCannotBeGuest(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'HOST_CANNOT_BE_GUEST';
  return err;
}

/**
 * Load a LIVE session and assert the caller is its host. Used to gate host-only
 * actions (end, guest invite/reject/kick, listing pending guests) so that any
 * authenticated user can no longer control a stream they don't own. Returns the
 * session so callers can reuse it without a second fetch.
 */
export async function assertSessionHost(sessionId: string, requesterUserId: string): Promise<LiveSession> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw new Error('Live session not found');
  }
  if (!requesterUserId || session.hostUserId !== requesterUserId) {
    throw forbidden('Only the host can perform this action');
  }
  return session;
}

/**
 * Assert the caller is the host OR an appointed moderator of the session. Used
 * to gate moderation actions (mute/kick) that the host can delegate. Host-only
 * actions (invite, end, manage moderators) still use assertSessionHost.
 */
export async function assertHostOrModerator(sessionId: string, requesterUserId: string): Promise<LiveSession> {
  const session = await getSessionById(sessionId);
  if (!session) {
    throw new Error('Live session not found');
  }
  if (!requesterUserId) {
    throw forbidden('Only the host or a moderator can perform this action');
  }
  if (session.hostUserId === requesterUserId) return session;
  if (sessionHasModerator(session, requesterUserId)) return session;
  throw forbidden('Only the host or a moderator can perform this action');
}

/** Host-only: appoint a moderator who can then mute/kick guests. */
export async function addModerator(sessionId: string, requesterUserId: string, moderatorUserId: string): Promise<void> {
  await assertSessionHost(sessionId, requesterUserId);
  await addModeratorStore(sessionId, moderatorUserId);
  emitRoomEvent(sessionId, { type: 'moderator.added', moderatorUserId });
}

/** Host-only: revoke a moderator. */
export async function removeModerator(sessionId: string, requesterUserId: string, moderatorUserId: string): Promise<void> {
  await assertSessionHost(sessionId, requesterUserId);
  await removeModeratorStore(sessionId, moderatorUserId);
  emitRoomEvent(sessionId, { type: 'moderator.removed', moderatorUserId });
}

const GUEST_HEARTBEAT_TTL_MS = Number(process.env.GUEST_HEARTBEAT_TTL_MS) || 45_000;
/** INVITED slots expire so ignored invites cannot hold a box forever. */
const INVITED_TTL_MS = Number(process.env.GUEST_INVITED_TTL_MS) || 45_000;

function isoToMs(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function isGuestStale(g: any): boolean {
  if (!g) return true;
  if (g.state === 'INVITED') {
    const invitedAt = isoToMs(g.invitedAt || g.updatedAt || g.requestedAt);
    if (!invitedAt) return true;
    return Date.now() - invitedAt > INVITED_TTL_MS;
  }
  if (g.state !== 'LIVE') return false;
  const last = isoToMs(g.lastHeartbeatAt);
  if (!last) return true;
  return Date.now() - last > GUEST_HEARTBEAT_TTL_MS;
}

/** Clear expired INVITED holds and re-queue for Frenemies when applicable. */
async function expireStaleInvites(sessionId: string, guests: any[]): Promise<any[]> {
  const kept: any[] = [];
  for (const g of guests || []) {
    if (!g || g.state !== 'INVITED' || !isGuestStale(g)) {
      kept.push(g);
      continue;
    }
    try {
      await leaveGuestSession(sessionId, g.userId, nowIso(), { force: true });
      emitRoomEvent(sessionId, {
        type: 'guest.rejected',
        guestUserId: g.userId,
        reason: 'invite_expired',
      } as any);
      try {
        const { requestJoinQueue } = await import('../games/frenemies/frenemiesRoomService');
        await requestJoinQueue({
          sessionId,
          userId: g.userId,
          displayName: 'Guest',
          source: 'cta',
        });
      } catch {
        /* Frenemies inactive */
      }
    } catch {
      kept.push(g);
    }
  }
  return kept;
}

type StartLiveSessionError = Error & {
  code?: string;
  stageName?: string;
  statusCode?: number;
  originalMessage?: string;
  $metadata?: { httpStatusCode?: number };
};

/**
 * Create a stage in the host's preferred region, falling back to the default
 * region if that region rejects the request (e.g. IAM not scoped there). This
 * guarantees go-live availability never regresses while still letting nearby
 * hosts (e.g. US) publish to a nearby media server. Returns the ARN (whose
 * region every later participant token is derived from).
 */
async function createStageInRegion(safeStageName: string, preferredRegion: string): Promise<string> {
  const tryCreate = async (region: string): Promise<string | undefined> => {
    const client = getIvsRealtimeClient(region);
    const stageRes = await client.send(new CreateStageCommand({ name: safeStageName }));
    return stageRes.stage?.arn;
  };

  try {
    const arn = await tryCreate(preferredRegion);
    if (!arn) throw new Error('Failed to create IVS stage');
    console.log('[IVS][CREATE_STAGE_OK]', { region: preferredRegion, stageName: safeStageName });
    return arn;
  } catch (err: any) {
    const startErr = err as StartLiveSessionError;
    console.error('[IVS][CREATE_STAGE_ERROR]', {
      name: startErr?.name,
      message: startErr?.message,
      statusCode: startErr?.$metadata?.httpStatusCode ?? startErr?.statusCode,
      stageName: safeStageName,
      region: preferredRegion,
    });

    // If the preferred region wasn't the default, retry once in the default
    // region so a regional outage/permission gap can't block going live.
    if (preferredRegion.toLowerCase() !== DEFAULT_IVS_REALTIME_REGION.toLowerCase()) {
      try {
        const arn = await tryCreate(DEFAULT_IVS_REALTIME_REGION);
        if (arn) {
          console.warn('[IVS][CREATE_STAGE_FALLBACK_OK]', {
            from: preferredRegion,
            to: DEFAULT_IVS_REALTIME_REGION,
            stageName: safeStageName,
          });
          return arn;
        }
      } catch (fallbackErr: any) {
        console.error('[IVS][CREATE_STAGE_FALLBACK_ERROR]', {
          to: DEFAULT_IVS_REALTIME_REGION,
          message: fallbackErr?.message,
        });
      }
    }

    const wrapped: StartLiveSessionError = new Error('IVS_CREATE_STAGE_FAILED');
    wrapped.code = 'IVS_CREATE_STAGE_FAILED';
    wrapped.stageName = safeStageName;
    wrapped.statusCode = startErr?.$metadata?.httpStatusCode ?? startErr?.statusCode;
    wrapped.originalMessage = startErr?.message;
    throw wrapped;
  }
}

export async function startLiveSession(hostUserId: string, title: string, regionHint?: string): Promise<{ session: LiveSession; hostToken: string; }> {
  const sessionId = uuidv4();
  const appPrefix = process.env.IVS_STAGE_PREFIX ?? 'blyp-dev';
  const safeStageName = buildSafeStageName({
    appPrefix,
    userId: hostUserId,
    rawTitle: title,
    sessionId,
  });

  const region = resolveStageRegion(regionHint);
  console.log('[IVS][CREATE_STAGE] Using name:', safeStageName, 'region:', region, 'hint:', regionHint || '(none)');

  // 1. Create stage in the host's nearest allowed region (with default fallback).
  const stageArn = await createStageInRegion(safeStageName, region);
  const stageRegion = getRegionFromStageArn(stageArn);
  const client = getIvsRealtimeClient(stageRegion);
  const ll = getIvsLowLatencyClient(stageRegion);

  const failProgram = async (channelArn?: string) => {
    if (channelArn) {
      try {
        await ll.send(new DeleteChannelCommand({ arn: channelArn }));
      } catch (e: any) {
        console.warn('[IVS][DELETE_CHANNEL_ROLLBACK_FAIL]', { sessionId, message: e?.message || String(e) });
      }
    }
    try {
      await client.send(new DeleteStageCommand({ arn: stageArn }));
    } catch (e: any) {
      console.warn('[IVS][DELETE_STAGE_ROLLBACK_FAIL]', { sessionId, message: e?.message || String(e) });
    }
    const wrapped: StartLiveSessionError = new Error('IVS_CREATE_PROGRAM_FAILED');
    wrapped.code = 'IVS_CREATE_PROGRAM_FAILED';
    wrapped.stageName = safeStageName;
    throw wrapped;
  };

  let channelArn = '';
  let playbackUrl = '';
  try {
    const created = await ll.send(new CreateChannelCommand({
      name: `blyp-prog-${sessionId}`,
      latencyMode: 'LOW',
      type: 'ADVANCED_HD',
      authorized: false,
    }));
    channelArn = String(created.channel?.arn || '');
    playbackUrl = String(created.channel?.playbackUrl || '');
  } catch (e: any) {
    console.error('[IVS][CREATE_CHANNEL_FAILED]', { sessionId, message: e?.message || String(e) });
    await failProgram();
    throw new Error('IVS_CREATE_PROGRAM_FAILED');
  }
  if (!channelArn || !playbackUrl) {
    await failProgram(channelArn || undefined);
  }

  const createdAt = nowIso();

  const session: LiveSession = {
    sessionId,
    hostUserId,
    stageArn,
    region: stageRegion,
    title,
    status: 'LIVE',
    createdAt,
    channelArn,
    playbackUrl,
    compositionState: 'UNKNOWN',
  };

  await createSession(session);

  const tokenRes = await client.send(new CreateParticipantTokenCommand({
    stageArn,
    userId: hostUserId,
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    attributes: {
      role: 'host',
      slotIndex: '0',
      featured: 'true',
      sessionId,
      title: String(title || '').slice(0, 80),
    },
    duration: 60,
  }));

  const hostToken = tokenRes.participantToken?.token;
  if (!hostToken) {
    throw new Error('Failed to create host participant token');
  }

  // 4. Server-authoritative discovery card. Publish ONLY after Dynamo LIVE exists
  // so viewers never see a joinable card for a missing session. Also retire any
  // prior status=live cards for this host (stale ghosts / crashed ends).
  try {
    const { publishFirestoreLiveDirectory, endPriorLiveDirectoryForHost } = await import(
      '../admin/firestoreAdmin'
    );
    const prior = await endPriorLiveDirectoryForHost(hostUserId, sessionId);
    const published = await publishFirestoreLiveDirectory({
      streamId: sessionId,
      hostUserId,
      title,
      playbackUrl,
    });
    console.log('[LIVE][DIRECTORY_PUBLISH]', {
      sessionId,
      hostUserId,
      priorEnded: prior.ended,
      published: published.ok,
      detail: published.detail,
    });
  } catch (fsErr: any) {
    console.warn('[LIVE][DIRECTORY_PUBLISH_FAIL]', {
      sessionId,
      hostUserId,
      message: fsErr?.message || String(fsErr),
    });
  }

  return { session, hostToken };
}

export async function createViewerToken(sessionId: string, viewerUserId: string): Promise<{ token: string; stageArn: string; }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  const client = getIvsRealtimeClient(getRegionFromStageArn(session.stageArn));
  const tokenRes = await client.send(new CreateParticipantTokenCommand({
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

  // Embed the host-assigned slot in the token attributes. IVS makes these
  // attributes visible to EVERY participant (host + all viewers) on the remote
  // ParticipantInfo, so every device can route this guest's video to the SAME
  // box. Without it, native assigns slots by join order, which diverges between
  // host and viewers and lands a second guest in the wrong tile.
  const guestAttributes: Record<string, string> = { role: 'guest', sessionId };
  if (typeof record.slotIndex === 'number' && record.slotIndex >= 1) {
    guestAttributes.slotIndex = String(record.slotIndex);
  }
  const client = getIvsRealtimeClient(getRegionFromStageArn(session.stageArn));
  const tokenRes = await client.send(new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId: guestUserId,
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    attributes: guestAttributes,
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
  const prior = await getGuestStore(sessionId, guestUserId);
  await leaveGuestSession(sessionId, guestUserId, nowIso(), opts);
  emitRoomEvent(sessionId, { type: 'guest.left', guestUserId });
  // Declining / abandoning an INVITED seat must free the box and re-queue for Frenemies.
  if (prior?.state === 'INVITED') {
    emitRoomEvent(sessionId, {
      type: 'guest.rejected',
      guestUserId,
      reason: 'invite_declined',
    } as any);
    try {
      const { requestJoinQueue } = await import('../games/frenemies/frenemiesRoomService');
      await requestJoinQueue({
        sessionId,
        userId: guestUserId,
        displayName: 'Guest',
        source: 'cta',
      });
    } catch {
      /* Frenemies not active — slot free is enough */
    }
  }
}

export async function requestGuestSlot(sessionId: string, guestUserId: string, slotIndexRequested?: number): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }
  // Host is already the stage publisher — never create a guest REQUESTED row for them
  // (Studio was listing + Accepting that ghost row → invite 500).
  if (guestUserId === session.hostUserId) {
    throw hostCannotBeGuest('Host cannot request a guest slot on their own stream');
  }

  // Create the guest request record. This is required before guest-token can transition to LIVE.
  await requestGuestSlotStore(sessionId, guestUserId, nowIso(), slotIndexRequested);
}

export async function listGuestRequests(sessionId: string, requesterUserId?: string) {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }
  // Only the host may enumerate pending guest requests for their stream.
  if (requesterUserId && session.hostUserId !== requesterUserId) {
    throw forbidden('Only the host can list guest requests');
  }
  const rows = await listGuestRequestsStore(sessionId);
  // Never surface the host as a pending guest (legacy rows + self-request races).
  return rows.filter((r) => r.userId !== session.hostUserId);
}

export async function getGuest(sessionId: string, guestUserId: string) {
  return getGuestStore(sessionId, guestUserId);
}

export async function inviteGuest(sessionId: string, guestUserId: string, requesterUserId?: string): Promise<{ slotIndex: number; stageArn: string }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }
  // Only the host may approve (invite) a guest onto their stage.
  if (requesterUserId && session.hostUserId !== requesterUserId) {
    throw forbidden('Only the host can invite guests');
  }
  if (guestUserId === session.hostUserId) {
    throw hostCannotBeGuest('Host cannot be invited as a guest');
  }

  const allGuests = await expireStaleInvites(sessionId, await listGuestsStore(sessionId));
  const used = collectUsedGuestSlots(allGuests, {
    hostUserId: session.hostUserId,
    isStale: isGuestStale,
  });

  // Enforce the IVS 12-publisher hard cap (host + 11 guests). The guest being
  // invited is still REQUESTED here, so they are not yet counted in `used`.
  if (used.size >= MAX_GUEST_SLOTS) {
    throw panelFull(`Guest panel is full (max ${MAX_GUEST_SLOTS} guests)`);
  }

  const record = await getGuestStore(sessionId, guestUserId);

  // Idempotent re-accept: already INVITED → return existing slot (no Dynamo race 500).
  if (record?.state === 'INVITED' && typeof record.slotIndex === 'number' && record.slotIndex >= 1) {
    emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex: record.slotIndex });
    return { slotIndex: record.slotIndex, stageArn: session.stageArn };
  }

  // Active LIVE guest cannot be re-invited via approve path.
  if (record?.state === 'LIVE' && !isGuestStale(record)) {
    const err: any = new Error('Guest session already active');
    err.code = 'GUEST_SESSION_ACTIVE';
    throw err;
  }

  const preferred = typeof record?.slotIndexRequested === 'number' ? record.slotIndexRequested : undefined;
  const slotIndex = pickSlotIndex(used, preferred);
  const now = nowIso();

  // inviteGuestStore requires state=REQUESTED. Missing / terminal / stale-LIVE
  // used to throw ConditionalCheckFailedException → opaque HTTP 500. Fall through
  // to host-invite upsert (same seating outcome, durable record).
  const seatViaHostInvite = async (): Promise<{ slotIndex: number; stageArn: string } | null> => {
    try {
      await hostInviteGuestStore(sessionId, guestUserId, slotIndex, now);
      return null;
    } catch (err: any) {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
      const again = await getGuestStore(sessionId, guestUserId);
      if (again?.state === 'INVITED' && typeof again.slotIndex === 'number' && again.slotIndex >= 1) {
        emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex: again.slotIndex });
        return { slotIndex: again.slotIndex, stageArn: session.stageArn };
      }
      if (again?.state === 'LIVE' && !isGuestStale(again)) {
        const active: any = new Error('Guest session already active');
        active.code = 'GUEST_SESSION_ACTIVE';
        throw active;
      }
      // Stale LIVE / unexpected race: force-clear then upsert once.
      await leaveGuestSession(sessionId, guestUserId, now, { force: true });
      await hostInviteGuestStore(sessionId, guestUserId, slotIndex, now);
      return null;
    }
  };

  if (record?.state === 'REQUESTED') {
    try {
      await inviteGuestStore(sessionId, guestUserId, slotIndex, now);
    } catch (err: any) {
      if (err?.name !== 'ConditionalCheckFailedException') throw err;
      // Race: another accept won, or state flipped — upsert or return current.
      const again = await getGuestStore(sessionId, guestUserId);
      if (again?.state === 'INVITED' && typeof again.slotIndex === 'number' && again.slotIndex >= 1) {
        emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex: again.slotIndex });
        return { slotIndex: again.slotIndex, stageArn: session.stageArn };
      }
      const early = await seatViaHostInvite();
      if (early) return early;
    }
  } else {
    const early = await seatViaHostInvite();
    if (early) return early;
  }

  // Push the state change to connected clients in real time (additive to the
  // existing poll/Firestore-mirror path).
  emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex });
  return { slotIndex, stageArn: session.stageArn };
}

/**
 * Frenemies paid jump: seat the jumper on a freed box without invite-accept.
 * Puts them INVITED with preferred slot, then emits guest.invited { force:true }
 * so the client auto-publishes (pay ≠ decline).
 */
export async function forceSeatGuest(args: {
  sessionId: string;
  guestUserId: string;
  preferredSlot?: number;
  reason?: string;
}): Promise<{ slotIndex: number; stageArn: string }> {
  const session = await getSessionById(args.sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }
  if (args.guestUserId === session.hostUserId) {
    throw hostCannotBeGuest('Host cannot be seated as a guest');
  }

  try {
    await requestGuestSlot(args.sessionId, args.guestUserId, args.preferredSlot);
  } catch (e: any) {
    if (e?.code !== 'GUEST_SESSION_ACTIVE') {
      // continue — hostInvite path can upsert
    }
  }

  const allGuests = await expireStaleInvites(args.sessionId, await listGuestsStore(args.sessionId));
  const used = collectUsedGuestSlots(allGuests, {
    hostUserId: session.hostUserId,
    isStale: isGuestStale,
  });
  // Victim was already force-kicked; their slot should be free. If preferred is
  // still occupied (race), pickSlotIndex falls through to next free.
  if (used.size >= MAX_GUEST_SLOTS) {
    throw panelFull(`Guest panel is full (max ${MAX_GUEST_SLOTS} guests)`);
  }
  const preferred =
    typeof args.preferredSlot === 'number' && args.preferredSlot >= 1
      ? args.preferredSlot
      : undefined;
  const slotIndex = pickSlotIndex(used, preferred);

  await hostInviteGuestStore(args.sessionId, args.guestUserId, slotIndex, nowIso());
  emitRoomEvent(args.sessionId, {
    type: 'guest.invited',
    guestUserId: args.guestUserId,
    slotIndex,
    force: true,
    reason: args.reason || 'frenemies_jump',
  } as any);
  emitRoomEvent(args.sessionId, {
    type: 'frenemies.jump.seated',
    guestUserId: args.guestUserId,
    slotIndex,
  } as any);
  return { slotIndex, stageArn: session.stageArn };
}

/**
 * Host-initiated invite: the host picks a VIEWER (who never requested) and invites
 * them onto the stage. Creates the INVITED record + slot directly and pushes a
 * guest.invited event so the viewer's client can prompt them to accept.
 */
export async function hostInviteGuest(
  sessionId: string,
  requesterUserId: string,
  guestUserId: string
): Promise<{ slotIndex: number; stageArn: string }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }
  if (requesterUserId && session.hostUserId !== requesterUserId) {
    throw forbidden('Only the host can invite guests');
  }
  if (guestUserId === session.hostUserId) {
    throw hostCannotBeGuest('Host cannot invite themselves as a guest');
  }

  const allGuests = await expireStaleInvites(sessionId, await listGuestsStore(sessionId));
  const used = collectUsedGuestSlots(allGuests, {
    hostUserId: session.hostUserId,
    isStale: isGuestStale,
  });
  if (used.size >= MAX_GUEST_SLOTS) {
    throw panelFull(`Guest panel is full (max ${MAX_GUEST_SLOTS} guests)`);
  }

  const prior = await getGuestStore(sessionId, guestUserId);
  if (prior?.state === 'INVITED' && typeof prior.slotIndex === 'number' && prior.slotIndex >= 1) {
    emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex: prior.slotIndex });
    return { slotIndex: prior.slotIndex, stageArn: session.stageArn };
  }
  if (prior?.state === 'LIVE' && !isGuestStale(prior)) {
    const err: any = new Error('Guest session already active');
    err.code = 'GUEST_SESSION_ACTIVE';
    throw err;
  }

  const slotIndex = pickSlotIndex(used);
  const now = nowIso();
  try {
    await hostInviteGuestStore(sessionId, guestUserId, slotIndex, now);
  } catch (err: any) {
    if (err?.name !== 'ConditionalCheckFailedException') throw err;
    const again = await getGuestStore(sessionId, guestUserId);
    if (again?.state === 'INVITED' && typeof again.slotIndex === 'number' && again.slotIndex >= 1) {
      emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex: again.slotIndex });
      return { slotIndex: again.slotIndex, stageArn: session.stageArn };
    }
    if (again?.state === 'LIVE' && !isGuestStale(again)) {
      const active: any = new Error('Guest session already active');
      active.code = 'GUEST_SESSION_ACTIVE';
      throw active;
    }
    await leaveGuestSession(sessionId, guestUserId, now, { force: true });
    await hostInviteGuestStore(sessionId, guestUserId, slotIndex, now);
  }
  emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex });
  // Durable push/inbox ping so off-stream followers still get the invite.
  void enqueueGuestInviteNotification({
    guestUserId,
    hostUserId: session.hostUserId,
    sessionId,
  }).catch(() => {});
  return { slotIndex, stageArn: session.stageArn };
}

export async function rejectGuest(sessionId: string, guestUserId: string, requesterUserId?: string): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }
  // Only the host may reject a pending guest request.
  if (requesterUserId && session.hostUserId !== requesterUserId) {
    throw forbidden('Only the host can reject guests');
  }
  const prior = await getGuestStore(sessionId, guestUserId);
  try {
    await rejectGuestStore(sessionId, guestUserId, nowIso());
  } catch {
    // INVITED decline path may already be LEFT — force-clear slot.
    await leaveGuestSession(sessionId, guestUserId, nowIso(), { force: true });
  }
  emitRoomEvent(sessionId, { type: 'guest.rejected', guestUserId });
  if (prior?.state === 'INVITED' || prior?.state === 'REQUESTED') {
    try {
      const { requestJoinQueue } = await import('../games/frenemies/frenemiesRoomService');
      await requestJoinQueue({
        sessionId,
        userId: guestUserId,
        displayName: 'Guest',
        source: 'cta',
      });
    } catch {
      /* no frenemies game */
    }
  }
}

/**
 * Host-initiated removal of a guest from the stage. Forcibly clears the guest's
 * slot/session regardless of its current state. Host-only.
 */
export async function kickGuest(sessionId: string, requesterUserId: string, guestUserId: string): Promise<void> {
  await assertHostOrModerator(sessionId, requesterUserId);
  await leaveGuestSession(sessionId, guestUserId, nowIso(), { force: true });
  emitRoomEvent(sessionId, { type: 'guest.kicked', guestUserId });
}

/**
 * Host-only remote mute/unmute of a guest. Persists the authoritative
 * `mutedByHost` flag and pushes a signal so the guest's client mutes (and
 * disables self-unmute) in real time. Host-only via assertSessionHost.
 */
export async function muteGuest(
  sessionId: string,
  requesterUserId: string,
  guestUserId: string,
  muted: boolean
): Promise<void> {
  await assertHostOrModerator(sessionId, requesterUserId);
  await setGuestMuted(sessionId, guestUserId, muted, nowIso());
  emitRoomEvent(sessionId, { type: muted ? 'guest.muted' : 'guest.unmuted', guestUserId });
}

export async function setGuestCamera(
  sessionId: string,
  requesterUserId: string,
  guestUserId: string,
  cameraOff: boolean
): Promise<void> {
  await assertHostOrModerator(sessionId, requesterUserId);
  await setGuestCameraOff(sessionId, guestUserId, cameraOff, nowIso());
  emitRoomEvent(sessionId, { type: cameraOff ? 'guest.camera_off' : 'guest.camera_on', guestUserId });
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
  const publicDisplayName = safeLiveDisplayName(displayName, viewerUserId);

  const client = getIvsRealtimeClient(getRegionFromStageArn(session.stageArn));
  const tokenRes = await client.send(new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId: viewerUserId,
    capabilities: ['SUBSCRIBE'],
    attributes: { role: 'viewer', sessionId, displayName: publicDisplayName },
    duration: 60,
  }));

  const token = tokenRes.participantToken?.token;
  if (!token) {
    throw new Error('Failed to create viewer participant token');
  }

  // Announce the join so all clients can show an "X joined" chat line in real time.
  emitRoomEvent(sessionId, { type: 'viewer.joined', viewerUserId, displayName: publicDisplayName });

  return {
    token,
    stageArn: session.stageArn,
    sessionId,
    userId: viewerUserId,
    role: 'viewer',
  };
}

/**
 * Mass viewer join — Stage subscribe when the session has a stage.
 * HLS playbackUrl is the composition/RTMP copy; sending phones there is what
 * made Studio preview look fine while watchers stall-then-jumped.
 * App clients already fall back to joinLiveRealtime when mode !== playback.
 */
export async function joinLiveMass(
  sessionId: string,
  viewerUserId: string,
  displayName?: string,
): Promise<{ sessionId: string; playbackUrl?: string; mode: 'playback' | 'realtime' }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  emitRoomEvent(sessionId, {
    type: 'viewer.joined',
    viewerUserId,
    displayName: safeLiveDisplayName(displayName, viewerUserId),
  });

  if (session.stageArn) {
    return { sessionId, mode: 'realtime' };
  }

  const firestore = await getStreamPlaybackForViewer(sessionId);
  if (firestore.playbackUrl) {
    return { sessionId, playbackUrl: firestore.playbackUrl, mode: 'playback' };
  }

  return { sessionId, mode: 'realtime' };
}

// ---------------------------------------------------------------------------
// Battles — ONE shared stage, both participants are equal co-hosts.
//
// Unlike guest joins (request -> host approval -> publish), battle participants
// are pre-authorised: both creator and opponent get a PUBLISH token with no
// approval dance. Minting a publish token == that person turned up, so we record
// it as attendance for the escrow settlement.
// ---------------------------------------------------------------------------

export async function startBattleStage(
  creatorUserId: string,
  battleId: string,
  title: string,
  regionHint?: string
): Promise<{ session: LiveSession; hostToken: string; stageArn: string }> {
  const publisher = await requireBattlePublisher(battleId, creatorUserId);
  if (publisher.side !== 'A') {
    throw forbidden('Only side A can open the battle stage');
  }

  let battle = publisher.battle;
  let session: LiveSession | null = null;

  // Reconnects reuse the canonical stage instead of creating parallel rooms.
  if (battle.sessionId && battle.stageArn) {
    session = await getSessionById(battle.sessionId);
    if (!session || session.status !== 'LIVE' || session.stageArn !== battle.stageArn) {
      const err: any = new Error('Battle stage is no longer active');
      err.code = 'BATTLE_STAGE_INACTIVE';
      err.httpStatus = 409;
      throw err;
    }
  } else {
    const sessionId = uuidv4();
    const appPrefix = process.env.IVS_STAGE_PREFIX ?? 'blyp-dev';
    const safeStageName = buildSafeStageName({
      appPrefix,
      userId: creatorUserId,
      rawTitle: title || battle.title || 'battle',
      sessionId,
    });
    const region = resolveStageRegion(regionHint);
    const stageArn = await createStageInRegion(safeStageName, region);
    const createdSession: LiveSession = {
      sessionId,
      hostUserId: creatorUserId,
      stageArn,
      region: getRegionFromStageArn(stageArn),
      title: title || battle.title,
      status: 'LIVE',
      createdAt: nowIso(),
    };
    await createSession(createdSession);
    const attached = await attachBattleStage(battleId, creatorUserId, {
      sessionId,
      stageArn,
    });
    battle = attached.arena;
    if (!attached.attached && battle.sessionId !== sessionId) {
      // A concurrent retry won the registry race. Reap this orphan and use the
      // already-attached canonical room.
      try {
        await getIvsRealtimeClient(getRegionFromStageArn(stageArn)).send(
          new DeleteStageCommand({ arn: stageArn }),
        );
      } catch {
        // Best effort; the orphan can be swept operationally.
      }
      session = battle.sessionId ? await getSessionById(battle.sessionId) : null;
    } else {
      session = createdSession;
    }
  }

  if (!session || !battle.sessionId || !battle.stageArn) {
    throw new Error('Failed to attach canonical battle stage');
  }
  const client = getIvsRealtimeClient(getRegionFromStageArn(battle.stageArn));
  const tokenRes = await client.send(new CreateParticipantTokenCommand({
    stageArn: battle.stageArn,
    userId: creatorUserId,
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    attributes: battleTokenAttributes(
      'A',
      battleId,
      battle.sessionId,
      title || battle.title,
    ),
    duration: 60,
  }));
  const hostToken = tokenRes.participantToken?.token;
  if (!hostToken) throw new Error('Failed to create battle participant token');

  await markBattleParticipantJoined(battleId, creatorUserId);

  return { session, hostToken, stageArn: battle.stageArn };
}

export async function joinBattleStage(
  userId: string,
  sessionId: string,
  battleId: string
): Promise<{ token: string; stageArn: string; sessionId: string; role: string }> {
  const publisher = await requireBattlePublisher(battleId, userId);
  if (publisher.side !== 'B') {
    throw forbidden('Side A opens the battle stage through the start route');
  }
  const battle = publisher.battle;
  if (!battle.sessionId || !battle.stageArn) {
    const err: any = new Error('Battle stage not ready');
    err.code = 'BATTLE_STAGE_NOT_READY';
    err.httpStatus = 409;
    throw err;
  }
  if (sessionId && sessionId !== battle.sessionId) {
    const err: any = new Error('Battle session does not match the registry');
    err.code = 'BATTLE_SESSION_MISMATCH';
    err.httpStatus = 409;
    throw err;
  }
  const session = await getSessionById(battle.sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  const client = getIvsRealtimeClient(getRegionFromStageArn(session.stageArn));
  const tokenRes = await client.send(new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId,
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    attributes: battleTokenAttributes('B', battleId, battle.sessionId),
    duration: 60,
  }));
  const token = tokenRes.participantToken?.token;
  if (!token) throw new Error('Failed to create battle participant token');

  await markBattleParticipantJoined(battleId, userId);

  return {
    token,
    stageArn: session.stageArn,
    sessionId: battle.sessionId,
    role: 'battle',
  };
}

export async function endLiveSession(sessionId: string): Promise<void> {
  const endedAt = nowIso();

  // Fetch first so we know which stage to reap (and its region) before the
  // status flips. The session record itself is retained (status -> ENDED) for
  // history/analytics; only the IVS stage resource is deleted.
  const session = await getSessionById(sessionId);

  // Close/refund any in-progress duel first. Legacy PENDING prizes (pre-v2)
  // may still convert 1:1 to GEM; v2 awards already credited coin_balance and
  // are skipped inside settleReactionDuelLiveCoins (no double GEM).
  await endDuel({
    sessionId,
    userId: session?.hostUserId || 'system:live-end',
    isAdmin: true,
  });
  const duelSettlement = await settleReactionDuelLiveCoins({ sessionId });
  if (duelSettlement.prizesConverted > 0) {
    console.log('[REACTION_DUEL][LIVE_END_SETTLED]', {
      sessionId,
      prizesConverted: duelSettlement.prizesConverted,
      coinsConverted: duelSettlement.coinsConverted,
      gemsCredited: duelSettlement.gemsCredited,
      gemStatus: duelSettlement.gemStatus,
    });
  }

  await updateSessionStatus(sessionId, 'ENDED', endedAt);
  emitRoomEvent(sessionId, { type: 'room.ended' });

  try {
    const { broadcastStopForSession } = await import('./broadcastPrepare');
    await broadcastStopForSession(sessionId);
  } catch (broadcastErr: any) {
    console.warn('[LIVE][BROADCAST_STOP_FAIL]', {
      sessionId,
      message: broadcastErr?.message || String(broadcastErr),
    });
  }

  try {
    const { endFirestoreStream } = await import('../admin/firestoreAdmin');
    await endFirestoreStream(sessionId);
  } catch (fsErr: any) {
    console.warn('[LIVE][END_FIRESTORE_MIRROR_FAIL]', {
      sessionId,
      message: fsErr?.message || String(fsErr),
    });
  }

  const region = session?.region || getRegionFromStageArn(session?.stageArn);
  await stopCompositionBestEffort(session?.compositionArn, region);
  if (session?.channelArn) {
    try {
      await getIvsLowLatencyClient(region).send(new DeleteChannelCommand({ arn: session.channelArn }));
      console.log('[IVS][DELETE_CHANNEL_OK]', { sessionId, channelArn: session.channelArn, region });
    } catch (err: any) {
      console.error('[IVS][DELETE_CHANNEL_FAILED]', {
        sessionId,
        channelArn: session.channelArn,
        region,
        message: err?.message || String(err),
      });
    }
  }

  // Reap the IVS stage so it does not linger and consume the per-region stage
  // quota (1,000/region) — the previous behavior leaked a stage per stream.
  // Best-effort: a deletion failure must never fail the host's end action; an
  // orphaned stage can be swept later. Deleting a stage also disconnects any
  // remaining participants, which is the desired end-of-stream behavior.
  if (session?.stageArn) {
    const region = session.region || getRegionFromStageArn(session.stageArn);
    try {
      const client = getIvsRealtimeClient(region);
      await client.send(new DeleteStageCommand({ arn: session.stageArn }));
      console.log('[IVS][DELETE_STAGE_OK]', { sessionId, stageArn: session.stageArn, region });
    } catch (err: any) {
      console.error('[IVS][DELETE_STAGE_FAILED]', {
        sessionId,
        stageArn: session.stageArn,
        region,
        message: err?.message || String(err),
      });
    }
  }
}
