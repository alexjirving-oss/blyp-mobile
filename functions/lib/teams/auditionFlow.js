"use strict";
/**
 * Agency auditions — "audition for the agency" instead of a plain join request.
 *
 * Flow:
 *  - A user auditions → if someone is already waiting to audition for the same
 *    team, the two are MATCHED; otherwise an OPEN audition is created with a 24h
 *    window to find an opponent.
 *  - When matched (by a second applicant OR by the timeout fallback), a real live
 *    co-host `battles/{id}` doc is created so the two go head-to-head.
 *  - If the 24h window expires with no opponent, the opposing slot is auto-filled
 *    by the team leader (preferred) or the configured fallback account (Alex).
 *  - When the battle completes, its figures (scores + winner) are captured onto
 *    the audition and the team leader is notified to review.
 *  - The leader accepts/declines each real candidate from the dashboard; an
 *    accepted candidate is added to the team roster and notified.
 *
 * Collections:
 *   auditions/{auditionId}
 *     teamId, teamName, status, aUid/aName/aPhoto, bUid/bName/bPhoto,
 *     bIsFallback, fallbackRole, battleId, windowExpiresAt, results, decisions{}
 *
 * All notifications ride the existing spine via enqueueNotification (idempotent).
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
exports.onAuditionDecision = exports.onAuditionBattleComplete = exports.auditionOpponentSweep = exports.onAuditionMatched = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("../notifications/outbox");
const AUDITION_BATTLE_DURATION_SEC = 300;
const AUDITION_BATTLE_LEAD_MS = 5 * 60 * 1000; // fallback start if no slot is set
async function teamMeta(db, teamId) {
    try {
        const snap = await db.collection('teams').doc(teamId).get();
        const d = (snap.exists ? snap.data() : null);
        return { name: (d === null || d === void 0 ? void 0 : d.name) || 'the agency', leaderId: (d === null || d === void 0 ? void 0 : d.leaderId) || null };
    }
    catch (_a) {
        return { name: 'the agency', leaderId: null };
    }
}
async function userProfile(db, uid) {
    try {
        const snap = await db.collection('users').doc(uid).get();
        const d = (snap.exists ? snap.data() : null);
        const displayName = (d === null || d === void 0 ? void 0 : d.displayName) || (d === null || d === void 0 ? void 0 : d.username) || (d === null || d === void 0 ? void 0 : d.name) || 'Member';
        const photoURL = (d === null || d === void 0 ? void 0 : d.photoURL) || (d === null || d === void 0 ? void 0 : d.avatar) || (d === null || d === void 0 ? void 0 : d.userPhotoURL) || (d === null || d === void 0 ? void 0 : d.photo) || null;
        return { displayName, photoURL };
    }
    catch (_a) {
        return { displayName: 'Member', photoURL: null };
    }
}
/** Configured fallback account ("Alex") for when no opponent and no usable leader. */
async function fallbackAccountUid(db) {
    const envUid = String(process.env.AUDITION_FALLBACK_UID || '').trim();
    if (envUid)
        return envUid;
    try {
        const snap = await db.collection('appConfig').doc('teams').get();
        const d = (snap.exists ? snap.data() : null);
        const uid = String((d === null || d === void 0 ? void 0 : d.auditionFallbackUid) || '').trim();
        return uid || null;
    }
    catch (_a) {
        return null;
    }
}
function newBattleId() {
    return `btl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * When an audition becomes `matched`, create the real co-host battle the two
 * applicants will perform, then notify them. Guarded so a retried trigger or a
 * later status change cannot create a second battle.
 */
exports.onAuditionMatched = functions.firestore
    .document('auditions/{auditionId}')
    .onUpdate(async (change, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const { auditionId } = context.params;
    const before = change.before.data();
    const after = change.after.data();
    if (!after)
        return null;
    const becameMatched = (before === null || before === void 0 ? void 0 : before.status) !== 'matched' && after.status === 'matched';
    if (!becameMatched)
        return null;
    if (after.battleId)
        return null; // already has a battle
    if (!after.aUid || !after.bUid)
        return null;
    const battleId = newBattleId();
    const now = Date.now();
    const title = `Audition: ${after.aName || 'Applicant'} vs ${after.bName || 'Opponent'}`;
    // Auditions battle at the scheduled 10pm UK slot; fall back to a short lead
    // if (somehow) no slot was recorded.
    const startAt = Number(after.scheduledAt) > now ? Number(after.scheduledAt) : now + AUDITION_BATTLE_LEAD_MS;
    const battle = {
        creatorUid: after.aUid,
        creatorName: after.aName || 'Applicant',
        creatorUsername: '',
        creatorPhoto: after.aPhoto || '',
        opponentUid: after.bUid,
        opponentName: after.bName || 'Opponent',
        opponentUsername: '',
        opponentPhoto: after.bPhoto || '',
        participantsUids: [after.aUid, after.bUid],
        // Both opted into auditioning, so the battle is pre-accepted (scheduled),
        // free (no stake), and ready for both to go live.
        status: 'scheduled',
        title,
        scheduledStartAt: startAt,
        durationSec: AUDITION_BATTLE_DURATION_SEC,
        depositMode: 'free',
        stakeCoins: 0,
        creatorPaid: false,
        opponentPaid: false,
        notifySupporters: false,
        liveStreamId: null,
        stageArn: null,
        creatorJoined: false,
        opponentJoined: false,
        score: { creator: 0, opponent: 0 },
        winnerUid: null,
        settlement: null,
        // Audition linkage so the completion trigger can route results back.
        isAudition: true,
        auditionId,
        teamId: after.teamId || '',
        createdAt: now,
        updatedAt: now,
    };
    // Create the battle, then attach it to the audition. If attaching fails we
    // leave the battle (harmless) and let a retry re-link.
    try {
        await db.collection('battles').doc(battleId).set(battle);
    }
    catch (e) {
        console.error('[auditionFlow] failed to create audition battle', auditionId, e);
        return null;
    }
    await change.after.ref
        .set({ battleId, updatedAt: now }, { merge: true })
        .catch((e) => console.error('[auditionFlow] failed to link battle to audition', auditionId, e));
    const recipients = [
        { uid: after.aUid, opponent: after.bName || 'an opponent' },
        { uid: after.bUid, opponent: after.aName || 'an opponent' },
    ];
    // Don't ping a fallback leader/Alex slot — they aren't auditioning.
    const notifyList = after.bIsFallback ? recipients.filter((r) => r.uid !== after.bUid) : recipients;
    await Promise.all(notifyList.map((r) => (0, outbox_1.enqueueNotification)({
        userId: r.uid,
        type: 'battle',
        title: 'Your audition is set!',
        body: `You're auditioning against ${r.opponent}. Go live to compete.`,
        dedupeKey: `audition:matched:${auditionId}:${r.uid}`,
        collapseKey: `audition:${auditionId}`,
        data: {
            type: 'battle',
            battleId,
            teamId: after.teamId || '',
            auditionId,
            kind: 'audition_matched',
        },
    })));
    return null;
});
/**
 * Hourly sweep: any open audition past its 24h window gets its opponent slot
 * auto-filled — preferring the team leader, then the configured fallback account
 * (Alex). Setting status to `matched` triggers onAuditionMatched to build the
 * battle.
 */
