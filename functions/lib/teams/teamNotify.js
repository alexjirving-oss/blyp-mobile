"use strict";
/**
 * Team notifications — push fan-out for the Teams feature.
 *
 * Triggers (all ride the existing notification spine via enqueueNotification):
 *  - onTeamJoinRequestCreate: a user asks to join → notify the team leader.
 *  - onTeamJoinRequestDecision: leader accepts/declines → notify the requester.
 *  - onTeamBattleCreate: leader pairs two members → notify both.
 *  - onTeamGroupMessageCreate: team message → notify the roster; warning → target only.
 *
 * Every enqueue is idempotent via a deterministic dedupeKey so a retried trigger
 * can't double-notify.
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
exports.onTeamGroupMessageCreate = exports.onTeamBattleCreate = exports.onTeamJoinRequestDecision = exports.onTeamJoinRequestCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("../notifications/outbox");
function safePublicLabel(value, uid = '', fallback = '') {
    const label = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
    if (!label || label === uid)
        return fallback;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(label)) {
        return fallback;
    }
    if (/^\d{10,}$/.test(label))
        return fallback;
    if (label.length > 20 && /^[A-Za-z0-9_-]+$/.test(label))
        return fallback;
    if (/^user_/i.test(label))
        return fallback;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(label))
        return fallback;
    return label.slice(0, 80);
}
async function publicUserName(db, uid, candidates = [], fallback = 'Someone') {
    if (!uid) {
        for (const value of candidates) {
            const label = safePublicLabel(value);
            if (label)
                return label;
        }
        return fallback;
    }
    const [userSnap, profileSnap] = await Promise.all([
        db.collection('users').doc(uid).get().catch(() => null),
        db.collection('userProfiles').doc(uid).get().catch(() => null),
    ]);
    const user = (userSnap === null || userSnap === void 0 ? void 0 : userSnap.exists) ? userSnap.data() : {};
    const profile = (profileSnap === null || profileSnap === void 0 ? void 0 : profileSnap.exists) ? profileSnap.data() : {};
    const values = [
        user === null || user === void 0 ? void 0 : user.displayName,
        profile === null || profile === void 0 ? void 0 : profile.displayName,
        ...candidates,
        user === null || user === void 0 ? void 0 : user.username,
        user === null || user === void 0 ? void 0 : user.handle,
        profile === null || profile === void 0 ? void 0 : profile.username,
        profile === null || profile === void 0 ? void 0 : profile.handle,
    ];
    for (const value of values) {
        const label = safePublicLabel(value, uid);
        if (label)
            return label;
    }
    return fallback;
}
async function teamName(db, teamId) {
    try {
        const snap = await db.collection('teams').doc(teamId).get();
        if (!snap.exists)
            return 'your team';
        const team = (snap.data() || {});
        const leaderId = String(team.leaderId || '');
        const storedName = String(team.name || '').trim();
        const generatedFromInternalId = !storedName ||
            (!!leaderId && storedName.includes(leaderId)) ||
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(storedName) ||
            /^blyp[_-]\d+/i.test(storedName);
        if (!generatedFromInternalId)
            return storedName.slice(0, 80);
        const ownerName = await publicUserName(db, leaderId, [team.leaderDisplayName, team.leaderName, team.leaderUsername], 'Team owner');
        return `${ownerName}'s Team`;
    }
    catch (_a) {
        return 'your team';
    }
}
async function teamLeaderId(db, teamId) {
    var _a;
    try {
        const snap = await db.collection('teams').doc(teamId).get();
        return (snap.exists && ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.leaderId)) || null;
    }
    catch (_b) {
        return null;
    }
}
exports.onTeamJoinRequestCreate = functions.firestore
    .document('teams/{teamId}/joinRequests/{requesterId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const { teamId, requesterId } = context.params;
    const req = snap.data();
    if (!req || req.status !== 'pending')
        return null;
    const leaderId = await teamLeaderId(db, teamId);
    if (!leaderId || leaderId === requesterId)
        return null;
    const name = await teamName(db, teamId);
    const requesterName = await publicUserName(db, requesterId, [req.displayName, req.username], 'Someone');
    await (0, outbox_1.enqueueNotification)({
        userId: leaderId,
        type: 'team',
        title: 'New team request',
        body: `${requesterName} wants to join ${name}.`,
        dedupeKey: `team:join:${teamId}:${requesterId}`,
        collapseKey: `team:${teamId}`,
        data: { type: 'team', teamId, requesterId, kind: 'join_request' },
    });
    return null;
});
exports.onTeamJoinRequestDecision = functions.firestore
    .document('teams/{teamId}/joinRequests/{requesterId}')
    .onUpdate(async (change, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const { teamId, requesterId } = context.params;
    const before = change.before.data();
    const after = change.after.data();
    if (!after || (before === null || before === void 0 ? void 0 : before.status) === (after === null || after === void 0 ? void 0 : after.status))
        return null;
    if (after.status !== 'accepted' && after.status !== 'rejected')
        return null;
    const name = await teamName(db, teamId);
    const accepted = after.status === 'accepted';
    await (0, outbox_1.enqueueNotification)({
        userId: requesterId,
        type: 'team',
        title: accepted ? `Welcome to ${name}!` : 'Team request update',
        body: accepted
            ? `You're now a member of ${name}.`
            : `Your request to join ${name} wasn't accepted this time.`,
        dedupeKey: `team:decision:${teamId}:${requesterId}:${after.status}`,
        collapseKey: `team:${teamId}`,
        data: { type: 'team', teamId, kind: 'join_decision', status: after.status },
    });
    return null;
});
exports.onTeamBattleCreate = functions.firestore
    .document('teamBattles/{battleId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const { battleId } = context.params;
    const b = snap.data();
    if (!b || !b.aUid || !b.bUid)
        return null;
    const name = b.teamId ? await teamName(db, b.teamId) : 'your team';
    const recipients = [
        { uid: b.aUid, opponent: b.bName || 'a teammate' },
        { uid: b.bUid, opponent: b.aName || 'a teammate' },
    ];
    await Promise.all(recipients.map((r) => (0, outbox_1.enqueueNotification)({
        userId: r.uid,
        type: 'battle',
        title: 'You’ve got a battle!',
        body: `${name}: you're matched against ${r.opponent}.`,
        dedupeKey: `team:battle:${battleId}:${r.uid}`,
        collapseKey: `team:battle:${battleId}`,
        data: { type: 'battle', battleId, teamId: b.teamId || '', kind: 'team_battle' },
    })));
    return null;
});
exports.onTeamGroupMessageCreate = functions.firestore
    .document('teams/{teamId}/messages/{messageId}')
    .onCreate(async (snap, context) => {
    (0, firebaseAdmin_1.initFirebaseAdmin)();
    const db = firebaseAdmin_1.admin.firestore();
    const { teamId, messageId } = context.params;
    const msg = snap.data();
    if (!msg)
        return null;
    const name = await teamName(db, teamId);
    const membersSnap = await db.collection('teams').doc(teamId).collection('members').get();
    const text = String(msg.text || '').slice(0, 180);
    const senderId = String(msg.senderId || msg.uid || '');
    const senderName = await publicUserName(db, senderId, [msg.senderName, msg.senderUsername], 'Team member');
    const isWarning = msg.kind === 'warning' && !!msg.targetUid;
    const recipientIds = isWarning
        ? [String(msg.targetUid)]
        : membersSnap.docs
            .map((d) => d.id)
            .filter((uid) => uid && uid !== senderId);
    await Promise.all(recipientIds
        .filter(Boolean)
        .map((uid) => (0, outbox_1.enqueueNotification)({
        userId: uid,
        type: 'team',
        title: isWarning ? `Team warning · ${name}` : `${name} · ${senderName}`,
        body: text || 'New team message',
        dedupeKey: `team:msg:${teamId}:${messageId}:${uid}`,
        collapseKey: `team:msg:${teamId}`,
        data: {
            type: 'team',
            teamId,
            kind: isWarning ? 'team_warning' : 'group_message',
        },
    })));
    return null;
});
//# sourceMappingURL=teamNotify.js.map