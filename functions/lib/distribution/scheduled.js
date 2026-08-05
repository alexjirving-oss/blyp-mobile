"use strict";
/**
 * blypReachSweep — the heartbeat of earn-your-reach.
 *
 * Every hour it folds the latest batch of post signals (impressions/likes/shares/
 * saves/watch-through) into each post's transparent Blyp Score and wave, promoting
 * posts that genuinely connect and gently resting those that don't. It uses a
 * timestamp cursor (platformState/reachSweep) so it never reprocesses an event and
 * needs no extra composite index.
 *
 * Authority lives here: the client only *reports* signals and *reads* the resulting
 * score. Merit cannot be faked from the app.
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
exports.blypReachSweep = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const types_1 = require("../platform/types");
const reach_1 = require("./reach");
const CURSOR_DOC = 'reachSweep';
const COMPLETION_THRESHOLD = 0.9;
const MAX_EVENTS_PER_RUN = 4000;
function emptyAgg() {
    return Object.assign(Object.assign({}, (0, reach_1.emptyEngagements)()), { impressions: 0 });
}
exports.blypReachSweep = functions
    .runWith({ memory: '512MB', timeoutSeconds: 300 })
    .pubsub.schedule('every 60 minutes')
    .onRun(async () => {
    var _a;
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const cursorRef = db.collection(types_1.COLLECTIONS.platformState).doc(CURSOR_DOC);
    const cursorSnap = await cursorRef.get();
    const lastTs = Number(((_a = cursorSnap.data()) === null || _a === void 0 ? void 0 : _a.lastTs) || 0);
    const evSnap = await db
        .collection(types_1.COLLECTIONS.impressionEvents)
        .where('ts', '>', lastTs)
        .orderBy('ts', 'asc')
        .limit(MAX_EVENTS_PER_RUN)
        .get();
    if (evSnap.empty) {
        console.log('[blypReachSweep] no new events');
        return null;
    }
    const perPost = new Map();
    let maxTs = lastTs;
    for (const d of evSnap.docs) {
        const ev = d.data();
        const ts = Number(ev.ts || 0);
        if (ts > maxTs)
            maxTs = ts;
        const postId = String(ev.postId || '');
        if (!postId)
            continue;
        const a = perPost.get(postId) || emptyAgg();
        if (ev.ownerId)
            a.ownerId = String(ev.ownerId);
        switch (ev.type) {
            case 'impression':
                a.impressions += 1;
                break;
            case 'like':
                a.likes += 1;
                break;
            case 'comment':
                a.comments += 1;
                break;
            case 'share':
                a.shares += 1;
                break;
            case 'save':
                a.saves += 1;
                break;
            case 'watch':
                a.dwellMsTotal += Number(ev.dwellMs || 0);
                if (Number(ev.completion || 0) >= COMPLETION_THRESHOLD)
                    a.completions += 1;
                break;
            default:
                break;
        }
        perPost.set(postId, a);
    }
    let updated = 0;
    for (const [postId, a] of perPost) {
        const postRef = db.collection(types_1.COLLECTIONS.posts).doc(postId);
        try {
            // eslint-disable-next-line no-await-in-loop
            await db.runTransaction(async (tx) => {
                var _a;
                const snap = await tx.get(postRef);
                if (!snap.exists)
                    return; // post deleted — drop its signals
                const prev = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.reach;
                const next = (0, reach_1.applyReachDeltas)(prev, {
                    impressions: a.impressions,
                    likes: a.likes,
                    comments: a.comments,
                    shares: a.shares,
                    saves: a.saves,
                    completions: a.completions,
                    dwellMsTotal: a.dwellMsTotal,
                }, Date.now());
                tx.set(postRef, { reach: next }, { merge: true });
            });
            updated += 1;
        }
        catch (e) {
            console.warn('[blypReachSweep] post update failed', postId, e === null || e === void 0 ? void 0 : e.message);
        }
    }
    await cursorRef.set({ lastTs: maxTs, updatedAt: Date.now() }, { merge: true });
    console.log(`[blypReachSweep] processed ${evSnap.size} events across ${perPost.size} posts, updated ${updated}`);
    return null;
});
//# sourceMappingURL=scheduled.js.map