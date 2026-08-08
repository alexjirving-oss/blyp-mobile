"use strict";
/**
 * Enterprise Firebase Functions for Scalable Live Streaming
 * Production-ready server-side processing for:
 *  - Video transcoding and quality generation
 *  - Real-time segment processing
 *  - CDN optimization and caching
 *  - Stream analytics and monitoring
 *  - Automatic scaling and load balancing
 *  - Global edge distribution
 *  - Performance optimization
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.blypClaimDailyReward = exports.geminiProxy = exports.onLiveSessionBadgeAward = exports.blypSyncBadgeAwards = exports.blypDatingPass = exports.blypDatingLike = exports.blypAssistantCompose = exports.onBattleComplete = exports.onBattleReminderCreate = exports.onBattleStatusChange = exports.onBattleCreate = exports.presenceOfflineSweep = exports.onUserPresenceOnline = exports.onAuditionDecision = exports.onAuditionBattleComplete = exports.auditionOpponentSweep = exports.onAuditionMatched = exports.onTeamGroupMessageCreate = exports.onTeamBattleCreate = exports.onTeamJoinRequestDecision = exports.onTeamJoinRequestCreate = exports.onCallCreate = exports.mintLiveKitToken = exports.onUserOnboardedWelcomeTour = exports.onDirectMessageCreate = exports.onTopicEventCreate = exports.onLiveStreamGoLive = exports.onLiveStreamCreate = exports.notificationOnCreate = exports.notificationDispatch = exports.blypPlayRtdn = exports.blypEnsureTrial = exports.blypSubscriptionActivate = exports.blypReachSweep = exports.blypPostEvent = exports.blypRetentionSweep = exports.buildBlypIndex = exports.blypSearchEvent = exports.blypSearch = exports.viewerJoin = exports.guestJoin = exports.hostStart = exports.viewerJoinLegacy = exports.guestJoinLegacy = exports.hostEndLegacy = exports.hostStartLegacy = exports.addLiveStreamLike = exports.addLiveStreamComment = exports.devResetFirestore = exports.billingVerify = void 0;
exports.recalcModerationQueue = exports.aggregateReport = exports.purgeExpiredAnalytics = exports.generateThumbnails = exports.cleanupOldStreams = exports.updateStreamAnalytics = exports.processVideoSegment = exports.mintFirebaseCustomToken = exports.moderatePostMedia = exports.moderateDirectMessage = exports.moderateComment = exports.processAccountDeletion = exports.streakReminderSweep = void 0;
const functions = __importStar(require("firebase-functions"));
// Export billing verification function (Stage 3 economy hardening)
var billingVerify_1 = require("./billingVerify");
Object.defineProperty(exports, "billingVerify", { enumerable: true, get: function () { return billingVerify_1.billingVerify; } });
// Export DEV-ONLY Firestore reset function (maintenance only)
var devReset_1 = require("./devReset");
Object.defineProperty(exports, "devResetFirestore", { enumerable: true, get: function () { return devReset_1.devResetFirestore; } });
// Export live stream API functions
var liveStreamApi_1 = require("./liveStreamApi");
Object.defineProperty(exports, "addLiveStreamComment", { enumerable: true, get: function () { return liveStreamApi_1.addLiveStreamComment; } });
Object.defineProperty(exports, "addLiveStreamLike", { enumerable: true, get: function () { return liveStreamApi_1.addLiveStreamLike; } });
// Export legacy IVS live streaming functions
var liveRoutes_1 = require("./live/liveRoutes");
Object.defineProperty(exports, "hostStartLegacy", { enumerable: true, get: function () { return liveRoutes_1.hostStart; } });
Object.defineProperty(exports, "hostEndLegacy", { enumerable: true, get: function () { return liveRoutes_1.hostEnd; } });
Object.defineProperty(exports, "guestJoinLegacy", { enumerable: true, get: function () { return liveRoutes_1.guestJoin; } });
Object.defineProperty(exports, "viewerJoinLegacy", { enumerable: true, get: function () { return liveRoutes_1.viewerJoin; } });
// Export new production-grade IVS token endpoints
var ivsRouter_1 = require("./services/ivsRouter");
Object.defineProperty(exports, "hostStart", { enumerable: true, get: function () { return ivsRouter_1.hostStart; } });
Object.defineProperty(exports, "guestJoin", { enumerable: true, get: function () { return ivsRouter_1.guestJoin; } });
Object.defineProperty(exports, "viewerJoin", { enumerable: true, get: function () { return ivsRouter_1.viewerJoin; } });
// Export Blyp search platform endpoints (own search/distribution platform)
var handlers_1 = require("./search/handlers");
Object.defineProperty(exports, "blypSearch", { enumerable: true, get: function () { return handlers_1.blypSearch; } });
Object.defineProperty(exports, "blypSearchEvent", { enumerable: true, get: function () { return handlers_1.blypSearchEvent; } });
// Export Blyp search scheduled jobs (own-index builder + retention sweep)
var scheduled_1 = require("./search/scheduled");
Object.defineProperty(exports, "buildBlypIndex", { enumerable: true, get: function () { return scheduled_1.buildBlypIndex; } });
Object.defineProperty(exports, "blypRetentionSweep", { enumerable: true, get: function () { return scheduled_1.blypRetentionSweep; } });
// Export Blyp distribution (earn-your-reach) endpoints + scheduled scorer
var handlers_2 = require("./distribution/handlers");
Object.defineProperty(exports, "blypPostEvent", { enumerable: true, get: function () { return handlers_2.blypPostEvent; } });
var scheduled_2 = require("./distribution/scheduled");
Object.defineProperty(exports, "blypReachSweep", { enumerable: true, get: function () { return scheduled_2.blypReachSweep; } });
// Export subscription activation (verified Play purchase -> paid entitlement + coin grant)
var handlers_3 = require("./subscriptions/handlers");
Object.defineProperty(exports, "blypSubscriptionActivate", { enumerable: true, get: function () { return handlers_3.blypSubscriptionActivate; } });
Object.defineProperty(exports, "blypEnsureTrial", { enumerable: true, get: function () { return handlers_3.blypEnsureTrial; } });
// Real-time Developer Notifications: keep entitlement in sync with the subscription
// lifecycle (renewal/cancel/grace/hold/expiry/refund) so failed payments downgrade.
var rtdn_1 = require("./subscriptions/rtdn");
Object.defineProperty(exports, "blypPlayRtdn", { enumerable: true, get: function () { return rtdn_1.blypPlayRtdn; } });
// Notification spine: scheduled dispatcher + live-alert fan-out triggers
var dispatcher_1 = require("./notifications/dispatcher");
Object.defineProperty(exports, "notificationDispatch", { enumerable: true, get: function () { return dispatcher_1.notificationDispatch; } });
Object.defineProperty(exports, "notificationOnCreate", { enumerable: true, get: function () { return dispatcher_1.notificationOnCreate; } });
var liveAlerts_1 = require("./notifications/liveAlerts");
Object.defineProperty(exports, "onLiveStreamCreate", { enumerable: true, get: function () { return liveAlerts_1.onLiveStreamCreate; } });
Object.defineProperty(exports, "onLiveStreamGoLive", { enumerable: true, get: function () { return liveAlerts_1.onLiveStreamGoLive; } });
var topicEvents_1 = require("./notifications/topicEvents");
Object.defineProperty(exports, "onTopicEventCreate", { enumerable: true, get: function () { return topicEvents_1.onTopicEventCreate; } });
// Direct-message push: new inbox message -> push to recipients (WhatsApp-style)
var messageNotify_1 = require("./notifications/messageNotify");
Object.defineProperty(exports, "onDirectMessageCreate", { enumerable: true, get: function () { return messageNotify_1.onDirectMessageCreate; } });
// Welcome product tour inbox item when onboarding completes
var welcomeTour_1 = require("./notifications/welcomeTour");
Object.defineProperty(exports, "onUserOnboardedWelcomeTour", { enumerable: true, get: function () { return welcomeTour_1.onUserOnboardedWelcomeTour; } });
// Audio calls: LiveKit token mint + incoming-call push
var livekit_1 = require("./calls/livekit");
Object.defineProperty(exports, "mintLiveKitToken", { enumerable: true, get: function () { return livekit_1.mintLiveKitToken; } });
Object.defineProperty(exports, "onCallCreate", { enumerable: true, get: function () { return livekit_1.onCallCreate; } });
var teamNotify_1 = require("./teams/teamNotify");
Object.defineProperty(exports, "onTeamJoinRequestCreate", { enumerable: true, get: function () { return teamNotify_1.onTeamJoinRequestCreate; } });
Object.defineProperty(exports, "onTeamJoinRequestDecision", { enumerable: true, get: function () { return teamNotify_1.onTeamJoinRequestDecision; } });
Object.defineProperty(exports, "onTeamBattleCreate", { enumerable: true, get: function () { return teamNotify_1.onTeamBattleCreate; } });
Object.defineProperty(exports, "onTeamGroupMessageCreate", { enumerable: true, get: function () { return teamNotify_1.onTeamGroupMessageCreate; } });
var auditionFlow_1 = require("./teams/auditionFlow");
Object.defineProperty(exports, "onAuditionMatched", { enumerable: true, get: function () { return auditionFlow_1.onAuditionMatched; } });
Object.defineProperty(exports, "auditionOpponentSweep", { enumerable: true, get: function () { return auditionFlow_1.auditionOpponentSweep; } });
Object.defineProperty(exports, "onAuditionBattleComplete", { enumerable: true, get: function () { return auditionFlow_1.onAuditionBattleComplete; } });
Object.defineProperty(exports, "onAuditionDecision", { enumerable: true, get: function () { return auditionFlow_1.onAuditionDecision; } });
// Presence watches: "notify me when <person> is next on the app"
var presenceWatch_1 = require("./presence/presenceWatch");
Object.defineProperty(exports, "onUserPresenceOnline", { enumerable: true, get: function () { return presenceWatch_1.onUserPresenceOnline; } });
Object.defineProperty(exports, "presenceOfflineSweep", { enumerable: true, get: function () { return presenceWatch_1.presenceOfflineSweep; } });
var battleNotify_1 = require("./battles/battleNotify");
Object.defineProperty(exports, "onBattleCreate", { enumerable: true, get: function () { return battleNotify_1.onBattleCreate; } });
Object.defineProperty(exports, "onBattleStatusChange", { enumerable: true, get: function () { return battleNotify_1.onBattleStatusChange; } });
Object.defineProperty(exports, "onBattleReminderCreate", { enumerable: true, get: function () { return battleNotify_1.onBattleReminderCreate; } });
// Battle glory stats: idempotent per-creator aggregate for the battle leaderboard
var battleStats_1 = require("./battles/battleStats");
Object.defineProperty(exports, "onBattleComplete", { enumerable: true, get: function () { return battleStats_1.onBattleComplete; } });
// "Blyp it" — premium AI compose-and-send assistant
var compose_1 = require("./assistant/compose");
Object.defineProperty(exports, "blypAssistantCompose", { enumerable: true, get: function () { return compose_1.blypAssistantCompose; } });
// Dating — like/pass writes (server-owned matches; Phase 5 rate limits + age gate)
var handlers_4 = require("./dating/handlers");
Object.defineProperty(exports, "blypDatingLike", { enumerable: true, get: function () { return handlers_4.blypDatingLike; } });
Object.defineProperty(exports, "blypDatingPass", { enumerable: true, get: function () { return handlers_4.blypDatingPass; } });
// Clubs Phase 3 — server-minted earnable badges (live host / marble podium / early)
var handlers_5 = require("./badges/handlers");
Object.defineProperty(exports, "blypSyncBadgeAwards", { enumerable: true, get: function () { return handlers_5.blypSyncBadgeAwards; } });
Object.defineProperty(exports, "onLiveSessionBadgeAward", { enumerable: true, get: function () { return handlers_5.onLiveSessionBadgeAward; } });
// Gemini proxy (P7.4): keep the API key server-side; client calls authenticated relay
var geminiProxy_1 = require("./assistant/geminiProxy");
Object.defineProperty(exports, "geminiProxy", { enumerable: true, get: function () { return geminiProxy_1.geminiProxy; } });
// Server-authoritative daily streak engine + reminder sweep
var streak_1 = require("./economy/streak");
Object.defineProperty(exports, "blypClaimDailyReward", { enumerable: true, get: function () { return streak_1.blypClaimDailyReward; } });
Object.defineProperty(exports, "streakReminderSweep", { enumerable: true, get: function () { return streak_1.streakReminderSweep; } });
// Account-deletion worker (GDPR/CCPA, Google Play data-deletion): purge user data
var deletionWorker_1 = require("./account/deletionWorker");
Object.defineProperty(exports, "processAccountDeletion", { enumerable: true, get: function () { return deletionWorker_1.processAccountDeletion; } });
// Server-side text moderation (P0.2): authoritative comment + DM filtering
var textModeration_1 = require("./moderation/textModeration");
Object.defineProperty(exports, "moderateComment", { enumerable: true, get: function () { return textModeration_1.moderateComment; } });
Object.defineProperty(exports, "moderateDirectMessage", { enumerable: true, get: function () { return textModeration_1.moderateDirectMessage; } });
// Server-side image moderation (P0.1): Vision SafeSearch on post media (env-gated)
var mediaModeration_1 = require("./moderation/mediaModeration");
Object.defineProperty(exports, "moderatePostMedia", { enumerable: true, get: function () { return mediaModeration_1.moderatePostMedia; } });
const reportAutoAction_1 = require("./moderation/reportAutoAction");
const admin = __importStar(require("firebase-admin"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jwks_rsa_1 = __importDefault(require("jwks-rsa"));
// fetch import removed (unused)
// NOTE: These native/heavy modules can make the Functions emulator time out while it
// tries to load user code and discover triggers. Lazy-load them only when invoked.
let _storage = null;
function getStorage() {
    if (!_storage) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Storage } = require('@google-cloud/storage');
        _storage = new Storage();
    }
    return _storage;
}
let _ffmpeg = null;
function getFfmpeg() {
    if (!_ffmpeg) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        _ffmpeg = require('fluent-ffmpeg');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ffmpegPath = require('ffmpeg-static');
        if (ffmpegPath) {
            try {
                _ffmpeg.setFfmpegPath(ffmpegPath);
            }
            catch (_a) {
                // ignore; fluent-ffmpeg will fall back to PATH
            }
        }
    }
    return _ffmpeg;
}
let _sharp = null;
function getSharp() {
    if (!_sharp) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        _sharp = require('sharp');
    }
    return _sharp;
}
// Helper: parse stream path (legacy & new layouts)
function parseStreamPath(filePath) {
    const parts = filePath.split('/');
    // Expected patterns:
    // 1) streams/<streamId>/segment_10.mp4
    // 2) streams/<userId>/<streamId>/segment_10.mp4
    // 3) streams/<streamId>/raw/segment_10.mp4
    let streamId = null;
    let variant = 'unknown';
    if (parts.length >= 3 && parts[0] === 'streams') {
        if (/^segment_\d+/.test(parts[2]) || parts[2] === 'raw') {
            // pattern 1 or 3
            streamId = parts[1];
            variant = parts[2] === 'raw' ? 'raw-folder' : 'flat';
        }
        else if (parts.length >= 4 && /^segment_\d+/.test(parts[3])) {
            // pattern 2 (streams/<userId>/<streamId>/segment_X.mp4)
            streamId = parts[2];
            variant = 'nested-user-stream';
        }
        else if (parts.length >= 5 && parts[3] === 'raw' && /^segment_\d+/.test(parts[4])) {
            streamId = parts[2];
            variant = 'nested-user-stream-raw';
        }
    }
    // Derive root directory (where qualities/playlists should live) ignoring optional 'raw' folder
    // Examples:
    // streams/<streamId>/segment_5.mp4        -> streams/<streamId>
    // streams/<userId>/<streamId>/segment_5.mp4 -> streams/<userId>/<streamId>
    // streams/<streamId>/raw/segment_5.mp4   -> streams/<streamId>
    // streams/<userId>/<streamId>/raw/segment_5.mp4 -> streams/<userId>/<streamId>
    let rootDir = null;
    if (streamId) {
        if (variant.startsWith('nested-user-stream')) {
            // parts: [streams, userId, streamId, (raw?), segment_X.mp4]
            rootDir = ['streams', parts[1], streamId].join('/');
        }
        else {
            // flat or raw-folder: [streams, streamId, ...]
            rootDir = ['streams', streamId].join('/');
        }
    }
    return { streamId, variant, parts, rootDir };
}
// Initialize Firebase Admin (use project default bucket, which may use the firebasestorage.app domain)
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
// ============================================================================
// AUTH BRIDGE: Cognito JWT -> Firebase Custom Token
// - Needed so Firestore rules using request.auth.uid work with Cognito sub ids.
// - Verifies Cognito ID token signature via JWKS.
// Env required (same as backend/blyp-live-service):
//   COGNITO_REGION
//   COGNITO_USER_POOL_ID
// ============================================================================
const cognitoRegion = process.env.COGNITO_REGION;
const cognitoUserPoolId = process.env.COGNITO_USER_POOL_ID;
const getCognitoVerifier = (() => {
    let client = null;
    let issuer = null;
    return () => {
        if (!cognitoRegion || !cognitoUserPoolId) {
            throw new Error('[config] COGNITO_REGION and COGNITO_USER_POOL_ID are required');
        }
        if (!client) {
            const jwksUri = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}/.well-known/jwks.json`;
            client = (0, jwks_rsa_1.default)({
                jwksUri,
                cache: true,
                cacheMaxEntries: 10,
                cacheMaxAge: 10 * 60 * 1000,
            });
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
exports.mintFirebaseCustomToken = functions.https.onRequest(async (req, res) => {
    // CORS (no wildcard; allowlist via CORS_ALLOWED_ORIGINS)
    (() => {
        const origin = String(req.headers.origin || '').trim();
        const allowlist = String(process.env.CORS_ALLOWED_ORIGINS || '')
            .split(',')
            .map((s) => s.trim())
            .filter((s) => !!s && s !== '*');
        if (origin && allowlist.includes(origin)) {
            res.set('Access-Control-Allow-Origin', origin);
            res.set('Vary', 'Origin');
        }
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    })();
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }
    try {
        const authHeader = String(req.headers.authorization || '');
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            res.status(401).json({ error: 'Missing or invalid Authorization header' });
            return;
        }
        const token = match[1];
        const { issuer } = getCognitoVerifier();
        const decoded = await new Promise((resolve, reject) => {
            jsonwebtoken_1.default.verify(token, getKey, {
                algorithms: ['RS256'],
                issuer: issuer || undefined,
            }, (err, payload) => {
                if (err)
                    reject(err);
                else
                    resolve(payload);
            });
        });
        const sub = String((decoded === null || decoded === void 0 ? void 0 : decoded.sub) || '');
        if (!sub) {
            res.status(401).json({ error: 'Invalid token: missing sub' });
            return;
        }
        // Mint Firebase custom token with uid == Cognito sub.
        const firebaseToken = await admin.auth().createCustomToken(sub);
        res.status(200).json({ uid: sub, firebaseToken });
    }
    catch (e) {
        console.error('[mintFirebaseCustomToken] 401 error:', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        res.status(401).json({ error: 'Invalid token', detail: (e === null || e === void 0 ? void 0 : e.message) || String(e) });
    }
});
/**
 * Video Transcoding Function - Processes uploaded segments into multiple qualities
 * Triggered when a video segment is uploaded to Firebase Storage
 */