exports.auditionOpponentSweep = functions.pubsub
    .schedule('every 15 minutes')
    .onRun(async () => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const now = Date.now();
    const snap = await db
        .collection('auditions')
        .where('status', '==', 'awaiting_opponent')
        .where('windowExpiresAt', '<=', now)
        .limit(50)
        .get();
    if (snap.empty)
        return null;
    const fallbackUid = await fallbackAccountUid(db);
    for (const doc of snap.docs) {
        const a = doc.data();
        const { leaderId } = await teamMeta(db, a.teamId);
        // Prefer the team leader; never pit an applicant against themselves.
        let oppUid = null;
        let fallbackRole = null;
        if (leaderId && leaderId !== a.aUid) {
            oppUid = leaderId;
            fallbackRole = 'leader';
        }
        else if (fallbackUid && fallbackUid !== a.aUid) {
            oppUid = fallbackUid;
            fallbackRole = 'alex';
        }
        if (!oppUid) {
            await doc.ref.set({ status: 'expired', updatedAt: now }, { merge: true }).catch(() => { });
            continue;
        }
        const opp = await userProfile(db, oppUid);
        await doc.ref
            .set({
            bUid: oppUid,
            bName: opp.displayName,
            bPhoto: opp.photoURL,
            bIsFallback: true,
            fallbackRole,
            status: 'matched',
            updatedAt: now,
        }, { merge: true })
            .catch((e) => console.error('[auditionFlow] sweep failed to match', doc.id, e));
    }
    return null;
});
/**
 * When an audition's battle completes, capture the figures onto the audition and
 * notify the team leader to review. Runs alongside the existing onBattleComplete
 * (glory stats) — multiple triggers on the same doc are fine.
 */
