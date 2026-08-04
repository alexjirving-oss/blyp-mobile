import { v4 as uuidv4 } from 'uuid';
import { CreateParticipantTokenCommand, CreateStageCommand, DeleteStageCommand } from '@aws-sdk/client-ivs-realtime';
import {
  getIvsRealtimeClient,
  getRegionFromStageArn,
  resolveStageRegion,
  DEFAULT_IVS_REALTIME_REGION,
} from '../aws/ivsRealtimeClient';
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
import { markBattleAttendance, assertBattleParticipant, assertBattleCreator } from '../economy/battleEscrowService';
import { emitRoomEvent } from '../realtime/realtimeBus';
import { getStreamPlaybackForViewer } from '../admin/firestoreAdmin';

function nowIso(): string {
  return new Date().toISOString();
}

/** Coded authorization error so routes can map to HTTP 403. */
function forbidden(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'FORBIDDEN';
  return err;
}

/**
 * IVS Real-Time hard-caps a stage at 12 publishers (non-adjustable). The host
 * always publishes, so a single stage supports the host + 11 guest publishers.
 * Larger/cross-host panels require participant replication across stages, not
 * additional seats on one stage.
 */
const MAX_PUBLISHERS_PER_STAGE = 12;
const MAX_GUEST_SLOTS = MAX_PUBLISHERS_PER_STAGE - 1; // 11

