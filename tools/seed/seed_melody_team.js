/*
 * Seed the first official Blyp team with Melody as the team leader.
 *
 * Team profiles are intentionally NOT client-creatable (the "apply to run a
 * team" flow is gated), so the initial team is seeded here with the Admin SDK.
 *
 * Prerequisites:
 *   • Admin credentials, either:
 *       - GOOGLE_APPLICATION_CREDENTIALS=<path to service-account.json>, or
 *       - `gcloud auth application-default login` (uses your ADC)
 *
 * Env:
 *   PROJECT_ID     (default blyp-master)
 *   LEADER_NAME    (default "Melody") — matched against users' displayName/username
 *   LEADER_UID     (optional) — use an explicit uid instead of name lookup
 *   TEAM_NAME      (default "Melody's Team")
 *   TEAM_DESC      (default a friendly description)
 *
 * Run: node tools/seed/seed_melody_team.js
 */
'use strict';

const admin = require('firebase-admin');

const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
const LEADER_NAME = process.env.LEADER_NAME || 'Melody';
const LEADER_UID = process.env.LEADER_UID || '';
const TEAM_NAME = process.env.TEAM_NAME || "Melody's Team";
const TEAM_DESC =
  process.env.TEAM_DESC ||
  'The first official Blyp team. Go live together, run battles and grow with a crew that has your back.';

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const log = (...a) => console.log('[seed-team]', ...a);

const photoOf = (u) => (u && (u.photoURL || u.avatar || u.userPhotoURL || u.photo)) || null;

async function findLeader() {
  if (LEADER_UID) {
    const snap = await db.collection('users').doc(LEADER_UID).get();
    if (!snap.exists) throw new Error(`LEADER_UID ${LEADER_UID} not found in users`);
    return { uid: snap.id, ...snap.data() };
  }
  // Match by displayName or username (case-insensitive) against the users set.
  const wanted = LEADER_NAME.trim().toLowerCase();
  const all = await db.collection('users').get();
  const match = all.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .find((u) => {
      const dn = String(u.displayName || '').trim().toLowerCase();
      const un = String(u.username || '').trim().toLowerCase().replace(/^@+/, '');
      return dn === wanted || un === wanted;
    });
  if (!match) throw new Error(`No user named "${LEADER_NAME}" found. Set LEADER_UID explicitly.`);
  return match;
}

async function main() {
  const leader = await findLeader();
  const leaderName = leader.displayName || leader.username || LEADER_NAME;
  const leaderPhoto = photoOf(leader);
  log(`Leader: ${leaderName} (${leader.uid})`);

  // Stable, idempotent team id so re-running this script updates rather than
  // duplicates.
  const teamId = `team_${leader.uid}`;
  const teamRef = db.collection('teams').doc(teamId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await teamRef.set(
    {
      name: TEAM_NAME,
      description: TEAM_DESC,
      leaderId: leader.uid,
      leaderName,
      leaderPhoto,
      memberCount: 1,
      memberIds: admin.firestore.FieldValue.arrayUnion(leader.uid),
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  await teamRef.collection('members').doc(leader.uid).set(
    {
      uid: leader.uid,
      displayName: leaderName,
      photoURL: leaderPhoto,
      role: 'leader',
      hoursLive: 0,
      joinedAt: now,
    },
    { merge: true }
  );

  log(`Seeded team "${TEAM_NAME}" (${teamId}) with ${leaderName} as leader.`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[seed-team] failed:', e?.message || e);
  process.exit(1);
});