exports.onAuditionBattleComplete = functions.firestore
    .document('battles/{battleId}')
    .onUpdate(async (change, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const before = change.before.data();
    const after = change.after.data();
    if (!after)
        return null;
    if ((before === null || before === void 0 ? void 0 : before.status) === 'completed' || after.status !== 'completed')
        return null;
    const auditionId = after.auditionId;
    if (!after.isAudition || !auditionId)
        return null;
    const score = after.score || { creator: 0, opponent: 0 };
    const scoreA = Number(score.creator || 0);
    const scoreB = Number(score.opponent || 0);
    const results = {
        scoreA,
        scoreB,
        winnerUid: after.winnerUid || null,
        winnerSide: after.winnerUid === after.opponentUid ? 'b' : after.winnerUid === after.creatorUid ? 'a' : 'tie',
        endedAt: after.endedAt || Date.now(),
    };
    const audRef = db.collection('auditions').doc(auditionId);
    const audSnap = await audRef.get();
    if (!audSnap.exists)
        return null;
    const aud = audSnap.data();
    await audRef.set({ status: 'completed', results, updatedAt: Date.now() }, { merge: true });
    const { name, leaderId } = await teamMeta(db, aud.teamId);
    if (leaderId) {
        await (0, outbox_1.enqueueNotification)({
            userId: leaderId,
            type: 'team',
            title: 'Audition complete',
            body: `${aud.aName || 'An applicant'}'s audition for ${name} is ready to review.`,
            dedupeKey: `audition:complete:${auditionId}`,
            collapseKey: `team:${aud.teamId}`,
            data: { type: 'team', teamId: aud.teamId || '', auditionId, kind: 'audition_complete' },
        });
    }
    return null;
});
/**
 * Leader decides on candidates. The dashboard writes `decisions.{uid}` =
 * 'accepted' | 'declined'. On accept we add the candidate to the roster; either
 * way the candidate is notified. Idempotent per (audition, uid, decision).
 */
exports.onAuditionDecision = functions.firestore
    .document('auditions/{auditionId}')
    .onUpdate(async (change, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const { auditionId } = context.params;
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const beforeDec = before.decisions || {};
    const afterDec = after.decisions || {};
    // Find decisions that are newly set or changed.
    const changed = [];
    for (const uid of Object.keys(afterDec)) {
        if (afterDec[uid] && afterDec[uid] !== beforeDec[uid]) {
            changed.push({ uid, decision: String(afterDec[uid]) });
        }
    }
    if (changed.length === 0)
        return null;
    const { name } = await teamMeta(db, after.teamId);
    for (const { uid, decision } of changed) {
        if (decision === 'accepted') {
            // Add to the roster (mirror of acceptJoinRequest).
            const prof = uid === after.aUid
                ? { displayName: after.aName, photoURL: after.aPhoto }
                : { displayName: after.bName, photoURL: after.bPhoto };
            const memberRef = db.collection('teams').doc(after.teamId).collection('members').doc(uid);
            await memberRef
                .set({
                uid,
                displayName: prof.displayName || 'Member',
                photoURL: prof.photoURL || null,
                role: 'member',
                hoursLive: 0,
                joinedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
                viaAudition: auditionId,
            }, { merge: true })
                .catch((e) => console.error('[auditionFlow] add member failed', uid, e));
            await db
                .collection('teams')
                .doc(after.teamId)
                .set({
                memberCount: firebaseAdmin_1.admin.firestore.FieldValue.increment(1),
                memberIds: firebaseAdmin_1.admin.firestore.FieldValue.arrayUnion(uid),
                updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true })
                .catch((e) => console.error('[auditionFlow] team member count failed', uid, e));
        }
        await (0, outbox_1.enqueueNotification)({
            userId: uid,
            type: 'team',
            title: decision === 'accepted' ? `Welcome to ${name}!` : 'Audition update',
            body: decision === 'accepted'
                ? `Your audition was successful — you're now part of ${name}.`
                : `Thanks for auditioning for ${name}. You weren't selected this time.`,
            dedupeKey: `audition:decision:${auditionId}:${uid}:${decision}`,
            collapseKey: `team:${after.teamId}`,
            data: { type: 'team', teamId: after.teamId || '', auditionId, kind: 'audition_decision', status: decision },
        });
    }
    return null;
});
//# sourceMappingURL=auditionFlow.js.map