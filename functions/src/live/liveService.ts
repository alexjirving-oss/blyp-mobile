/**
 * Core live streaming service operations.
 * 
 * Handles:
 * - Session lifecycle (start host, end host)
 * - Guest management (invite, accept, leave)
 * - Viewer participation (join as subscriber)
 * - Firestore persistence for session state
 * - AWS IVS token generation and stage management
 */

import * as admin from 'firebase-admin';
import {
  LiveSession,
  LiveSlot,
  LiveJoinResponse,
  HostStartRequest,
} from './liveTypes';
import {
  createStage,
  deleteStage,
  createParticipantToken,
  getPlaybackUrl,
} from './liveAwsClient';

const db = admin.firestore();

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Start a new live session as host.
 * 
 * Workflow:
 * 1. Create IVS stage
 * 2. Create Firestore LiveSession document
 * 3. Initialize guest slots (empty)
 * 4. Generate host participant token
 * 5. Return stage info + token to host
 * 
 * @param hostUserId - User ID of host
 * @param req - Host start request (title, optional streamId)
 * @returns Live join response with host token
 */
export async function hostStartSession(
  hostUserId: string,
  req: HostStartRequest
): Promise<LiveJoinResponse> {
  const sessionId = req.streamId || generateSessionId();
  const title = req.title || `Blyp Live Stream`;
  const maxGuestSlots = 11;

  console.log('[LIVE_SERVICE][HOST_START]', {
    hostUserId,
    sessionId,
    title,
  });

  try {
    // 1. Create IVS Stage
    const stageArn = await createStage(sessionId, title);
    const playbackUrl = getPlaybackUrl(stageArn);

    // 2. Create Firestore session document
    const session: LiveSession = {
      sessionId,
      backend: 'ivs',
      hostUserId,
      stageArn,
      playbackUrl,
      status: 'creating',
      title,
      createdAt: admin.firestore.Timestamp.now(),
      maxGuestSlots,
      metadata: {},
    };

    await db.collection('liveSessions').doc(sessionId).set(session);

    // 3. Initialize empty guest slots
    for (let i = 0; i < maxGuestSlots; i++) {
      const slot: LiveSlot = {
        sessionId,
        slotIndex: i,
        state: 'empty',
        metadata: {},
      };
      await db
        .collection('liveSessions')
        .doc(sessionId)
        .collection('slots')
        .doc(String(i))
        .set(slot);
    }

    // 4. Generate host token (PUBLISH capability)
    const tokenDetails = await createParticipantToken(
      stageArn,
      hostUserId,
      ['PUBLISH', 'SUBSCRIBE'],
      3600 // 1 hour
    );

    // 5. Update session status to 'live'
    await db.collection('liveSessions').doc(sessionId).update({
      status: 'live',
      startedAt: admin.firestore.Timestamp.now(),
    });

    console.log('[LIVE_SERVICE][HOST_START_SUCCESS]', {
      hostUserId,
      sessionId,
      stageArn,
    });

    return {
      streamId: sessionId,
      stageArn,
      region: process.env.AWS_REGION || 'us-east-1',
      role: 'host',
      participantToken: tokenDetails.token,
      expiresAt: tokenDetails.expiresAt.toISOString(),
      userId: hostUserId,
    };
  } catch (error) {
    console.error('[LIVE_SERVICE][HOST_START_ERROR]', {
      hostUserId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });

    // Mark session as failed if it was created
    try {
      await db.collection('liveSessions').doc(sessionId).update({
        status: 'failed',
      });
    } catch {
      // Ignore cleanup errors
    }

    throw error;
  }
}

/**
 * End a live session as host.
 * 
 * Workflow:
 * 1. Verify host owns session
 * 2. Delete IVS stage
 * 3. Mark session as 'ended' in Firestore
 * 4. Clean up guest slots
 * 
 * @param hostUserId - User ID of host
 * @param sessionId - Session to end
 */