exports.processVideoSegment = functions
    .runWith({
    timeoutSeconds: 540,
    memory: '2GB',
    maxInstances: 100
})
    // Use default bucket trigger (avoid hard-coding bucket name to remain compatible with firebasestorage.app domain)
    .storage.object()
    .onFinalize(async (object) => {
    var _a;
    try {
        // Wave 0 containment: disable expensive FFmpeg processing until Storage writes are owner-scoped.
        if (process.env.ENABLE_STORAGE_FFMPEG !== '1') {
            console.log('🛑 processVideoSegment disabled (Wave 0 containment)');
            return null;
        }
        // Hard size cap even when FFmpeg is re-enabled (abuse / cost containment).
        const MAX_SEGMENT_BYTES = 50 * 1024 * 1024; // 50 MiB
        const objectSize = Number(object.size || 0);
        if (objectSize > MAX_SEGMENT_BYTES) {
            console.log('🛑 processVideoSegment skipped: object too large', { size: objectSize, max: MAX_SEGMENT_BYTES });
            return null;
        }
        const filePath = object.name;
        const bucket = object.bucket;
        // Guard: required path & naming
        if (!filePath || !filePath.includes('streams/') || !filePath.includes('segment_')) {
            return null;
        }
        console.log(`🎬 Processing video segment: ${filePath}`);
        const { streamId, variant, parts, rootDir } = parseStreamPath(filePath);
        if (!streamId) {
            console.log('❌ Unable to parse streamId from path', { filePath, parts });
            return null;
        }
        if (!rootDir) {
            console.log('❌ Unable to determine rootDir for path', { filePath, parts });
            return null;
        }
        const rootDirStr = rootDir; // non-null (guarded)
        const segmentName = ((_a = parts.find(p => /^segment_\d+/.test(p))) === null || _a === void 0 ? void 0 : _a.replace(/\.mp4$/, '')) || path.basename(filePath, path.extname(filePath));
        console.log(`🧩 Parsed streamId=${streamId} variant=${variant} segmentName=${segmentName} rootDir=${rootDirStr}`);
        // Download original segment
        const tempDir = os.tmpdir();
        const sourceFile = path.join(tempDir, `source_${Date.now()}_${segmentName}.mp4`);
        await getStorage().bucket(bucket).file(filePath).download({ destination: sourceFile });
        console.log('📥 Downloaded source to', sourceFile);
        // Determine segment index for ramp decisions
        const segmentIndex = parseInt(segmentName.replace('segment_', ''), 10);
        // Base quality ladder
        let baseQualities = [
            { name: '240p', width: 426, height: 240, bitrate: '400k', fps: 24 },
            { name: '480p', width: 854, height: 480, bitrate: '1000k', fps: 30 },
            { name: '720p', width: 1280, height: 720, bitrate: '2500k', fps: 30 },
            { name: '1080p', width: 1920, height: 1080, bitrate: '5000k', fps: 30 }
        ];
        // Ramp-up: delay 1080p for first 3 segments to reduce startup latency
        if (segmentIndex < 3) {
            baseQualities = baseQualities.filter(q => q.name !== '1080p');
        }
        // Sequential retry loop (simpler & avoids TS nullable capture issues). Max 2 attempts per quality.
        const processedSegments = [];
        for (const q of baseQualities) {
            let attempt = 0;
            while (attempt < 2) {
                try {
                    const result = await transcodeSegment(sourceFile, q, streamId, segmentName, bucket, rootDirStr);
                    if (result)
                        processedSegments.push(result);
                    break;
                }
                catch (err) {
                    attempt++;
                    console.warn(`⚠️ Transcode retry ${attempt} for ${q.name} (segment ${segmentName})`);
                    if (attempt >= 2) {
                        console.error(`❌ Giving up on quality ${q.name} for segment ${segmentName}`, err);
                    }
                }
            }
        }
        await updateStreamManifest(streamId, segmentName, processedSegments);
        await generateHLSPlaylist(streamId, segmentName, rootDirStr);
        await updateProcessingAnalytics(streamId, processedSegments.length);
        fs.unlinkSync(sourceFile);
        console.log(`✅ Finished processing ${segmentName}`);
        return null;
    }
    catch (error) {
        console.error('❌ Video processing error:', error);
        throw error;
    }
});
/**
 * Transcode video segment to specific quality
 */
