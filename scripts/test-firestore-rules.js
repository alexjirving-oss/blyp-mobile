/**
 * Firestore security rules — fail-closed emulator tests.
 *
 * Prefer:
 *   firebase emulators:exec --only firestore "npm run test:rules:firestore"
 *
 * Or with an already-running emulator:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:rules:firestore
 */

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  writeBatch,
} = require('firebase/firestore');

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-blyp-rules';
const RULES_PATH = path.join(__dirname, '..', 'firestore.wave0-live.rules');

(async () => {
  let failures = 0;
  const emulatorHostString = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [emHost, emPortRaw] = emulatorHostString.split(':');
  const emPort = parseInt(emPortRaw, 10) || 8080;

  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: emHost,
      port: emPort,
    },
  });

  const ownerId = 'user_owner';
  const otherId = 'user_other';
  const ownerDb = env.authenticatedContext(ownerId).firestore();
  const otherDb = env.authenticatedContext(otherId).firestore();
  const anonDb = env.unauthenticatedContext().firestore();

  async function expectAllow(promise, label) {
    try {
      await assertSucceeds(promise);
      console.log(`ALLOW: ${label}`);
    } catch (e) {
      failures += 1;
      console.error(`FAIL expected ALLOW: ${label}`, e?.message || e);
    }
  }

  async function expectDeny(promise, label) {
    try {
      await assertFails(promise);
      console.log(`DENY: ${label}`);
    } catch (e) {
      failures += 1;
      console.error(`FAIL expected DENY: ${label}`, e?.message || e);
    }
  }

  console.log(`Connected to Firestore emulator ${emHost}:${emPort}`);

  // Economy — client cannot mint/spend.
  await expectDeny(
    setDoc(doc(ownerDb, 'wallets', ownerId), { balance: 9999 }),
    'owner cannot write own wallet'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'gems', ownerId), { balance: 9999 }),
    'owner cannot write own gems'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'transactions', 'txn1'), { userId: ownerId, amount: 1 }),
    'client cannot write transactions'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'gifts', 'gift1'), { fromUserId: ownerId, toUserId: otherId }),
    'client cannot write gifts'
  );

  // Seed wallet via admin context for read checks.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'wallets', ownerId), { balance: 10 });
  });
  await expectAllow(getDoc(doc(ownerDb, 'wallets', ownerId)), 'owner reads own wallet');
  await expectDeny(getDoc(doc(otherDb, 'wallets', ownerId)), 'other cannot read owner wallet');
  await expectDeny(getDoc(doc(anonDb, 'wallets', ownerId)), 'anon cannot read wallet');

  // Privileged collections locked.
  await expectDeny(getDoc(doc(ownerDb, 'roles', 'admin')), 'roles read denied');
  await expectDeny(setDoc(doc(ownerDb, 'roles', 'admin'), { role: 'admin' }), 'roles write denied');
  await expectDeny(
    setDoc(doc(ownerDb, 'moderationQueue', 'm1'), { status: 'open' }),
    'moderationQueue write denied'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'analytics', 'e1'), { type: 'page' }),
    'analytics write denied'
  );

  // Privacy requests.
  await expectAllow(
    setDoc(doc(ownerDb, 'privacyRequests', 'req1'), {
      userId: ownerId,
      type: 'export',
      status: 'queued',
    }),
    'owner queues export request'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'privacyRequests', 'req2'), {
      userId: otherId,
      type: 'deletion',
      status: 'queued',
    }),
    'cannot queue privacy request for another user'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'privacyRequests', 'req3'), {
      userId: ownerId,
      type: 'export',
      status: 'done',
    }),
    'cannot create privacy request with non-queued status'
  );
  await expectDeny(
    updateDoc(doc(ownerDb, 'privacyRequests', 'req1'), { status: 'done' }),
    'client cannot update privacy request'
  );

  // Fake follower mint blocked (followerId must equal auth uid).
  await expectDeny(
    setDoc(doc(ownerDb, 'users', otherId, 'followers', 'fake_follower_1'), {
      createdAt: Date.now(),
    }),
    'cannot create fake follower under another user'
  );
  await expectAllow(
    setDoc(doc(ownerDb, 'users', otherId, 'followers', ownerId), {
      createdAt: Date.now(),
    }),
    'user can follow as self'
  );

  // Own user profile updates.
  await expectAllow(
    setDoc(doc(ownerDb, 'users', ownerId), { displayName: 'Owner' }),
    'owner writes own user doc'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'users', otherId), { displayName: 'Hijack' }),
    'cannot write another user doc'
  );

  // P0: owners cannot self-grant admin / roles (create or update).
  await expectDeny(
    setDoc(doc(otherDb, 'users', 'user_self_admin'), {
      displayName: 'Nope',
      isAdmin: true,
    }),
    'cannot create user doc with isAdmin true'
  );
  // otherId creating as self with isAdmin
  await expectDeny(
    setDoc(doc(otherDb, 'users', otherId), {
      displayName: 'Other',
      isAdmin: true,
    }),
    'cannot create own user doc with isAdmin true'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'users', ownerId), { roles: ['admin'] }, { merge: true }),
    'cannot set roles admin on own user doc'
  );
  await expectAllow(
    setDoc(doc(ownerDb, 'users', ownerId), { bio: 'hello' }, { merge: true }),
    'owner can update bio without touching admin fields'
  );
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ownerId), {
      displayName: 'Owner',
      isAdmin: true,
      roles: ['admin'],
    });
  });
  await expectDeny(
    setDoc(doc(ownerDb, 'users', ownerId), { isAdmin: false, roles: [] }, { merge: true }),
    'owner cannot clear server-granted admin fields'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'users', ownerId), { feedPriorityAccount: 'boost' }, { merge: true }),
    'owner cannot set feedPriorityAccount'
  );
  await expectAllow(
    setDoc(doc(ownerDb, 'users', ownerId), { bio: 'still me' }, { merge: true }),
    'owner can edit bio while admin fields stay frozen'
  );

  // Teams: owner controls, member leave, and restricted member chat.
  const teamId = 'team_rules';
  const outsiderId = 'user_outsider';
  const outsiderDb = env.authenticatedContext(outsiderId).firestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await setDoc(doc(adminDb, 'teams', teamId), {
      name: 'Rules Team',
      leaderId: ownerId,
      leaderName: 'Owner',
      status: 'active',
      memberIds: [ownerId, otherId],
      memberCount: 2,
    });
    await setDoc(doc(adminDb, 'teams', teamId, 'members', ownerId), {
      uid: ownerId,
      displayName: 'Owner',
      role: 'leader',
    });
    await setDoc(doc(adminDb, 'teams', teamId, 'members', otherId), {
      uid: otherId,
      displayName: 'Other',
      role: 'member',
      restricted: false,
    });
  });

  await expectDeny(
    updateDoc(doc(otherDb, 'teams', teamId), {
      status: 'closed',
      closedBy: otherId,
      memberIds: [],
      memberCount: 0,
    }),
    'member cannot close team'
  );
  await expectAllow(
    updateDoc(doc(ownerDb, 'teams', teamId, 'members', otherId), {
      restricted: true,
      restrictedBy: ownerId,
    }),
    'owner restricts member'
  );
  await expectDeny(
    setDoc(doc(otherDb, 'teams', teamId, 'messages', 'restricted-message'), {
      uid: otherId,
      senderId: otherId,
      senderName: 'Other',
      kind: 'message',
      text: 'blocked',
    }),
    'restricted member cannot post to team'
  );
  await expectAllow(
    setDoc(doc(ownerDb, 'teams', teamId, 'messages', 'owner-message'), {
      uid: ownerId,
      senderId: ownerId,
      senderName: 'Owner',
      kind: 'message',
      text: 'Owner update',
    }),
    'owner posts to team'
  );
  await expectAllow(
    setDoc(doc(ownerDb, 'teams', teamId, 'messages', 'warning-message'), {
      uid: ownerId,
      senderId: ownerId,
      senderName: 'Owner',
      targetUid: otherId,
      kind: 'warning',
      text: 'Please follow the team rules.',
    }),
    'owner warns member in team'
  );
  await expectDeny(
    getDoc(doc(outsiderDb, 'teams', teamId, 'messages', 'owner-message')),
    'non-member cannot read team chat'
  );
  await expectAllow(
    updateDoc(doc(ownerDb, 'teams', teamId, 'members', otherId), {
      restricted: false,
      restrictedBy: null,
    }),
    'owner lifts member restriction'
  );
  await expectAllow(
    setDoc(doc(otherDb, 'teams', teamId, 'messages', 'member-message'), {
      uid: otherId,
      senderId: otherId,
      senderName: 'Other',
      kind: 'message',
      text: 'Thanks',
    }),
    'unrestricted member posts to team'
  );
  await expectDeny(
    updateDoc(doc(otherDb, 'teams', teamId), {
      memberIds: [ownerId],
      memberCount: 1,
    }),
    'member cannot alter roster without deleting membership'
  );

  const leaveBatch = writeBatch(otherDb);
  leaveBatch.delete(doc(otherDb, 'teams', teamId, 'members', otherId));
  leaveBatch.update(doc(otherDb, 'teams', teamId), {
    memberIds: [ownerId],
    memberCount: 1,
    updatedAt: Date.now(),
  });
  await expectAllow(leaveBatch.commit(), 'member leaves team atomically');

  await expectAllow(
    updateDoc(doc(ownerDb, 'teams', teamId), {
      status: 'closed',
      closedBy: ownerId,
      memberIds: [],
      memberCount: 0,
    }),
    'owner closes team'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'teams', teamId, 'messages', 'closed-message'), {
      uid: ownerId,
      senderId: ownerId,
      senderName: 'Owner',
      kind: 'message',
      text: 'No longer active',
    }),
    'closed team rejects new chat'
  );

  // Catch-all denies unknown collections (closes AUD-C002 regression).
  await expectDeny(
    setDoc(doc(ownerDb, 'secretVault', 'x'), { secret: true }),
    'unknown collection write denied'
  );
  await expectDeny(getDoc(doc(anonDb, 'liveStreams', 's1')), 'anon liveStreams read denied');

  // Posts: create own only.
  await expectAllow(
    setDoc(doc(ownerDb, 'posts', 'p1'), { userId: ownerId, text: 'hi' }),
    'owner creates own post'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'posts', 'p2'), { userId: otherId, text: 'nope' }),
    'cannot create post as another user'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'posts', 'p_hidden'), {
      userId: ownerId,
      text: 'x',
      moderation: { hidden: true },
    }),
    'cannot create post already admin-hidden'
  );

  // P0: owner cannot clear admin moderation hide / feedPriority.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'posts', 'p_mod'), {
      userId: ownerId,
      text: 'visible',
      moderation: { hidden: true, source: 'admin' },
      feedPriority: 'less',
    });
  });
  await expectDeny(
    setDoc(
      doc(ownerDb, 'posts', 'p_mod'),
      { moderation: { hidden: false } },
      { merge: true }
    ),
    'owner cannot clear moderation.hidden'
  );
  await expectDeny(
    setDoc(doc(ownerDb, 'posts', 'p_mod'), { feedPriority: 'high' }, { merge: true }),
    'owner cannot change feedPriority'
  );
  await expectAllow(
    setDoc(doc(ownerDb, 'posts', 'p_mod'), { text: 'edited caption' }, { merge: true }),
    'owner can edit caption while moderation stays frozen'
  );

  await env.cleanup();

  if (failures > 0) {
    console.error(`\nFirestore rules tests FAILED (${failures} assertion(s))`);
    process.exit(1);
  }
  console.log('\nFirestore rules tests PASSED');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
