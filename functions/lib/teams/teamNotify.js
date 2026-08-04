"use strict";
/**
 * Team notifications — push fan-out for the Teams feature.
 *
 * Triggers (all ride the existing notification spine via enqueueNotification):
 *  - onTeamJoinRequestCreate: a user asks to join → notify the team leader.
 *  - onTeamJoinRequestDecision: leader accepts/declines → notify the requester.
 *  - onTeamBattleCreate: leader pairs two members → notify both.
 *  - onTeamGroupMessageCreate: leader messages the team → notify every member.
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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.onTeamGroupMessageCreate = exports.onTeamBattleCreate = exports.onTeamJoinRequestDecision = exports.onTeamJoinRequestCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const firebaseAdmin_1 = require("../firebaseAdmin");
const outbox_1 = require("../notifications/outbox");
async function teamName(db, teamId) {
    var _a;
    try {
        const snap = await db.collection('teams').doc(teamId).get();
        return (snap.exists && ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.name)) || 'your team';
    }
    catch (_b) {
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
    await (0, outbox_1.enqueueNotification)({
        userId: leaderId,
        type: 'team',
        title: 'New team request',
        body: `${req.displayName || 'Someone'} wants to join ${name}.`,
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
    await Promise.all(membersSnap.docs
        .map((d) => d.id)
        .filter((uid) => uid && uid !== msg.senderId)
        .map((uid) => (0, outbox_1.enqueueNotification)({
        userId: uid,
        type: 'team',
        title: `${name} · ${msg.senderName || 'Team leader'}`,
        body: text || 'New team message',
        dedupeKey: `team:msg:${teamId}:${messageId}:${uid}`,
        collapseKey: `team:msg:${teamId}`,
        data: { type: 'team', teamId, kind: 'group_message' },
    })));
    return null;
});
//# sourceMappingURL=teamNotify.js.map