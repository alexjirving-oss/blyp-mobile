"use strict";
/**
 * Dating write path — Phase 5 safety hardening.
 *
 * blypDatingLike  POST { toUid }  → mutual-match (server-owned datingMatches)
 * blypDatingPass  POST { toUid }  → rate-limited pass write
 *
 * Both require: Bearer Firebase ID token, active Plus/trial entitlement,
 * caller opted-in + adultConfirmed + birthYear (self-report age ≥ 18),
 * and target similarly discoverable. Rate limits fail closed.
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
exports.blypDatingPass = exports.blypDatingLike = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const cors_1 = require("../http/cors");
const entitlement_1 = require("../assistant/entitlement");
const rateLimit_1 = require("../platform/rateLimit");
(0, firebaseAdmin_1.initFirebaseAdmin)();
const COLLECTIONS = {
    prefs: 'datingPrefs',
    likes: 'datingLikes',
    passes: 'datingPasses',
    matches: 'datingMatches',
    users: 'users',
};
const AGE_MIN = 18;
/** Burst: 20 likes / rolling minute (anti-script). */
const LIKE_RATE = { windowMs: 60000, max: 20, failOpen: false };
/** Burst: 40 passes / rolling minute. */
const PASS_RATE = { windowMs: 60000, max: 40, failOpen: false };
function likeDocId(fromUid, toUid) {
    return fromUid + '_' + toUid;
}
function matchDocId(a, b) {
    return a < b ? a + '_' + b : b + '_' + a;
}
function ageFromBirthYear(birthYear) {
    const y = Number(birthYear);
    if (!Number.isFinite(y))
        return null;
    const age = new Date().getFullYear() - Math.round(y);
    if (age < AGE_MIN || age > 120)
        return null;
    return age;
}
function gatePrefs(snap, role) {
    if (!snap.exists) {
        return {
            ok: false,
            reason: role === 'caller' ? 'dating_not_enabled' : 'target_unavailable',
            status: role === 'caller' ? 403 : 404,
        };
    }
    const prefs = snap.data() || {};
    if (!prefs.adultConfirmed || !prefs.optedIn) {
        return {
            ok: false,
            reason: role === 'caller' ? 'dating_not_enabled' : 'target_unavailable',
            status: role === 'caller' ? 403 : 404,
        };
    }
    if (ageFromBirthYear(prefs.birthYear) == null) {
        return {
            ok: false,
            reason: role === 'caller' ? 'birth_year_required' : 'target_unavailable',
            status: role === 'caller' ? 403 : 404,
        };
    }
    return { ok: true, prefs };
}
async function requireAuth(req) {
    const authHeader = String(req.headers.authorization || '');
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    if (!idToken)
        return null;
    try {
        const decoded = await firebaseAdmin_1.admin.auth().verifyIdToken(idToken);
        return decoded.uid || null;
    }
    catch (_a) {
        return null;
    }
}
function parseToUid(body, fromUid) {
    const toUid = typeof (body === null || body === void 0 ? void 0 : body.toUid) === 'string' ? body.toUid.trim() : '';
    if (!toUid || toUid === fromUid)
        return null;
    return toUid;
}
exports.blypDatingLike = functions
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
    const fromUid = await requireAuth(req);
    if (!fromUid) {
        res.status(401).json({ ok: false, reason: 'unauthenticated' });
        return;
    }
    const rl = await (0, rateLimit_1.checkRateLimit)('dating_like_' + fromUid, LIKE_RATE);
    if (!rl.allowed) {
        res.set('Retry-After', String(rl.retryAfterSec || 60));
        res.status(429).json({ ok: false, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec });
        return;
    }
    const sub = await (0, entitlement_1.getSubscriptionState)(fromUid);
    if (!sub.active) {
        res.status(402).json({ ok: false, reason: 'subscription_required' });
        return;
    }
    const toUid = parseToUid(req.body, fromUid);
    if (!toUid) {
        res.status(400).json({ ok: false, reason: 'invalid_target' });
        return;
    }
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const [myPrefsSnap, theirPrefsSnap] = await Promise.all([
            db.collection(COLLECTIONS.prefs).doc(fromUid).get(),
            db.collection(COLLECTIONS.prefs).doc(toUid).get(),
        ]);
        const myGate = gatePrefs(myPrefsSnap, 'caller');
        if (!myGate.ok) {
            res.status(myGate.status).json({ ok: false, reason: myGate.reason });
            return;
        }
        const theirGate = gatePrefs(theirPrefsSnap, 'target');
        if (!theirGate.ok) {
            res.status(theirGate.status).json({ ok: false, reason: theirGate.reason });
            return;
        }
        const [iBlockThem, theyBlockMe] = await Promise.all([
            db.collection(COLLECTIONS.users).doc(fromUid).collection('blocks').doc(toUid).get(),
            db.collection(COLLECTIONS.users).doc(toUid).collection('blocks').doc(fromUid).get(),
        ]);
        if (iBlockThem.exists || theyBlockMe.exists) {
            res.status(403).json({ ok: false, reason: 'blocked' });
            return;
        }
        const likeRef = db.collection(COLLECTIONS.likes).doc(likeDocId(fromUid, toUid));
        const reverseRef = db.collection(COLLECTIONS.likes).doc(likeDocId(toUid, fromUid));
        const mId = matchDocId(fromUid, toUid);
        const matchRef = db.collection(COLLECTIONS.matches).doc(mId);
        const result = await db.runTransaction(async (tx) => {
            const likeSnap = await tx.get(likeRef);
            const reverseSnap = await tx.get(reverseRef);
            const matchSnap = await tx.get(matchRef);
            if (likeSnap.exists) {
                return {
                    liked: true,
                    alreadyLiked: true,
                    matched: matchSnap.exists,
                    matchId: matchSnap.exists ? mId : null,
                };
            }
            const now = Date.now();
            tx.set(likeRef, {
                fromUid,
                toUid,
                createdAt: now,
            });
            const mutual = reverseSnap.exists;
            if (mutual && !matchSnap.exists) {
                const members = fromUid < toUid ? [fromUid, toUid] : [toUid, fromUid];
                tx.set(matchRef, {
                    members,
                    memberA: members[0],
                    memberB: members[1],
                    createdAt: now,
                    createdByLike: likeDocId(fromUid, toUid),
                });
            }
            return {
                liked: true,
                alreadyLiked: false,
                matched: mutual || matchSnap.exists,
                matchId: mutual || matchSnap.exists ? mId : null,
            };
        });
        res.status(200).json(Object.assign({ ok: true }, result));
    }
    catch (e) {
        console.error('[blypDatingLike]', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        res.status(500).json({ ok: false, reason: 'error' });
    }
});
exports.blypDatingPass = functions
    .runWith({ memory: '256MB', timeoutSeconds: 20 })
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
    const fromUid = await requireAuth(req);
    if (!fromUid) {
        res.status(401).json({ ok: false, reason: 'unauthenticated' });
        return;
    }
    const rl = await (0, rateLimit_1.checkRateLimit)('dating_pass_' + fromUid, PASS_RATE);
    if (!rl.allowed) {
        res.set('Retry-After', String(rl.retryAfterSec || 60));
        res.status(429).json({ ok: false, reason: 'rate_limited', retryAfterSec: rl.retryAfterSec });
        return;
    }
    const sub = await (0, entitlement_1.getSubscriptionState)(fromUid);
    if (!sub.active) {
        res.status(402).json({ ok: false, reason: 'subscription_required' });
        return;
    }
    const toUid = parseToUid(req.body, fromUid);
    if (!toUid) {
        res.status(400).json({ ok: false, reason: 'invalid_target' });
        return;
    }
    const db = firebaseAdmin_1.admin.firestore();
    try {
        const myPrefsSnap = await db.collection(COLLECTIONS.prefs).doc(fromUid).get();
        const myGate = gatePrefs(myPrefsSnap, 'caller');
        if (!myGate.ok) {
            res.status(myGate.status).json({ ok: false, reason: myGate.reason });
            return;
        }
        const passRef = db.collection(COLLECTIONS.passes).doc(likeDocId(fromUid, toUid));
        const existing = await passRef.get();
        if (existing.exists) {
            res.status(200).json({ ok: true, passed: true, alreadyPassed: true });
            return;
        }
        await passRef.set({
            fromUid,
            toUid,
            createdAt: Date.now(),
        });
        res.status(200).json({ ok: true, passed: true, alreadyPassed: false });
    }
    catch (e) {
        console.error('[blypDatingPass]', (e === null || e === void 0 ? void 0 : e.message) || String(e));
        res.status(500).json({ ok: false, reason: 'error' });
    }
});
//# sourceMappingURL=handlers.js.map