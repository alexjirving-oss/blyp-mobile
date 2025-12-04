"use strict";
/**
 * Live Stream API Functions
 * Backend proxy for comments and likes with Cognito auth validation
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
exports.addLiveStreamLike = exports.addLiveStreamComment = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
// Initialize if not already initialized (avoid duplicate app error)
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
/**
 * Verify Cognito JWT token (simplified - you should use aws-jwt-verify in production)
 */
async function verifyCognitoToken(token) {
    // TODO: Add proper Cognito JWT verification using aws-jwt-verify
    // For now, basic validation that token exists
    if (!token || token.length < 20) {
        throw new Error('Invalid token');
    }
    // In production, decode and verify the Cognito JWT:
    // const verifier = CognitoJwtVerifier.create({...});
    // const payload = await verifier.verify(token);
    // return payload;
    // Temporary: extract userId from token (NOT SECURE - just for testing)
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            throw new Error('Invalid JWT structure');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        return payload;
    }
    catch (e) {
        throw new Error('Failed to parse token');
    }
}
/**
 * Add comment to live stream
 * POST /addLiveStreamComment
 * Body: { streamId, content }
 * Headers: { Authorization: Bearer <cognito-token> }
 */
exports.addLiveStreamComment = functions.https.onRequest(async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        // Get token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Missing authorization header' });
            return;
        }
        const token = authHeader.substring(7);
        // Verify Cognito token
        const cognitoUser = await verifyCognitoToken(token);
        const userId = cognitoUser.sub || cognitoUser.username;
        if (!userId) {
            res.status(401).json({ error: 'Invalid user token' });
            return;
        }
        // Get request body
        const { streamId, content } = req.body;
        if (!streamId || typeof streamId !== 'string') {
            res.status(400).json({ error: 'streamId is required' });
            return;
        }
        if (!content || typeof content !== 'string' || content.trim().length === 0) {
            res.status(400).json({ error: 'content is required' });
            return;
        }
        if (content.length > 1000) {
            res.status(400).json({ error: 'content too long (max 1000 chars)' });
            return;
        }
        // Write comment using Admin SDK (bypasses Firestore rules)
        const comment = {
            userId: userId,
            userName: cognitoUser.username || 'Anonymous',
            userPhotoURL: cognitoUser.picture || null,
            content: content.trim(),
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            likes: 0,
            isHighlighted: false
        };
        await db
            .collection('liveStreams')
            .doc(streamId)
            .collection('comments')
            .add(comment);
        console.log(`Comment added to stream ${streamId} by user ${userId}`);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
/**
 * Add like to live stream
 * POST /addLiveStreamLike
 * Body: { streamId }
 * Headers: { Authorization: Bearer <cognito-token> }
 */
exports.addLiveStreamLike = functions.https.onRequest(async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        // Get token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ error: 'Missing authorization header' });
            return;
        }
        const token = authHeader.substring(7);
        // Verify Cognito token
        const cognitoUser = await verifyCognitoToken(token);
        const userId = cognitoUser.sub || cognitoUser.username;
        if (!userId) {
            res.status(401).json({ error: 'Invalid user token' });
            return;
        }
        // Get request body
        const { streamId } = req.body;
        if (!streamId || typeof streamId !== 'string') {
            res.status(400).json({ error: 'streamId is required' });
            return;
        }
        // Increment like count using Admin SDK
        await db
            .collection('liveStreams')
            .doc(streamId)
            .update({
            likes: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            'streamHealth.engagementActivity': admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`Like added to stream ${streamId} by user ${userId}`);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error adding like:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
//# sourceMappingURL=liveStreamApi.js.map