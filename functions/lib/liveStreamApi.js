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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addLiveStreamLike = exports.addLiveStreamComment = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwks_rsa_1 = __importDefault(require("jwks-rsa"));
const textFilter_1 = require("./moderation/textFilter");
// Per-user live-comment rate limit. A fixed window keeps spam bounded without
// the cost of a full sliding-window store; the limiter fails OPEN so a transient
// Firestore issue never blocks legitimate chat (moderation remains the hard gate).
const COMMENT_RATE_MAX = 5;
const COMMENT_RATE_WINDOW_MS = 10000;
// Initialize if not already initialized (avoid duplicate app error)
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const PLACEHOLDER_NAMES = new Set(['anonymous', 'anonymous user', 'anon']);
function toTrimmedString(value) {
    if (typeof value !== 'string')
        return null;
    const s = value.trim();
    return s ? s : null;
}
function isPlaceholderName(value) {
    const s = toTrimmedString(value);
    if (!s)
        return true;
    return PLACEHOLDER_NAMES.has(s.replace(/^@+/, '').toLowerCase());
}
function pickBestProfileNameFromUserDoc(userDocData, userId) {
    const username = toTrimmedString((userDocData === null || userDocData === void 0 ? void 0 : userDocData.username) || (userDocData === null || userDocData === void 0 ? void 0 : userDocData.handle) || (userDocData === null || userDocData === void 0 ? void 0 : userDocData.userName));
    const displayName = toTrimmedString((userDocData === null || userDocData === void 0 ? void 0 : userDocData.displayName) || (userDocData === null || userDocData === void 0 ? void 0 : userDocData.userName));
    if (username && !isPlaceholderName(username) && username !== userId) {
        return { username, displayName: username };
    }
    if (displayName && !isPlaceholderName(displayName) && displayName !== userId) {
        return { username: null, displayName };
    }
    return { username: null, displayName: userId };
}
function pickBestUserName(payload, userId) {
    var _a;
    const candidates = [
        payload === null || payload === void 0 ? void 0 : payload.name,
        payload === null || payload === void 0 ? void 0 : payload.preferred_username,
        payload === null || payload === void 0 ? void 0 : payload['cognito:username'],
        payload === null || payload === void 0 ? void 0 : payload.username,
        payload === null || payload === void 0 ? void 0 : payload.email,
    ];
    for (const c of candidates) {
        if (typeof c === 'string') {
            const trimmed = c.trim();
            if (!trimmed)
                continue;
            if (trimmed.toLowerCase() === 'anonymous' || trimmed.toLowerCase() === 'anonymous user')
                continue;
            // If it's an email, prefer the prefix for display.
            if (trimmed.includes('@')) {
                const prefix = (_a = trimmed.split('@')[0]) === null || _a === void 0 ? void 0 : _a.trim();
                if (prefix)
                    return prefix;
            }
            return trimmed;
        }
    }
    return userId;
}
function applyCors(req, res, methods) {
    const origin = String(req.headers.origin || '').trim();
    const allowlist = String(process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => !!s && s !== '*');
    if (origin && allowlist.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Methods', methods);
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
function extractBearerToken(authHeader) {
    const header = String(authHeader || '');
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        throw new Error('Missing or invalid Authorization header');
    }
    return match[1];
}
const getCognitoVerifier = (() => {
    let client = null;
    let issuer = null;
    return () => {
        const cognitoRegion = process.env.COGNITO_REGION;
        const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID;
        if (!cognitoRegion || !cognitoUserPoolId) {
            throw new Error('[config] COGNITO_REGION and COGNITO_USER_POOL_ID are required');
        }
        if (!client) {
            const jwksUri = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}/.well-known/jwks.json`;
            client = (0, jwks_rsa_1.default)({ jwksUri, cache: true, cacheMaxEntries: 10, cacheMaxAge: 10 * 60 * 1000 });
            issuer = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}`;
        }
        return { client, issuer };
    };
})();
function getKey(header, callback) {
    try {
        const { client } = getCognitoVerifier();
        client.getSigningKey(header.kid, function (err, key) {
            var _a;
            if (err) {
                callback(err);
                return;
            }
            const signingKey = (_a = key === null || key === void 0 ? void 0 : key.getPublicKey) === null || _a === void 0 ? void 0 : _a.call(key);
            callback(null, signingKey);
        });
    }
    catch (e) {
        callback(e);
    }
}
async function verifyCognitoIdToken(idToken) {
    if (!idToken || typeof idToken !== 'string') {
        throw new Error('Invalid Cognito token');
    }
    const { issuer } = getCognitoVerifier();
    return await new Promise((resolve, reject) => {
        jsonwebtoken_1.default.verify(idToken, getKey, {
            algorithms: ['RS256'],
            issuer: issuer || undefined,
        }, (err, payload) => {
            if (err)
                reject(err);
            else
                resolve(payload);
        });
    });
}
async function verifyCognitoToken(token) {
    return await verifyCognitoIdToken(token);
}
/**
 * Per-user fixed-window rate limit for live comments. Stores a small pruned
 * array of recent timestamps in one doc per user (bounded size, overwritten in
 * place). Returns false when the user is over the limit. Fails OPEN on error.
 */
