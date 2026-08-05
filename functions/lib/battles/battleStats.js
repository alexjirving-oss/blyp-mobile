"use strict";
/**
 * Battle stats aggregation — keeps a per-creator "glory" scoreboard up to date.
 *
 * On every battle that transitions to `completed`, we idempotently fold both
 * participants' results into a per-user aggregate doc `battleStats/{uid}`. The
 * leaderboard reads these aggregates (orderBy gloryPoints desc) so it never has
 * to scan the whole battles collection at read time.
 *
 * GLORY IS POINTS-ONLY. This trigger never touches coins/gems/wallets and never
 * pays anything out — the attendance-bond escrow is settled elsewhere by the
 * live-service. Points exist purely for a transparent bragging-rights ranking.
 *
 * Points formula (mirrored for display in src/services/battleStatsService.js):
 *   +1  for showing up (any completed battle you took part in)
 *   +3  bonus for a win
 *   +1  bonus for a draw
 *   +1  per step of an active win-streak beyond the first win (capped at +5)
 * So a win is worth 4 (+streak), a draw 2, a loss 1.
 *
 * Idempotency: each user doc keeps `processedBattleIds` (a capped recent list).
 * If the trigger re-fires for a battle we've already counted for that user, we
 * skip it — no double counting.
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
exports.onBattleComplete = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
// Transparent, points-only glory weights. Keep in sync with the client mirror
// in src/services/battleStatsService.js (GLORY_RULES) used for the in-UI note.
const GLORY = {
    SHOW_UP: 1,
    WIN_BONUS: 3,
    DRAW_BONUS: 1,
    STREAK_STEP: 1,
    STREAK_BONUS_CAP: 5,
};
// Cap the idempotency list so the doc can't grow unbounded over a creator's life.
const MAX_PROCESSED_IDS = 500;
/** Glory awarded for a single completed battle, given the post-battle streak. */
function gloryDelta(result, newStreak) {
    let pts = GLORY.SHOW_UP;
    if (result === 'win')
        pts += GLORY.WIN_BONUS;
    else if (result === 'draw')
        pts += GLORY.DRAW_BONUS;
    if (result === 'win') {
        const steps = Math.max(0, newStreak - 1) * GLORY.STREAK_STEP;
        pts += Math.min(steps, GLORY.STREAK_BONUS_CAP);
    }
    return pts;
}
/** ISO-week key (UTC, Monday-start) used to bucket "this week" totals. */
function weekKeyFor(ms) {
    const d = new Date(ms || Date.now());
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
    date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const week = 1 +
        Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 -
            3 +
            ((firstThursday.getUTCDay() + 6) % 7)) /
            7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
/** Result for a given uid from the battle's declared winner (null winner = draw). */
function resultFor(uid, winnerUid) {
    if (!winnerUid)
        return 'draw';
    return winnerUid === uid ? 'win' : 'loss';
}
/** Pull display identity for a side from the battle doc, with a users fallback. */
async function identityFor(uid, side, battle) {
    const name = side === 'creator' ? battle.creatorName : battle.opponentName;
    const photo = side === 'creator' ? battle.creatorPhoto : battle.opponentPhoto;
    const username = side === 'creator' ? battle.creatorUsername : battle.opponentUsername;
    let displayName = String(name || '').trim();
    let photoURL = String(photo || '').trim();
    let handle = String(username || '').trim();
    if (!displayName || !handle) {
        try {
            const u = await firebaseAdmin_1.admin.firestore().collection('users').doc(uid).get();
            const d = u.data() || {};
            if (!displayName)
                displayName = String(d.displayName || d.name || d.username || 'Creator');
            if (!handle)
                handle = String(d.username || '');
            if (!photoURL)
                photoURL = String(d.photoURL || d.avatar || '');
        }
        catch (_a) {
            // best-effort only
        }
    }
    return {
        displayName: displayName || 'Creator',
        photoURL: photoURL || '',
        handle: handle || '',
    };
}
/** Idempotently fold one participant's result into their battleStats aggregate. */
async function applyToParticipant(uid, side, battle, battleId, endedAt) {
    if (!uid)
        return;
    const db = firebaseAdmin_1.admin.firestore();
    const ref = db.collection('battleStats').doc(uid);
    const identity = await identityFor(uid, side, battle);
    const result = resultFor(uid, battle.winnerUid);
    const wk = weekKeyFor(endedAt);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const cur = (snap.exists ? snap.data() : {}) || {};
        const processed = Array.isArray(cur.processedBattleIds) ? cur.processedBattleIds : [];
        if (processed.includes(battleId))
            return; // already counted — no double-count
        const prevStreak = Number(cur.currentStreak) || 0;
        const newStreak = result === 'win' ? prevStreak + 1 : 0;
        const bestStreak = Math.max(Number(cur.bestStreak) || 0, newStreak);
        const delta = gloryDelta(result, newStreak);
        const sameWeek = cur.weekKey === wk;
        tx.set(ref, {
            uid,
            displayName: identity.displayName,
            photoURL: identity.photoURL,
            handle: identity.handle,
            wins: (Number(cur.wins) || 0) + (result === 'win' ? 1 : 0),
            losses: (Number(cur.losses) || 0) + (result === 'loss' ? 1 : 0),
            draws: (Number(cur.draws) || 0) + (result === 'draw' ? 1 : 0),
            battlesPlayed: (Number(cur.battlesPlayed) || 0) + 1,
            gloryPoints: (Number(cur.gloryPoints) || 0) + delta,
            currentStreak: newStreak,
            bestStreak,
            weekKey: wk,
            weeklyGloryPoints: (sameWeek ? Number(cur.weeklyGloryPoints) || 0 : 0) + delta,
            weeklyWins: (sameWeek ? Number(cur.weeklyWins) || 0 : 0) + (result === 'win' ? 1 : 0),
            weeklyBattlesPlayed: (sameWeek ? Number(cur.weeklyBattlesPlayed) || 0 : 0) + 1,
            processedBattleIds: [battleId, ...processed].slice(0, MAX_PROCESSED_IDS),
            lastBattleAt: endedAt,
            updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    });
}
/**
 * Fires when a battle finishes. Upserts both participants' aggregates. Safe to
 * re-fire: per-user `processedBattleIds` guards against double counting.
 */
exports.onBattleComplete = functions.firestore
    .document('battles/{battleId}')
    .onUpdate(async (change, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const battleId = context.params.battleId;
    // Only act on the single transition into `completed`.
    if (before.status === 'completed' || after.status !== 'completed')
        return null;
    if (!after.creatorUid || !after.opponentUid)
        return null;
    const endedAt = Number(after.endedAt) || Number(after.updatedAt) || Date.now();
    // Sequential (not parallel) so the two transactions don't contend needlessly.
    await applyToParticipant(after.creatorUid, 'creator', after, battleId, endedAt);
    await applyToParticipant(after.opponentUid, 'opponent', after, battleId, endedAt);
    return null;
});
//# sourceMappingURL=battleStats.js.map