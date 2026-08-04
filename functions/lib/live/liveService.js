"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.joinAsViewer = exports.leaveGuestSlot = exports.acceptGuestInvite = exports.inviteGuestToSession = exports.hostEndSession = exports.hostStartSession = void 0;
const admin = __importStar(require("firebase-admin"));
const liveAwsClient_1 = require("./liveAwsClient");
const db = admin.firestore();
/**
 * Generate a unique session ID.
 */
function generateSessionId() {
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
async function hostStartSession(hostUserId, req) {
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
        const stageArn = await (0, liveAwsClient_1.createStage)(sessionId, title);
        const playbackUrl = (0, liveAwsClient_1.getPlaybackUrl)(stageArn);
        // 2. Create Firestore session document
        const session = {
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
            const slot = {
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
        const tokenDetails = await (0, liveAwsClient_1.createParticipantToken)(stageArn, hostUserId, ['PUBLISH', 'SUBSCRIBE'], 3600 // 1 hour
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
    }
    catch (error) {
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
        }
        catch (_a) {
            // Ignore cleanup errors
        }
        throw error;
    }
}
exports.hostStartSession = hostStartSession;
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
async function hostEndSession(hostUserId, sessionId) {
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
        const session = sessionDoc.data();
        if (session.hostUserId !== hostUserId) {
            throw new Error(`User ${hostUserId} is not host of session ${sessionId}`);
        }
        // 2. Delete IVS stage
        await (0, liveAwsClient_1.deleteStage)(session.stageArn);
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
    }
    catch (error) {
        console.error('[LIVE_SERVICE][HOST_END_ERROR]', {
            hostUserId,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
exports.hostEndSession = hostEndSession;
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
async function inviteGuestToSession(hostUserId, sessionId, guestUserId) {
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
        const session = sessionDoc.data();
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
    }
    catch (error) {
        console.error('[LIVE_SERVICE][INVITE_GUEST_ERROR]', {
            hostUserId,
            sessionId,
            guestUserId,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
exports.inviteGuestToSession = inviteGuestToSession;
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
async function acceptGuestInvite(guestUserId, sessionId) {
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
        const session = sessionDoc.data();
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
        const tokenDetails = await (0, liveAwsClient_1.createParticipantToken)(session.stageArn, guestUserId, ['PUBLISH', 'SUBSCRIBE'], 3600 // 1 hour
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
    }
    catch (error) {
        console.error('[LIVE_SERVICE][ACCEPT_INVITE_ERROR]', {
            guestUserId,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
exports.acceptGuestInvite = acceptGuestInvite;
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
async function leaveGuestSlot(guestUserId, sessionId) {
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
            const slot = doc.data();
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
            }
            catch (_a) {
                // Ignore cleanup errors
            }
        }, 5000); // 5 second delay to allow audit logging
        console.log('[LIVE_SERVICE][LEAVE_GUEST_SLOT_SUCCESS]', {
            guestUserId,
            sessionId,
            slotIndex: matchingSlot.id,
        });
    }
    catch (error) {
        console.error('[LIVE_SERVICE][LEAVE_GUEST_SLOT_ERROR]', {
            guestUserId,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
exports.leaveGuestSlot = leaveGuestSlot;
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
async function joinAsViewer(viewerUserId, sessionId) {
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
        const session = sessionDoc.data();
        if (session.status !== 'live') {
            throw new Error(`Session ${sessionId} is not live (status: ${session.status})`);
        }
        // 2. Generate viewer token (SUBSCRIBE only)
        const tokenDetails = await (0, liveAwsClient_1.createParticipantToken)(session.stageArn, viewerUserId, ['SUBSCRIBE'], 3600 // 1 hour
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
    }
    catch (error) {
        console.error('[LIVE_SERVICE][JOIN_VIEWER_ERROR]', {
            viewerUserId,
            sessionId,
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
}
exports.joinAsViewer = joinAsViewer;
//# sourceMappingURL=liveService.js.map