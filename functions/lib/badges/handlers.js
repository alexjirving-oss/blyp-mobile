"use strict";
/**
 * Badge awards (Clubs Phase 3) — server-minted earnable badges.
 *
 * POST /blypSyncBadgeAwards  (Bearer Firebase ID token)
 *   -> 200 { ok, awarded: string[], earned: string[] }
 *
 * Clients may equip earned + pickable catalog badges only.
 * Award docs live at badgeAwards/{uid}/items/{badgeId}; clients cannot write.
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
exports.onLiveSessionBadgeAward = exports.blypSyncBadgeAwards = exports.SERVER_BADGE_IDS = void 0;
exports.syncBadgeAwardsForUid = syncBadgeAwardsForUid;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const cors_1 = require("../http/cors");
(0, firebaseAdmin_1.initFirebaseAdmin)();
const AWARDS_COL = 'badgeAwards';
const ITEMS = 'items';
/** Catalog ids the server may mint. Keep in sync with client BADGE_CATALOG earn:'server'. */
exports.SERVER_BADGE_IDS = {
    liveHost: 'badge_live_host',
    marblePodium: 'badge_marble_podium',
    earlyBlyper: 'badge_early_blyper',
};
/** Accounts created before this instant qualify for Early Blyper. */
const EARLY_ADOPTER_UNTIL_MS = Date.parse('2026-09-01T00:00:00.000Z');
async function listEarnedIds(uid) {
    const db = firebaseAdmin_1.admin.firestore();
    const snap = await db.collection(AWARDS_COL).doc(uid).collection(ITEMS).get();
    return snap.docs.map((d) => d.id).filter(Boolean).sort();
}
async function mintIfMissing(uid, badgeId, source, meta = {}) {
    const db = firebaseAdmin_1.admin.firestore();
    const ref = db.collection(AWARDS_COL).doc(uid).collection(ITEMS).doc(badgeId);
    const existing = await ref.get();
    if (existing.exists)
        return false;
    await ref.set(Object.assign({ badgeId,
        uid,
        source, earnedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp() }, meta), { merge: true });
    return true;
}
async function hasHostedLive(uid) {
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const sessions = await db
            .collection('liveSessions')
            .where('hostUserId', '==', uid)
            .limit(1)
            .get();
        if (!sessions.empty)
            return true;
    }
    catch (e) {
        console.warn('[badges] liveSessions query failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    try {
        const streams = await db
            .collection('liveStreams')
            .where('hostUserId', '==', uid)
            .limit(1)
            .get();
        if (!streams.empty)
            return true;
    }
    catch (e) {
        console.warn('[badges] liveStreams query failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    try {
        const streamsByHost = await db
            .collection('liveStreams')
            .where('hostId', '==', uid)
            .limit(1)
            .get();
        if (!streamsByHost.empty)
            return true;
    }
    catch (_a) {
        /* optional secondary field */
    }
    return false;
}
async function hasMarblePodium(uid) {
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const userSnap = await db.collection('users').doc(uid).get();
        const u = userSnap.data() || {};
        const wins = Number(u.marblePodiumWins || u.marblePodiumCount || 0);
        if (wins >= 1)
            return { ok: true, evidence: 'users.marblePodiumWins' };
    }
    catch (e) {
        console.warn('[badges] user podium read failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    try {
        const evidence = await db.collection('marblePodiumResults').doc(uid).get();
        if (evidence.exists)
            return { ok: true, evidence: 'marblePodiumResults' };
    }
    catch (e) {
        console.warn('[badges] marblePodiumResults read failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    return { ok: false };
}
async function isEarlyAdopter(uid) {
    var _a;
    try {
        const user = await firebaseAdmin_1.admin.auth().getUser(uid);
        const createdMs = ((_a = user.metadata) === null || _a === void 0 ? void 0 : _a.creationTime)
            ? Date.parse(user.metadata.creationTime)
            : NaN;
        if (Number.isFinite(createdMs) && createdMs < EARLY_ADOPTER_UNTIL_MS) {
            return { ok: true, evidence: 'auth.creationTime' };
        }
    }
    catch (e) {
        console.warn('[badges] auth early check failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    try {
        const db = firebaseAdmin_1.admin.firestore();
        const userSnap = await db.collection('users').doc(uid).get();
        const u = userSnap.data() || {};
        if (u.earlyAdopter === true || u.earlyBlyper === true) {
            return { ok: true, evidence: 'users.earlyAdopter' };
        }
        const createdAt = u.createdAt;
        let ms = NaN;
        if (createdAt && typeof createdAt.toMillis === 'function')
            ms = createdAt.toMillis();
        else if (typeof createdAt === 'number')
            ms = createdAt;
        else if (createdAt instanceof Date)
            ms = createdAt.getTime();
        else if (typeof createdAt === 'string')
            ms = Date.parse(createdAt);
        if (Number.isFinite(ms) && ms < EARLY_ADOPTER_UNTIL_MS) {
            return { ok: true, evidence: 'users.createdAt' };
        }
    }
    catch (e) {
        console.warn('[badges] user early check failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    return { ok: false };
}
async function denormEarnedBadgeIds(uid, earned) {
    const db = firebaseAdmin_1.admin.firestore();
    await db
        .collection('users')
        .doc(uid)
        .set({
        earnedBadgeIds: earned,
        earnedBadgeIdsUpdatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
}
/**
 * Evaluate eligibility and mint missing awards for uid.
 * Exported for triggers (live host) and HTTPS sync.
 */
async function syncBadgeAwardsForUid(uid) {
    const awarded = [];
    if (await hasHostedLive(uid)) {
        if (await mintIfMissing(uid, exports.SERVER_BADGE_IDS.liveHost, 'live_host')) {
            awarded.push(exports.SERVER_BADGE_IDS.liveHost);
        }
    }
    const marble = await hasMarblePodium(uid);
    if (marble.ok) {
        if (await mintIfMissing(uid, exports.SERVER_BADGE_IDS.marblePodium, 'marble_podium', {
            evidence: marble.evidence || null,
        })) {
            awarded.push(exports.SERVER_BADGE_IDS.marblePodium);
        }
    }
    const early = await isEarlyAdopter(uid);
    if (early.ok) {
        if (await mintIfMissing(uid, exports.SERVER_BADGE_IDS.earlyBlyper, 'early_adopter', {
            evidence: early.evidence || null,
        })) {
            awarded.push(exports.SERVER_BADGE_IDS.earlyBlyper);
        }
    }
    const earned = await listEarnedIds(uid);
    try {
        await denormEarnedBadgeIds(uid, earned);
    }
    catch (e) {
        console.warn('[badges] denorm earnedBadgeIds failed', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
    return { awarded, earned };
}
exports.blypSyncBadgeAwards = functions
    .runWith({ memory: '256MB', timeoutSeconds: 30 })
    .https.onRequest(async (req, res) => {
    (0, cors_1.applyCors)(req, res, { methods: 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    if (req.method !== 'POST') {
        res.status(405).json({ ok: false, reason: 'method' });
        return;
    }
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : null;
    let uid = '';
    try {
        if (!idToken)
            throw new Error('missing-token');
        const decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(idToken);
        uid = decoded.uid;
    }
    catch (_a) {
        res.status(401).json({ ok: false, reason: 'unauthenticated' });
        return;
    }
    try {
        const result = await syncBadgeAwardsForUid(uid);
        res.status(200).json(Object.assign({ ok: true }, result));
    }
    catch (e) {
        console.error('[blypSyncBadgeAwards]', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        res.status(500).json({ ok: false, reason: 'internal' });
    }
});
/**
 * When a live session is created/goes live with a host, mint Live Host badge.
 */
exports.onLiveSessionBadgeAward = functions.firestore
    .document('liveSessions/{sessionId}')
    .onWrite(async (change) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after)
        return;
    const hostUserId = typeof after.hostUserId === 'string' ? after.hostUserId.trim() : '';
    if (!hostUserId)
        return;
    const status = String(after.status || '').toLowerCase();
    if (status && status !== 'live' && status !== 'ended' && status !== 'creating')
        return;
    try {
        await mintIfMissing(hostUserId, exports.SERVER_BADGE_IDS.liveHost, 'live_host', {
            sessionId: change.after.id,
        });
        const earned = await listEarnedIds(hostUserId);
        await denormEarnedBadgeIds(hostUserId, earned);
    }
    catch (e) {
        console.warn('[onLiveSessionBadgeAward]', (e === null || e === void 0 ? void 0 : e.message) || String(e));
    }
});
//# sourceMappingURL=handlers.js.map