export async function hostEndSession(
  hostUserId: string,
  sessionId: string
): Promise<void> {
  console.log('[LIVE_SERVICE][HOST_END]', {
    hostUserId,
    sessionId,
  });

  try {
    // 1. Verify host owns session
    const sessionDoc = await db.collection('liveSessions').doc(sessionId).get();
    if (!sessionDoc.exists) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const session = sessionDoc.data() as LiveSession;
    if (session.hostUserId !== hostUserId) {
      throw new Error(`User ${hostUserId} is not host of session ${sessionId}`);
    }

    // 2. Delete IVS stage
    await deleteStage(session.stageArn);

    // 3. Mark session as ended
    await db.collection('liveSessions').doc(sessionId).update({
      status: 'ended',
      endedAt: admin.firestore.Timestamp.now(),
    });

    // 4. Clean up slots (optional; can also keep for archive)
    const slotsSnapshot = await db
      .collection('liveSessions')
      .doc(sessionId)
      .collection('slots')
      .get();

    for (const slotDoc of slotsSnapshot.docs) {
      await slotDoc.ref.delete();
    }

    console.log('[LIVE_SERVICE][HOST_END_SUCCESS]', {
      hostUserId,
      sessionId,
    });
  } catch (error) {
    console.error('[LIVE_SERVICE][HOST_END_ERROR]', {
      hostUserId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Invite a guest to join a live session.
 * 
 * Workflow:
 * 1. Verify host owns session
 * 2. Find empty slot
 * 3. Mark slot as 'invited' with guest user ID
 * 4. (In production: send notification to guest)
 * 
 * @param hostUserId - User ID of host
 * @param sessionId - Session to join
 * @param guestUserId - User ID of guest to invite
 */
export async function inviteGuestToSession(
  hostUserId: string,
  sessionId: string,
  guestUserId: string
): Promise<void> {
  console.log('[LIVE_SERVICE][INVITE_GUEST]', {
    hostUserId,
    sessionId,
    guestUserId,
  });

  try {
    // 1. Verify host owns session
    const sessionDoc = await db.collection('liveSessions').doc(sessionId).get();
    if (!sessionDoc.exists) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const session = sessionDoc.data() as LiveSession;
    if (session.hostUserId !== hostUserId) {
      throw new Error(`User ${hostUserId} is not host of session ${sessionId}`);
    }

    // 2. Find empty slot
    const slotsSnapshot = await db
      .collection('liveSessions')
      .doc(sessionId)
      .collection('slots')
      .where('state', '==', 'empty')
      .limit(1)
      .get();

    if (slotsSnapshot.empty) {
      throw new Error(`No empty slots available in session ${sessionId}`);
    }

    const slotDoc = slotsSnapshot.docs[0];
    const slotIndex = parseInt(slotDoc.id, 10);

    // 3. Mark slot as invited
    await slotDoc.ref.update({
      userId: guestUserId,
      state: 'invited',
    });

    console.log('[LIVE_SERVICE][INVITE_GUEST_SUCCESS]', {
      hostUserId,
      sessionId,
      guestUserId,
      slotIndex,
    });
  } catch (error) {
    console.error('[LIVE_SERVICE][INVITE_GUEST_ERROR]', {
      hostUserId,
      sessionId,
      guestUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Accept a guest invitation and join session.
 * 
 * Workflow:
 * 1. Find slot with guest user ID in 'invited' state
 * 2. Verify guest owns that slot
 * 3. Mark slot as 'connecting'
 * 4. Generate guest token (PUBLISH capability)
 * 5. Return token + stage info
 * 
 * @param guestUserId - User ID of guest
 * @param sessionId - Session to join
 * @returns Live join response with guest token
 */
export async function acceptGuestInvite(
  guestUserId: string,
  sessionId: string
): Promise<LiveJoinResponse> {
  console.log('[LIVE_SERVICE][ACCEPT_INVITE]', {
    guestUserId,
    sessionId,
  });

  try {
    // 0. Get session
    const sessionDoc = await db.collection('liveSessions').doc(sessionId).get();
    if (!sessionDoc.exists) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const session = sessionDoc.data() as LiveSession;

    // 1. Find slot with guest in 'invited' state
    const slotsSnapshot = await db
      .collection('liveSessions')
      .doc(sessionId)
      .collection('slots')
      .where('userId', '==', guestUserId)
      .where('state', '==', 'invited')
      .limit(1)
      .get();

    if (slotsSnapshot.empty) {
      throw new Error(`No invitation found for guest ${guestUserId} in session ${sessionId}`);
    }

    const slotDoc = slotsSnapshot.docs[0];
    const slotIndex = parseInt(slotDoc.id, 10);

    // 2. Mark slot as 'connecting'
    await slotDoc.ref.update({
      state: 'connecting',
      joinedAt: admin.firestore.Timestamp.now(),
    });

    // 3. Generate guest token (PUBLISH capability)
    const tokenDetails = await createParticipantToken(
      session.stageArn,
      guestUserId,
      ['PUBLISH', 'SUBSCRIBE'],
      3600 // 1 hour
    );

    // 4. Update slot to 'live'
    await slotDoc.ref.update({
      state: 'live',
    });

    console.log('[LIVE_SERVICE][ACCEPT_INVITE_SUCCESS]', {
      guestUserId,
      sessionId,
      slotIndex,
    });

    return {
      streamId: sessionId,
      stageArn: session.stageArn,
      region: process.env.AWS_REGION || 'us-east-1',
      role: 'guest',
      participantToken: tokenDetails.token,
      expiresAt: tokenDetails.expiresAt.toISOString(),
      userId: guestUserId,
    };
  } catch (error) {
    console.error('[LIVE_SERVICE][ACCEPT_INVITE_ERROR]', {
      guestUserId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Leave a guest slot (guest disconnects from session).
 * 
 * Workflow:
 * 1. Find slot with guest user ID in 'live' or 'connecting' state
 * 2. Mark slot as 'disconnected'
 * 3. Clean up guest user ID from slot (recycle slot)
 * 
 * @param guestUserId - User ID of guest
 * @param sessionId - Session to leave
 */
export async function leaveGuestSlot(
  guestUserId: string,
  sessionId: string
): Promise<void> {
  console.log('[LIVE_SERVICE][LEAVE_GUEST_SLOT]', {
    guestUserId,
    sessionId,
  });

  try {
    // 1. Find slot with guest in live/connecting state
    const slotsSnapshot = await db
      .collection('liveSessions')
      .doc(sessionId)
      .collection('slots')
      .where('userId', '==', guestUserId)
      .get();

    const matchingSlot = slotsSnapshot.docs.find((doc) => {
      const slot = doc.data() as LiveSlot;
      return slot.state === 'live' || slot.state === 'connecting';
    });

    if (!matchingSlot) {
      throw new Error(`No active slot found for guest ${guestUserId} in session ${sessionId}`);
    }

    // 2. Mark as disconnected
    await matchingSlot.ref.update({
      state: 'disconnected',
      leftAt: admin.firestore.Timestamp.now(),
    });

    // 3. Recycle slot (clear user ID after brief delay for archive)
    // In production, may want to keep for audit trail, then cleanup via batch job
    setTimeout(async () => {
      try {
        await matchingSlot.ref.update({
          userId: admin.firestore.FieldValue.delete(),
          state: 'empty',
        });
      } catch {
        // Ignore cleanup errors
      }
    }, 5000); // 5 second delay to allow audit logging

    console.log('[LIVE_SERVICE][LEAVE_GUEST_SLOT_SUCCESS]', {
      guestUserId,
      sessionId,
      slotIndex: matchingSlot.id,
    });
  } catch (error) {
    console.error('[LIVE_SERVICE][LEAVE_GUEST_SLOT_ERROR]', {
      guestUserId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Join session as viewer (read-only subscriber).
 * 
 * Workflow:
 * 1. Verify session exists and is 'live'
 * 2. Generate viewer token (SUBSCRIBE capability only)
 * 3. Return playback URL + token to viewer
 * 
 * @param viewerUserId - User ID of viewer
 * @param sessionId - Session to view
 * @returns Live join response with viewer token
 */
export async function joinAsViewer(
  viewerUserId: string,
  sessionId: string
): Promise<LiveJoinResponse> {
  console.log('[LIVE_SERVICE][JOIN_VIEWER]', {
    viewerUserId,
    sessionId,
  });

  try {
    // 1. Verify session exists and is live
    const sessionDoc = await db.collection('liveSessions').doc(sessionId).get();
    if (!sessionDoc.exists) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const session = sessionDoc.data() as LiveSession;
    if (session.status !== 'live') {
      throw new Error(`Session ${sessionId} is not live (status: ${session.status})`);
    }

    // 2. Generate viewer token (SUBSCRIBE only)
    const tokenDetails = await createParticipantToken(
      session.stageArn,
      viewerUserId,
      ['SUBSCRIBE'],
      3600 // 1 hour
    );

    console.log('[LIVE_SERVICE][JOIN_VIEWER_SUCCESS]', {
      viewerUserId,
      sessionId,
    });

    return {
      streamId: sessionId,
      stageArn: session.stageArn,
      region: process.env.AWS_REGION || 'us-east-1',
      role: 'viewer',
      participantToken: tokenDetails.token,
      expiresAt: tokenDetails.expiresAt.toISOString(),
      userId: viewerUserId,
    };
  } catch (error) {
    console.error('[LIVE_SERVICE][JOIN_VIEWER_ERROR]', {
      viewerUserId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
