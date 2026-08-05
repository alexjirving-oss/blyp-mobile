"use strict";
/**
 * HTTP routes for IVS live streaming API.
 *
 * Exposes Firebase Cloud Functions HTTP endpoints matching mobile API contract:
 * - POST /ivs/host/start - Start new stream as host
 * - POST /ivs/guest/join - Join stream as guest
 * - POST /ivs/viewer/join - Join stream as viewer
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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.viewerJoin = exports.guestJoin = exports.hostEnd = exports.hostStart = void 0;
const functions = __importStar(require("firebase-functions"));
const liveService_1 = require("./liveService");
const cognitoJwt_1 = require("../auth/cognitoJwt");
async function verifyCognitoToken(authHeader) {
    const token = (0, cognitoJwt_1.extractBearerToken)(authHeader);
    const decoded = await (0, cognitoJwt_1.verifyCognitoIdToken)(token);
    const userId = decoded.sub || decoded.user_id || decoded.oid;
    if (!userId) {
        throw new Error('Token missing user ID claim');
    }
    return String(userId);
}
/**
 * POST /ivs/host/start
 *
 * Start a new live stream as host.
 * Request body: { title?: string, streamId?: string }
 * Response: { streamId, stageArn, region, role, participantToken, expiresAt, userId }
 */
exports.hostStart = functions.https.onRequest(async (req, res) => {
    console.log('[LIVE_ROUTES][HOST_START_REQUEST]', {
        method: req.method,
        ip: req.ip,
    });
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        // 1. Verify auth
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ error: 'Authorization required' });
            return;
        }
        const userId = await verifyCognitoToken(authHeader);
        // 2. Parse request
        const reqBody = req.body;
        if (typeof reqBody !== 'object' || reqBody === null) {
            res.status(400).json({ error: 'Request body must be JSON object' });
            return;
        }
        // 3. Call service
        const response = await (0, liveService_1.hostStartSession)(userId, reqBody);
        // 4. Return response
        res.status(200).json(response);
        console.log('[LIVE_ROUTES][HOST_START_SUCCESS]', {
            userId,
            streamId: response.streamId,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[LIVE_ROUTES][HOST_START_ERROR]', { error: message });
        res.status(500).json({ error: message });
    }
});
/**
 * POST /ivs/host/end
 *
 * End a live stream as host.
 * Request body: { streamId: string }
 * Response: { success: true }
 */
exports.hostEnd = functions.https.onRequest(async (req, res) => {
    console.log('[LIVE_ROUTES][HOST_END_REQUEST]', {
        method: req.method,
        ip: req.ip,
    });
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        // 1. Verify auth
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ error: 'Authorization required' });
            return;
        }
        const userId = await verifyCognitoToken(authHeader);
        // 2. Parse request
        const { streamId } = req.body;
        if (!streamId || typeof streamId !== 'string') {
            res.status(400).json({ error: 'streamId required' });
            return;
        }
        // 3. Call service
        await (0, liveService_1.hostEndSession)(userId, streamId);
        // 4. Return response
        res.status(200).json({ success: true });
        console.log('[LIVE_ROUTES][HOST_END_SUCCESS]', {
            userId,
            streamId,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[LIVE_ROUTES][HOST_END_ERROR]', { error: message });
        res.status(500).json({ error: message });
    }
});
/**
 * POST /ivs/guest/join
 *
 * Join a stream as guest.
 * Request body: { streamId: string }
 * Response: { streamId, stageArn, region, role, participantToken, expiresAt, userId }
 */
exports.guestJoin = functions.https.onRequest(async (req, res) => {
    console.log('[LIVE_ROUTES][GUEST_JOIN_REQUEST]', {
        method: req.method,
        ip: req.ip,
    });
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        // 1. Verify auth
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ error: 'Authorization required' });
            return;
        }
        const userId = await verifyCognitoToken(authHeader);
        // 2. Parse request
        const { streamId } = req.body;
        if (!streamId || typeof streamId !== 'string') {
            res.status(400).json({ error: 'streamId required' });
            return;
        }
        // 3. Call service
        const response = await (0, liveService_1.acceptGuestInvite)(userId, streamId);
        // 4. Return response
        res.status(200).json(response);
        console.log('[LIVE_ROUTES][GUEST_JOIN_SUCCESS]', {
            userId,
            streamId,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[LIVE_ROUTES][GUEST_JOIN_ERROR]', { error: message });
        res.status(500).json({ error: message });
    }
});
/**
 * POST /ivs/viewer/join
 *
 * Join a stream as viewer.
 * Request body: { streamId: string }
 * Response: { streamId, stageArn, region, role, participantToken, expiresAt, userId }
 */
exports.viewerJoin = functions.https.onRequest(async (req, res) => {
    console.log('[LIVE_ROUTES][VIEWER_JOIN_REQUEST]', {
        method: req.method,
        ip: req.ip,
    });
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        // 1. Verify auth
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            res.status(401).json({ error: 'Authorization required' });
            return;
        }
        const userId = await verifyCognitoToken(authHeader);
        // 2. Parse request
        const { streamId } = req.body;
        if (!streamId || typeof streamId !== 'string') {
            res.status(400).json({ error: 'streamId required' });
            return;
        }
        // 3. Call service
        const response = await (0, liveService_1.joinAsViewer)(userId, streamId);
        // 4. Return response
        res.status(200).json(response);
        console.log('[LIVE_ROUTES][VIEWER_JOIN_SUCCESS]', {
            userId,
            streamId,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[LIVE_ROUTES][VIEWER_JOIN_ERROR]', { error: message });
        res.status(500).json({ error: message });
    }
});
//# sourceMappingURL=liveRoutes.js.map