/** Coded error for when the on-stage publisher panel is full (host + 11 guests). */
function panelFull(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'PANEL_FULL';
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
  const MAX = MAX_GUEST_SLOTS;
  if (typeof preferred === 'number' && preferred >= MIN && preferred <= MAX && !used.has(preferred)) {
    return preferred;
  }
  for (let i = MIN; i <= MAX; i++) {
    if (!used.has(i)) return i;
  }
  // Fallback (should never happen — callers guard against a full panel first).
  return MIN;
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

  const createdAt = nowIso();

  const session: LiveSession = {
    sessionId,
    hostUserId,
    stageArn,
    region: stageRegion,
    title,
    status: 'LIVE',
    createdAt,
  };

  // 2. Persist session
  await createSession(session);

  // 3. Create host token (same region as the stage).
  const tokenRes = await client.send(new CreateParticipantTokenCommand({
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
  await leaveGuestSession(sessionId, guestUserId, nowIso(), opts);
  emitRoomEvent(sessionId, { type: 'guest.left', guestUserId });
}

export async function requestGuestSlot(sessionId: string, guestUserId: string, slotIndexRequested?: number): Promise<void> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
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
  return listGuestRequestsStore(sessionId);
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

  const allGuests = await listGuestsStore(sessionId);
  const used = new Set<number>();
  for (const g of allGuests) {
    const active = g.state === 'INVITED' || (g.state === 'LIVE' && !isGuestStale(g));
    if (active && typeof g.slotIndex === 'number') used.add(g.slotIndex);
  }

  // Enforce the IVS 12-publisher hard cap (host + 11 guests). The guest being
  // invited is still REQUESTED here, so they are not yet counted in `used`.
  if (used.size >= MAX_GUEST_SLOTS) {
    throw panelFull(`Guest panel is full (max ${MAX_GUEST_SLOTS} guests)`);
  }

  const record = await getGuestStore(sessionId, guestUserId);
  const preferred = typeof record?.slotIndexRequested === 'number' ? record.slotIndexRequested : undefined;
  const slotIndex = pickSlotIndex(used, preferred);

  await inviteGuestStore(sessionId, guestUserId, slotIndex, nowIso());
  // Push the state change to connected clients in real time (additive to the
  // existing poll/Firestore-mirror path).
  emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex });
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
    throw new Error('Host cannot invite themselves as a guest');
  }

  const allGuests = await listGuestsStore(sessionId);
  const used = new Set<number>();
  for (const g of allGuests) {
    const active = g.state === 'INVITED' || (g.state === 'LIVE' && !isGuestStale(g));
    if (active && typeof g.slotIndex === 'number') used.add(g.slotIndex);
  }
  if (used.size >= MAX_GUEST_SLOTS) {
    throw panelFull(`Guest panel is full (max ${MAX_GUEST_SLOTS} guests)`);
  }

  const slotIndex = pickSlotIndex(used);
  await hostInviteGuestStore(sessionId, guestUserId, slotIndex, nowIso());
  emitRoomEvent(sessionId, { type: 'guest.invited', guestUserId, slotIndex });
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
  await rejectGuestStore(sessionId, guestUserId, nowIso());
  emitRoomEvent(sessionId, { type: 'guest.rejected', guestUserId });
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

  const client = getIvsRealtimeClient(getRegionFromStageArn(session.stageArn));
  const tokenRes = await client.send(new CreateParticipantTokenCommand({
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

  // Announce the join so all clients can show an "X joined" chat line in real time.
  emitRoomEvent(sessionId, { type: 'viewer.joined', viewerUserId, displayName: displayName || undefined });

  return {
    token,
    stageArn: session.stageArn,
    sessionId,
    userId: viewerUserId,
    role: 'viewer',
  };
}

/**
 * Mass viewer join — returns an HLS playback URL when the stream doc has one.
 * Otherwise the client should fall back to joinLiveRealtime (stage subscriber).
 */
export async function joinLiveMass(
  sessionId: string,
  viewerUserId: string,
): Promise<{ sessionId: string; playbackUrl?: string; mode: 'playback' | 'realtime' }> {
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  const firestore = await getStreamPlaybackForViewer(sessionId);
  if (firestore.playbackUrl) {
    emitRoomEvent(sessionId, { type: 'viewer.joined', viewerUserId });
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
  await assertBattleCreator(battleId, creatorUserId);
  const sessionId = uuidv4();
  const appPrefix = process.env.IVS_STAGE_PREFIX ?? 'blyp-dev';
  const safeStageName = buildSafeStageName({ appPrefix, userId: creatorUserId, rawTitle: title || 'battle', sessionId });

  const region = resolveStageRegion(regionHint);
  // The opponent joins this same shared stage, so the creator's region is used
  // for the whole battle (with default-region fallback inside the helper).
  const stageArn = await createStageInRegion(safeStageName, region);
  const client = getIvsRealtimeClient(getRegionFromStageArn(stageArn));

  const session: LiveSession = {
    sessionId,
    hostUserId: creatorUserId,
    stageArn,
    region: getRegionFromStageArn(stageArn),
    title,
    status: 'LIVE',
    createdAt: nowIso(),
  };
  await createSession(session);

  const tokenRes = await client.send(new CreateParticipantTokenCommand({
    stageArn,
    userId: creatorUserId,
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    attributes: { role: 'battle', battleId, sessionId, title: title || '' },
    duration: 60,
  }));
  const hostToken = tokenRes.participantToken?.token;
  if (!hostToken) throw new Error('Failed to create battle participant token');

  // Minting the creator's publish token == they turned up.
  await markBattleAttendance(battleId, creatorUserId);

  return { session, hostToken, stageArn };
}

export async function joinBattleStage(
  userId: string,
  sessionId: string,
  battleId: string
): Promise<{ token: string; stageArn: string; sessionId: string; role: string }> {
  await assertBattleParticipant(battleId, userId);
  const session = await getSessionById(sessionId);
  if (!session || session.status !== 'LIVE') {
    throw new Error('Live session not found or not live');
  }

  const client = getIvsRealtimeClient(getRegionFromStageArn(session.stageArn));
  const tokenRes = await client.send(new CreateParticipantTokenCommand({
    stageArn: session.stageArn,
    userId,
    capabilities: ['PUBLISH', 'SUBSCRIBE'],
    attributes: { role: 'battle', battleId, sessionId },
    duration: 60,
  }));
  const token = tokenRes.participantToken?.token;
  if (!token) throw new Error('Failed to create battle participant token');

  // Minting this participant's publish token == they turned up.
  await markBattleAttendance(battleId, userId);

  return { token, stageArn: session.stageArn, sessionId, role: 'battle' };
}

export async function endLiveSession(sessionId: string): Promise<void> {
  const endedAt = nowIso();

  // Fetch first so we know which stage to reap (and its region) before the
  // status flips. The session record itself is retained (status -> ENDED) for
  // history/analytics; only the IVS stage resource is deleted.
  const session = await getSessionById(sessionId);
  await updateSessionStatus(sessionId, 'ENDED', endedAt);
  emitRoomEvent(sessionId, { type: 'room.ended' });

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