async function transcodeSegment(sourceFile, quality, streamId, segmentName, bucket, rootDir // using any due to upstream nullable inference; guarded prior to call
) {
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        const outputFile = path.join(tempDir, `${segmentName}_${quality.name}.mp4`);
        console.log(`🔄 Transcoding to ${quality.name}: ${outputFile}`);
        getFfmpeg()(sourceFile)
            .videoCodec('libx264')
            .audioCodec('aac')
            .size(`${quality.width}x${quality.height}`)
            .videoBitrate(quality.bitrate)
            .fps(quality.fps)
            .format('mp4')
            .outputOptions([
            '-preset fast',
            '-crf 23',
            '-maxrate ' + quality.bitrate,
            '-bufsize ' + (parseInt(quality.bitrate) * 2) + 'k',
            '-g ' + (quality.fps * 2), // Keyframe interval
            '-keyint_min ' + quality.fps,
            '-sc_threshold 0',
            '-profile:v baseline',
            '-level 3.0'
        ])
            .on('end', async () => {
            try {
                // Upload transcoded segment
                const destinationPath = `${rootDir}/qualities/${quality.name}/${segmentName}.mp4`;
                await getStorage().bucket(bucket).upload(outputFile, {
                    destination: destinationPath,
                    metadata: {
                        contentType: 'video/mp4',
                        cacheControl: 'public, max-age=300', // 5 minutes cache
                        metadata: {
                            quality: quality.name,
                            streamId: streamId,
                            segmentName: segmentName,
                            processedAt: new Date().toISOString()
                        }
                    }
                });
                // Get public URL
                const [url] = await getStorage().bucket(bucket).file(destinationPath).getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
                });
                // Cleanup temp file
                fs.unlinkSync(outputFile);
                console.log(`✅ Uploaded ${quality.name}: ${destinationPath}`);
                resolve({
                    quality: quality.name,
                    url: url,
                    path: destinationPath,
                    width: quality.width,
                    height: quality.height,
                    bitrate: quality.bitrate
                });
            }
            catch (error) {
                console.error(`❌ Upload error for ${quality.name}:`, error);
                reject(error);
            }
        })
            .on('error', (error) => {
            console.error(`❌ Transcoding error for ${quality.name}:`, error);
            // Cleanup on error
            if (fs.existsSync(outputFile)) {
                fs.unlinkSync(outputFile);
            }
            reject(error);
        })
            .save(outputFile);
    });
}
/**
 * Update stream manifest with processed segments
 */