async function consumeCommentRateLimit(userId) {
    const ref = db.collection('liveCommentRate').doc(userId);
    try {
        return await db.runTransaction(async (tx) => {
            var _a;
            const snap = await tx.get(ref);
            const now = Date.now();
            const windowStart = now - COMMENT_RATE_WINDOW_MS;
            const prev = (snap.exists ? (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.recent : []) || [];
            const recent = prev.filter((t) => typeof t === 'number' && t > windowStart);
            if (recent.length >= COMMENT_RATE_MAX) {
                return false;
            }
            recent.push(now);
            tx.set(ref, {
                recent,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                // Lets an optional Firestore TTL policy auto-clean idle limiter docs.
                expiresAt: admin.firestore.Timestamp.fromMillis(now + 60000),
            });
            return true;
        });
    }
    catch (e) {
        console.warn('[addLiveStreamComment] rate-limit check failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        return true; // fail open
    }
}
/** Record a suppressed (blocked) live comment for moderation review. */
async function writeLiveModerationAudit(streamId, authorId, categories) {
    try {
        await db.collection('moderationActions').add({
            actorId: 'system',
            source: 'auto_text_filter',
            actionType: 'live_comment_suppressed',
            targetType: 'live_comment',
            targetId: streamId,
            authorId: authorId || null,
            categories: categories || [],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }
    catch (e) {
        console.warn('[addLiveStreamComment] audit write failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
}
/**
 * Add comment to live stream
 * POST /addLiveStreamComment
 * Body: { streamId, content }
 * Headers: { Authorization: Bearer <cognito-token> }
 */
exports.addLiveStreamComment = functions.https.onRequest(async (req, res) => {
    // CORS (no wildcard for authenticated endpoints)
    applyCors(req, res, 'POST, OPTIONS');
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
        const token = extractBearerToken(req.headers.authorization);
        // Verify Cognito token
        const cognitoUser = await verifyCognitoToken(token);
        const cognitoSub = String(cognitoUser.sub || '').trim();
        const cognitoUsername = String(cognitoUser['cognito:username'] || cognitoUser.username || '').trim();
        const cognitoEmail = String(cognitoUser.email || '').trim();
        // Canonical id: use `sub` when present.
        const userId = String(cognitoSub || cognitoUsername || cognitoEmail || '').trim();
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
        // Per-user rate limit. Suppress silently (success, not stored) so spammers
        // get no signal and existing clients see no new error path.
        const allowed = await consumeCommentRateLimit(userId);
        if (!allowed) {
            res.status(200).json({ success: true, suppressed: true, reason: 'rate_limited' });
            return;
        }
        // Server-side moderation: the client filter (inspectText) can be bypassed,
        // so re-inspect authoritatively before the comment is ever stored/broadcast.
        // blocked -> suppress silently + audit; masked -> store the masked text.
        let moderatedContent = content.trim();
        try {
            const result = (0, textFilter_1.inspectText)(content);
            if (result.severity !== 'clean') {
                if (result.blocked) {
                    await writeLiveModerationAudit(streamId, userId, result.categories);
                    res.status(200).json({ success: true, suppressed: true, reason: 'blocked' });
                    return;
                }
                if (result.masked && typeof result.clean === 'string' && result.clean.trim()) {
                    moderatedContent = result.clean.trim();
                }
            }
        }
        catch (e) {
            console.warn('[addLiveStreamComment] moderation inspect failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        }
        // Prefer app profile identity over Cognito payload (Cognito sub is usually a UUID).
        // Also handle legacy profile docs keyed by username/email instead of sub.
        let profileUsername = null;
        let profileDisplayName = null;
        let profilePhotoURL = null;
        try {
            const candidateDocIds = [];
            if (cognitoSub)
                candidateDocIds.push(cognitoSub);
            if (cognitoUsername && cognitoUsername !== cognitoSub)
                candidateDocIds.push(cognitoUsername);
            if (cognitoEmail && cognitoEmail !== cognitoSub && cognitoEmail !== cognitoUsername)
                candidateDocIds.push(cognitoEmail);
            let userData = null;
            for (const docId of candidateDocIds) {
                const snap = await db.collection('users').doc(docId).get();
                if (snap.exists) {
                    userData = snap.data() || null;
                    break;
                }
            }
            const picked = pickBestProfileNameFromUserDoc(userData, userId);
            profileUsername = picked.username;
            profileDisplayName = picked.displayName;
            profilePhotoURL = toTrimmedString(userData === null || userData === void 0 ? void 0 : userData.photoURL);
        }
        catch (e) {
            // Fall back to Cognito payload if profile lookup fails.
            profileUsername = null;
            profileDisplayName = null;
            profilePhotoURL = null;
        }
        const fallbackName = pickBestUserName(cognitoUser, userId);
        const usableProfileDisplayName = profileDisplayName && !isPlaceholderName(profileDisplayName) && profileDisplayName !== userId ? profileDisplayName : null;
        const userName = usableProfileDisplayName || fallbackName;
        // Always ensure username field has a real value (not null) - use profileUsername if available, otherwise use displayName or fallbackName
        const username = (profileUsername && !isPlaceholderName(profileUsername) ? profileUsername : null) || usableProfileDisplayName || fallbackName || null;
        const userPhotoURL = profilePhotoURL || toTrimmedString(cognitoUser.picture) || null;
        const comment = {
            userId,
            // For compatibility: existing clients read userName; newer code can prefer username.
            userName,
            username,
            userPhotoURL,
            content: moderatedContent,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            likes: 0,
            isHighlighted: false,
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
    // CORS (no wildcard for authenticated endpoints)
    applyCors(req, res, 'POST, OPTIONS');
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
        const token = extractBearerToken(req.headers.authorization);
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
        // Increment like count using Admin SDK on the authoritative directory doc.
        await db
            .collection('liveStreams')
            .doc(streamId)
            .update({
            likes: admin.firestore.FieldValue.increment(1),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            'streamHealth.engagementActivity': admin.firestore.FieldValue.serverTimestamp()
        });
        // Best-effort mirror onto the streams/{id} doc so the post-stream summary
        // (which reads streams first) reflects the same total. Non-fatal if missing.
        try {
            await db
                .collection('streams')
                .doc(streamId)
                .update({ likes: admin.firestore.FieldValue.increment(1) });
        }
        catch (mirrorErr) {
            console.warn(`Could not mirror like to streams/${streamId}:`, mirrorErr);
        }
        console.log(`Like added to stream ${streamId} by user ${userId}`);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error adding like:', error);
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
});
//# sourceMappingURL=liveStreamApi.js.map