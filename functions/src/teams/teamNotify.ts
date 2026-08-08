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

import * as functions from 'firebase-functions';
import { admin, initFirebaseAdmin } from '../firebaseAdmin';
import { enqueueNotification } from '../notifications/outbox';

function safePublicLabel(value: unknown, uid = '', fallback = ''): string {
  const label = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
  if (!label || label === uid) return fallback;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(label)) {
    return fallback;
  }
  if (/^\d{10,}$/.test(label)) return fallback;
  if (label.length > 20 && /^[A-Za-z0-9_-]+$/.test(label)) return fallback;
  if (/^user_/i.test(label)) return fallback;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(label)) return fallback;
  return label.slice(0, 80);
}

async function publicUserName(
  db: FirebaseFirestore.Firestore,
  uid: string,
  candidates: unknown[] = [],
  fallback = 'Someone'
): Promise<string> {
  if (!uid) {
    for (const value of candidates) {
      const label = safePublicLabel(value);
      if (label) return label;
    }
    return fallback;
  }
  const [userSnap, profileSnap] = await Promise.all([
    db.collection('users').doc(uid).get().catch(() => null),
    db.collection('userProfiles').doc(uid).get().catch(() => null),
  ]);
  const user = userSnap?.exists ? userSnap.data() as any : {};
  const profile = profileSnap?.exists ? profileSnap.data() as any : {};
  const values = [
    user?.displayName,
    profile?.displayName,
    ...candidates,
    user?.username,
    user?.handle,
    profile?.username,
    profile?.handle,
  ];
  for (const value of values) {
    const label = safePublicLabel(value, uid);
    if (label) return label;
  }
  return fallback;
}

async function teamName(db: FirebaseFirestore.Firestore, teamId: string): Promise<string> {
  try {
    const snap = await db.collection('teams').doc(teamId).get();
    if (!snap.exists) return 'your team';
    const team = (snap.data() || {}) as any;
    const leaderId = String(team.leaderId || '');
    const storedName = String(team.name || '').trim();
    const generatedFromInternalId =
      !storedName ||
      (!!leaderId && storedName.includes(leaderId)) ||
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(storedName) ||
      /^blyp[_-]\d+/i.test(storedName);
    if (!generatedFromInternalId) return storedName.slice(0, 80);
    const ownerName = await publicUserName(
      db,
      leaderId,
      [team.leaderDisplayName, team.leaderName, team.leaderUsername],
      'Team owner'
    );
    return `${ownerName}'s Team`;
  } catch {
    return 'your team';
  }
}

async function teamLeaderId(
  db: FirebaseFirestore.Firestore,
  teamId: string
): Promise<string | null> {
  try {
    const snap = await db.collection('teams').doc(teamId).get();
    return (snap.exists && (snap.data() as any)?.leaderId) || null;
  } catch {
    return null;
  }
}

export const onTeamJoinRequestCreate = functions.firestore
  .document('teams/{teamId}/joinRequests/{requesterId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const { teamId, requesterId } = context.params as { teamId: string; requesterId: string };
    const req = snap.data() as any;
    if (!req || req.status !== 'pending') return null;

    const leaderId = await teamLeaderId(db, teamId);
    if (!leaderId || leaderId === requesterId) return null;
    const name = await teamName(db, teamId);
    const requesterName = await publicUserName(
      db,
      requesterId,
      [req.displayName, req.username],
      'Someone'
    );

    await enqueueNotification({
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

export const onTeamJoinRequestDecision = functions.firestore
  .document('teams/{teamId}/joinRequests/{requesterId}')
  .onUpdate(async (change, context) => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const { teamId, requesterId } = context.params as { teamId: string; requesterId: string };
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    if (!after || before?.status === after?.status) return null;
    if (after.status !== 'accepted' && after.status !== 'rejected') return null;

    const name = await teamName(db, teamId);
    const accepted = after.status === 'accepted';

    await enqueueNotification({
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

export const onTeamBattleCreate = functions.firestore
  .document('teamBattles/{battleId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const { battleId } = context.params as { battleId: string };
    const b = snap.data() as any;
    if (!b || !b.aUid || !b.bUid) return null;
    const name = b.teamId ? await teamName(db, b.teamId) : 'your team';

    const recipients: Array<{ uid: string; opponent: string }> = [
      { uid: b.aUid, opponent: b.bName || 'a teammate' },
      { uid: b.bUid, opponent: b.aName || 'a teammate' },
    ];

    await Promise.all(
      recipients.map((r) =>
        enqueueNotification({
          userId: r.uid,
          type: 'battle',
          title: 'You’ve got a battle!',
          body: `${name}: you're matched against ${r.opponent}.`,
          dedupeKey: `team:battle:${battleId}:${r.uid}`,
          collapseKey: `team:battle:${battleId}`,
          data: { type: 'battle', battleId, teamId: b.teamId || '', kind: 'team_battle' },
        })
      )
    );
    return null;
  });

export const onTeamGroupMessageCreate = functions.firestore
  .document('teams/{teamId}/messages/{messageId}')
  .onCreate(async (snap, context) => {
    initFirebaseAdmin();
    const db = admin.firestore();
    const { teamId, messageId } = context.params as { teamId: string; messageId: string };
    const msg = snap.data() as any;
    if (!msg) return null;

    const name = await teamName(db, teamId);
    const membersSnap = await db.collection('teams').doc(teamId).collection('members').get();
    const text = String(msg.text || '').slice(0, 180);
    const senderId = String(msg.senderId || msg.uid || '');
    const senderName = await publicUserName(
      db,
      senderId,
      [msg.senderName, msg.senderUsername],
      'Team member'
    );
    const isWarning = msg.kind === 'warning' && !!msg.targetUid;
    const recipientIds = isWarning
      ? [String(msg.targetUid)]
      : membersSnap.docs
          .map((d) => d.id)
          .filter((uid) => uid && uid !== senderId);

    await Promise.all(
      recipientIds
        .filter(Boolean)
        .map((uid) =>
          enqueueNotification({
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
          })
        )
    );
    return null;
  });