async function updateStreamManifest(streamId, segmentName, processedSegments) {
    try {
        const segmentNumber = parseInt(segmentName.replace('segment_', ''));
        const qualitiesMap = processedSegments.reduce((acc, segment) => {
            acc[segment.quality] = {
                url: segment.url,
                path: segment.path,
                width: segment.width,
                height: segment.height,
                bitrate: segment.bitrate,
                processedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            return acc;
        }, {});
        await db.collection('liveStreams').doc(streamId).update({
            [`segments.${segmentNumber}.qualities`]: qualitiesMap,
            [`segments.${segmentNumber}.processed`]: true,
            [`segments.${segmentNumber}.processedAt`]: admin.firestore.FieldValue.serverTimestamp(),
            availableQualities: processedSegments.map(s => s.quality),
            lastProcessedSegment: segmentNumber,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`📝 Updated manifest for segment ${segmentNumber}`);
    }
    catch (error) {
        console.error('❌ Manifest update error:', error);
        throw error;
    }
}
/**
 * Generate HLS playlist for adaptive streaming
 */
async function generateHLSPlaylist(streamId, segmentName, rootDir) {
    try {
        // Get stream data
        const streamDoc = await db.collection('liveStreams').doc(streamId).get();
        const streamData = streamDoc.data();
        if (!streamData || !streamData.segments) {
            return;
        }
        // Generate master playlist (after trimming window)
        const masterPlaylist = generateMasterPlaylist(streamData);
        // Generate quality-specific playlists
        const qualityPlaylists = generateQualityPlaylists(streamData);
        // Upload playlists to storage
        await Promise.all([
            uploadPlaylist(rootDir, 'master.m3u8', masterPlaylist),
            ...Object.entries(qualityPlaylists).map(([quality, playlist]) => uploadPlaylist(rootDir, `${quality}.m3u8`, playlist))
        ]);
        console.log(`📋 Generated HLS playlists for stream ${streamId}`);
    }
    catch (error) {
        console.error('❌ Playlist generation error:', error);
        throw error;
    }
}
/**
 * Generate master HLS playlist
 */
function generateMasterPlaylist(streamData) {
    let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    const qualityInfo = {
        '240p': { bandwidth: 400000, resolution: '426x240' },
        '480p': { bandwidth: 1000000, resolution: '854x480' },
        '720p': { bandwidth: 2500000, resolution: '1280x720' },
        '1080p': { bandwidth: 5000000, resolution: '1920x1080' }
    };
    if (streamData.availableQualities) {
        streamData.availableQualities.forEach((quality) => {
            const info = qualityInfo[quality];
            if (info) {
                playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${info.bandwidth},RESOLUTION=${info.resolution}\n`;
                playlist += `${quality}.m3u8\n`;
            }
        });
    }
    return playlist;
}
/**
 * Generate quality-specific playlists
 */
function generateQualityPlaylists(streamData) {
    const playlists = {};
    if (!streamData.availableQualities || !streamData.segments) {
        return playlists;
    }
    // Collect and sort segment numbers numerically to maintain sequence
    let segmentEntries = Object.entries(streamData.segments)
        .map(([num, data]) => [parseInt(num, 10), data])
        .filter(([n]) => !isNaN(n))
        .sort((a, b) => a[0] - b[0]);
    // Sliding window to keep only latest 40 segments in playlists (does not delete data, just playlist references)
    const WINDOW = 40;
    if (segmentEntries.length > WINDOW) {
        segmentEntries = segmentEntries.slice(segmentEntries.length - WINDOW);
    }
    streamData.availableQualities.forEach((quality) => {
        // Determine media sequence (first segment number or 0)
        const firstSegmentNumber = segmentEntries.length > 0 ? segmentEntries[0][0] : 0;
        let playlist = '#EXTM3U\n';
        playlist += '#EXT-X-VERSION:3\n';
        playlist += '#EXT-X-INDEPENDENT-SEGMENTS\n';
        playlist += `#EXT-X-TARGETDURATION:10\n`; // conservative upper bound
        playlist += `#EXT-X-MEDIA-SEQUENCE:${firstSegmentNumber}\n\n`;
        let segmentCount = 0;
        for (const [segmentNumber, segmentData] of segmentEntries) {
            if (segmentData.qualities && segmentData.qualities[quality]) {
                // Duration currently fixed; could be dynamic if stored later
                playlist += '#EXTINF:2.0,\n';
                // Stored path: streams/<streamId>/qualities/<quality>/segment_<n>.mp4
                // Playlist lives in: streams/<streamId>/playlists/<quality>.m3u8
                // So we reference via relative path below:
                playlist += `../qualities/${quality}/segment_${segmentNumber}.mp4\n`;
                segmentCount++;
            }
        }
        // Optionally append #EXT-X-ENDLIST if stream ended (we infer by status)
        if (streamData.status && streamData.status !== 'live') {
            playlist += '#EXT-X-ENDLIST\n';
        }
        playlists[quality] = playlist;
        console.log(`🎼 Built playlist for ${quality}: segments=${segmentCount}`);
    });
    return playlists;
}
/**
 * Upload playlist to storage
 */
async function uploadPlaylist(rootDir, fileName, content) {
    try {
        // Use default bucket from Admin SDK (avoids hard-coded project-specific bucket name)
        const bucketRef = admin.storage().bucket();
        const file = bucketRef.file(`${rootDir}/playlists/${fileName}`);
        await file.save(content, {
            metadata: {
                contentType: 'application/vnd.apple.mpegurl',
                cacheControl: 'public, max-age=30', // 30 seconds cache for live content
            }
        });
        console.log(`📋 Uploaded playlist: ${fileName}`);
    }
    catch (error) {
        console.error(`❌ Playlist upload error for ${fileName}:`, error);
        throw error;
    }
}
/**
 * Stream Analytics Function - Real-time viewer and performance tracking
 */
exports.updateStreamAnalytics = functions.firestore
    .document('liveStreams/{streamId}')
    .onUpdate(async (change, context) => {
    try {
        const streamId = context.params.streamId;
        const beforeData = change.before.data();
        const afterData = change.after.data();
        // Calculate metrics
        const viewCountDelta = (afterData.viewCount || 0) - (beforeData.viewCount || 0);
        const newSegments = Object.keys(afterData.segments || {}).length -
            Object.keys(beforeData.segments || {}).length;
        // Update analytics
        await updateAnalyticsCollection(streamId, {
            viewCountDelta,
            newSegments,
            totalViewers: afterData.viewCount || 0,
            totalSegments: Object.keys(afterData.segments || {}).length,
            lastUpdate: admin.firestore.FieldValue.serverTimestamp()
        });
        // Check for alerts
        await checkStreamHealth(streamId, afterData);
        console.log(`📊 Analytics updated for stream ${streamId}: +${viewCountDelta} viewers, +${newSegments} segments`);
    }
    catch (error) {
        console.error('❌ Analytics update error:', error);
    }
});
/**
 * Update analytics collection
 */
async function updateAnalyticsCollection(streamId, metrics) {
    const analyticsRef = db.collection('streamAnalytics').doc(streamId);
    await analyticsRef.set(Object.assign(Object.assign({ streamId }, metrics), { hourlyStats: admin.firestore.FieldValue.arrayUnion(Object.assign({ timestamp: new Date() }, metrics)) }), { merge: true });
}
/**
 * Check stream health and trigger alerts
 */
async function checkStreamHealth(streamId, streamData) {
    var _a;
    const health = streamData.streamHealth || {};
    const now = Date.now();
    const lastUpdate = ((_a = streamData.lastUpdated) === null || _a === void 0 ? void 0 : _a.toMillis()) || now;
    const timeSinceUpdate = now - lastUpdate;
    // Alert conditions
    const alerts = [];
    if (timeSinceUpdate > 30000) {
        alerts.push('Stream inactive for 30+ seconds');
    }
    if (health.errorRate > 0.1) {
        alerts.push('High error rate detected');
    }
    if (health.bufferHealth < 0.2) {
        alerts.push('Poor buffer health');
    }
    if (alerts.length > 0) {
        await sendHealthAlert(streamId, alerts);
    }
}
/**
 * Send health alert
 */
async function sendHealthAlert(streamId, alerts) {
    console.warn(`⚠️ Health alert for stream ${streamId}:`, alerts);
    // In production, this would send to monitoring systems
    await db.collection('streamAlerts').add({
        streamId,
        alerts,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        severity: 'warning'
    });
}
/**
 * Stream Cleanup Function - Remove old segments and data
 */
/**
 * Stream Cleanup Function - Remove old segments and data
 */
exports.cleanupOldStreams = functions.pubsub
    .schedule('every 1 hours')
    .onRun(async (context) => {
    try {
        const cutoffTime = new Date();
        cutoffTime.setHours(cutoffTime.getHours() - 24); // 24 hours ago
        // Find old streams
        const oldStreamsQuery = await db.collection('liveStreams')
            .where('status', '!=', 'live')
            .where('lastUpdated', '<', cutoffTime)
            .limit(100)
            .get();
        console.log(`🧹 Found ${oldStreamsQuery.size} old streams to cleanup`);
        // Cleanup each stream
        for (const doc of oldStreamsQuery.docs) {
            await cleanupStream(doc.id, doc.data());
        }
        console.log(`✅ Cleanup completed for ${oldStreamsQuery.size} streams`);
    }
    catch (error) {
        console.error('❌ Cleanup error:', error);
    }
});
/**
 * Cleanup individual stream
 */
async function cleanupStream(streamId, streamData) {
    try {
        console.log(`🗑️ Cleaning up stream: ${streamId}`);
        // Delete storage files
        const bucketRef = admin.storage().bucket();
        const [files] = await bucketRef.getFiles({
            prefix: `streams/${streamId}/`
        });
        // Delete files in batches
        const deletePromises = files.map(file => file.delete());
        await Promise.all(deletePromises);
        // Delete Firestore documents
        await Promise.all([
            db.collection('liveStreams').doc(streamId).delete(),
            db.collection('streamAnalytics').doc(streamId).delete()
        ]);
        console.log(`✅ Cleaned up stream ${streamId}: ${files.length} files deleted`);
    }
    catch (error) {
        console.error(`❌ Error cleaning up stream ${streamId}:`, error);
    }
}
/**
 * Update processing analytics
 */
async function updateProcessingAnalytics(streamId, qualityCount) {
    try {
        await db.collection('processingAnalytics').doc(streamId).set({
            streamId,
            totalProcessed: admin.firestore.FieldValue.increment(1),
            qualitiesGenerated: admin.firestore.FieldValue.increment(qualityCount),
            lastProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
            processingHistory: admin.firestore.FieldValue.arrayUnion({
                timestamp: new Date(),
                qualityCount,
                processedAt: new Date().toISOString()
            })
        }, { merge: true });
    }
    catch (error) {
        console.error('❌ Processing analytics error:', error);
    }
}
/**
 * Thumbnail Generation Function
 */
exports.generateThumbnails = functions
    .runWith({
    timeoutSeconds: 60,
    memory: '1GB'
})
    .storage.object()
    .onFinalize(async (object) => {
    var _a;
    try {
        // Wave 0 containment: disable expensive FFmpeg thumbnails until Storage writes are owner-scoped.
        if (process.env.ENABLE_STORAGE_FFMPEG !== '1') {
            console.log('🛑 generateThumbnails disabled (Wave 0 containment)');
            return null;
        }
        const MAX_SEGMENT_BYTES = 50 * 1024 * 1024; // 50 MiB
        const objectSize = Number(object.size || 0);
        if (objectSize > MAX_SEGMENT_BYTES) {
            console.log('🛑 generateThumbnails skipped: object too large', { size: objectSize, max: MAX_SEGMENT_BYTES });
            return null;
        }
        const filePath = object.name;
        const bucket = object.bucket;
        if (!filePath || !filePath.includes('streams/') || !filePath.includes('segment_')) {
            return null;
        }
        console.log(`🖼️ Generating thumbnail for: ${filePath}`);
        // Use unified parser to reliably extract streamId across path variants
        const { streamId, rootDir } = parseStreamPath(filePath);
        if (!streamId || !rootDir) {
            console.log('❌ Thumbnail generation: unable to determine streamId/rootDir from path', filePath);
            return null;
        }
        // Only generate a thumbnail every 10th segment to reduce load
        const segmentIndex = parseInt(((_a = path.basename(filePath).match(/segment_(\d+)/)) === null || _a === void 0 ? void 0 : _a[1]) || '0', 10);
        if (segmentIndex % 10 !== 0) {
            console.log('🛑 Skipping thumbnail (interval rule) for segment', segmentIndex);
            return null;
        }
        // Download video
        const tempDir = os.tmpdir();
        const videoFile = path.join(tempDir, `video_${Date.now()}.mp4`);
        const thumbnailFile = path.join(tempDir, `thumb_${Date.now()}.jpg`);
        await getStorage().bucket(bucket).file(filePath).download({ destination: videoFile });
        // Extract thumbnail using FFmpeg
        await new Promise((resolve, reject) => {
            getFfmpeg()(videoFile)
                .screenshots({
                timestamps: ['50%'],
                filename: path.basename(thumbnailFile),
                folder: path.dirname(thumbnailFile),
                size: '320x180'
            })
                .on('end', () => resolve())
                .on('error', (error) => reject(error));
        });
        // Optimize thumbnail with Sharp
        const optimizedThumbnail = path.join(tempDir, `optimized_${Date.now()}.jpg`);
        await getSharp()(thumbnailFile)
            .resize(320, 180, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toFile(optimizedThumbnail);
        // Upload thumbnail
        const thumbnailPath = `${rootDir}/thumbnails/latest.jpg`;
        await getStorage().bucket(bucket).upload(optimizedThumbnail, {
            destination: thumbnailPath,
            metadata: {
                contentType: 'image/jpeg',
                cacheControl: 'public, max-age=3600'
            }
        });
        // Update stream document
        const [url] = await getStorage().bucket(bucket).file(thumbnailPath).getSignedUrl({
            action: 'read',
            expires: Date.now() + 24 * 60 * 60 * 1000
        });
        await db.collection('liveStreams').doc(streamId).update({
            latestThumbnail: url,
            thumbnailUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        // Cleanup
        [videoFile, thumbnailFile, optimizedThumbnail].forEach(file => {
            if (fs.existsSync(file)) {
                fs.unlinkSync(file);
            }
        });
        console.log(`✅ Thumbnail generated for stream ${streamId}`);
        return null; // Explicit return to satisfy TypeScript (no value needed)
    }
    catch (error) {
        console.error('❌ Thumbnail generation error:', error);
        return null; // Ensure all code paths return
    }
});
// Removed duplicate parseStreamPath & processVideoSegment definitions (now consolidated at top of file)
/**
 * Analytics Retention Purge Function
 * Scheduled job enforcing 90-day (or configured) retention by deleting expired analytics events.
 * Selection criteria: documents in `analytics` where `retentionExpiresAt` < now and capped per run.
 * Safety: limits deletions to BATCH_LIMIT per invocation to avoid overload; subsequent runs continue.
 */
exports.purgeExpiredAnalytics = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async () => {
    const now = Date.now();
    const BATCH_LIMIT = 500; // safety cap per execution
    let deleted = 0;
    try {
        const snap = await db.collection('analytics')
            .where('retentionExpiresAt', '<', now)
            .limit(BATCH_LIMIT)
            .get();
        if (snap.empty) {
            console.log('🧹 Analytics purge: no expired documents');
            return null;
        }
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        deleted = snap.size;
        await db.collection('analyticsPurgeLog').add({
            runAt: admin.firestore.FieldValue.serverTimestamp(),
            deletedCount: deleted,
            batchLimit: BATCH_LIMIT
        });
        console.log(`✅ Analytics purge complete. Deleted ${deleted} expired events.`);
    }
    catch (err) {
        console.error('❌ Analytics purge error:', err);
        await db.collection('analyticsPurgeLog').add({
            runAt: admin.firestore.FieldValue.serverTimestamp(),
            error: (err === null || err === void 0 ? void 0 : err.message) || String(err),
            deletedCount: deleted
        });
    }
    return null;
});
/**
 * Report Aggregation Function
 * Ingests new reports and upserts an aggregated moderationQueue document per target.
 * Document key pattern: <targetType>_<targetId>
 * Fields maintained:
 *  - targetType, targetId
 *  - totalReports
 *  - reasons: { reasonCode: count }
 *  - firstReportedAt, lastReportedAt
 *  - openReportIds (trimmed window)
 *  - status: 'pending_review' | 'under_review' | 'resolved'
 * This is additive; original report docs remain unchanged.
 */
exports.aggregateReport = functions.firestore
    .document('reports/{reportId}')
    .onCreate(async (snap, context) => {
    const data = snap.data();
    const { targetType, targetId, reasonCode } = data;
    if (!targetType || !targetId || !reasonCode) {
        console.log('⚠️ Report missing required aggregation fields');
        return null;
    }
    const queueDocId = `${targetType}_${targetId}`;
    const ref = db.collection('moderationQueue').doc(queueDocId);
    const reporterId = typeof data.reporterId === 'string' && data.reporterId ? data.reporterId : null;
    let aggregated = null;
    try {
        aggregated = await db.runTransaction(async (tx) => {
            const existing = await tx.get(ref);
            const now = admin.firestore.FieldValue.serverTimestamp();
            if (!existing.exists) {
                const reasons = { [reasonCode]: 1 };
                const reporterIds = reporterId ? [reporterId] : [];
                const distinctReporters = reporterIds.length;
                tx.set(ref, {
                    targetType,
                    targetId,
                    totalReports: 1,
                    reasons,
                    reporterIds,
                    distinctReporters,
                    firstReportedAt: now,
                    lastReportedAt: now,
                    openReportIds: [snap.id],
                    status: 'pending_review',
                    priorityScore: 1 // simple initial heuristic
                });
                return { totalReports: 1, reasons, distinctReporters };
            }
            else {
                const cur = existing.data() || {};
                const reasons = cur.reasons || {};
                reasons[reasonCode] = (reasons[reasonCode] || 0) + 1;
                const openReportIds = Array.isArray(cur.openReportIds) ? [snap.id, ...cur.openReportIds].slice(0, 25) : [snap.id];
                const totalReports = (cur.totalReports || 0) + 1;
                let reporterIds = Array.isArray(cur.reporterIds)
                    ? cur.reporterIds.filter((id) => typeof id === 'string')
                    : [];
                if (reporterId && !reporterIds.includes(reporterId)) {
                    reporterIds = [reporterId, ...reporterIds].slice(0, 100);
                }
                const distinctReporters = reporterIds.length > 0
                    ? reporterIds.length
                    : (Number(cur.distinctReporters) || totalReports);
                // Simple priority heuristic: totalReports + distinctReasons * 0.5
                const distinctReasons = Object.keys(reasons).length;
                const priorityScore = totalReports + distinctReasons * 0.5;
                tx.update(ref, {
                    reasons,
                    totalReports,
                    reporterIds,
                    distinctReporters,
                    lastReportedAt: now,
                    openReportIds,
                    priorityScore
                });
                return { totalReports, reasons, distinctReporters };
            }
        });
        console.log(`🛡️ Aggregated report into moderationQueue/${queueDocId}`);
    }
    catch (err) {
        console.error('❌ Aggregation error:', err);
    }
    // P0.3: auto-action + alerting on the accumulated signal (best-effort, never throws).
    if (aggregated) {
        try {
            await (0, reportAutoAction_1.evaluateAutoAction)(db, {
                targetType,
                targetId,
                reasonCode,
                totalReports: aggregated.totalReports,
                distinctReporters: aggregated.distinctReporters,
                reasons: aggregated.reasons,
                reportId: snap.id,
            });
        }
        catch (err) {
            console.error('❌ Auto-action error:', err);
        }
    }
    return null;
});
/**
 * Daily Moderation Queue Priority Recalculation
 * Recomputes priorityScore factoring aging (older unresolved targets increase score modestly).
 */
exports.recalcModerationQueue = functions.pubsub
    .schedule('every 24 hours')
    .onRun(async () => {
    try {
        const snap = await db.collection('moderationQueue').where('status', '==', 'pending_review').limit(500).get();
        const batch = db.batch();
        const nowMs = Date.now();
        snap.docs.forEach(d => {
            var _a, _b;
            const cur = d.data();
            const totalReports = cur.totalReports || 0;
            const distinctReasons = Object.keys(cur.reasons || {}).length;
            const lastTs = ((_b = (_a = cur.lastReportedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) || nowMs;
            const ageHours = Math.max(0, (nowMs - lastTs) / (1000 * 60 * 60));
            const agingFactor = Math.min(12, ageHours / 6); // up to +12 after 72h
            const priorityScore = totalReports + distinctReasons * 0.5 + agingFactor;
            batch.update(d.ref, { priorityScore });
        });
        if (snap.size > 0)
            await batch.commit();
        console.log(`✅ Recalculated moderationQueue priorities for ${snap.size} targets`);
    }
    catch (e) {
        console.error('❌ Recalc moderation queue error', e);
    }
    return null;
});
//# sourceMappingURL=index.js.map