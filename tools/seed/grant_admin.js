/*
 * Grant (or revoke) in-app admin for a user by writing the canonical Firestore
 * role fields that the mobile app reads (useIsAdmin -> users/{uid}.roles[] /
 * isAdmin). Firestore users docs are keyed by the Cognito sub, which is also the
 * Firebase auth uid (custom token mints uid == sub), so this is exactly what the
 * app checks at runtime.
 *
 * This is the direct way to make a user an in-app admin without going through
 * the admin console Role picker. (Admin *web console* access is separate: Cognito
 * sign-in at https://admin.blyp.world gated by ADMIN_ALLOWLIST_SUBS on Cloud Run.
 * ADMIN_LOGIN_ACCOUNTS / shared-password login is retired.)
 *
 * Prerequisites:
 *   • Admin credentials, either:
 *       - GOOGLE_APPLICATION_CREDENTIALS=<path to service-account.json>, or
 *       - `gcloud auth application-default login` (uses your ADC)
 *
 * Env:
 *   PROJECT_ID   (default blyp-master)
 *   USER_NAME    (default "Melody") — matched against users' displayName/username
 *   USER_UID     (optional) — explicit Firestore users doc id (Cognito sub)
 *   USER_EMAIL   (optional) — fallback lookup by email
 *   REVOKE       (optional) — set to "1"/"true" to remove admin instead of grant
 *
 * Run: node tools/seed/grant_admin.js
 *      USER_NAME=Melody node tools/seed/grant_admin.js
 *      REVOKE=1 USER_UID=<sub> node tools/seed/grant_admin.js
 */
'use strict';

const admin = require('firebase-admin');

const PROJECT_ID = process.env.PROJECT_ID || 'blyp-master';
const USER_NAME = process.env.USER_NAME || 'Melody';
const USER_UID = process.env.USER_UID || '';
const USER_EMAIL = (process.env.USER_EMAIL || '').trim().toLowerCase();
const REVOKE = ['1', 'true', 'yes'].includes(String(process.env.REVOKE || '').toLowerCase());

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const log = (...a) => console.log('[grant-admin]', ...a);

async function findUser() {
  if (USER_UID) {
    const snap = await db.collection('users').doc(USER_UID).get();
    if (!snap.exists) throw new Error(`USER_UID ${USER_UID} not found in users`);
    return { uid: snap.id, ...snap.data() };
  }
  if (USER_EMAIL) {
    const byEmail = await db.collection('users').where('email', '==', USER_EMAIL).limit(1).get();
    if (!byEmail.empty) {
      const d = byEmail.docs[0];
      return { uid: d.id, ...d.data() };
    }
  }
  const wanted = USER_NAME.trim().toLowerCase();
  const all = await db.collection('users').get();
  const match = all.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .find((u) => {
      const dn = String(u.displayName || '').trim().toLowerCase();
      const un = String(u.username || '').trim().toLowerCase().replace(/^@+/, '');
      return dn === wanted || un === wanted;
    });
  if (!match) throw new Error(`No user named "${USER_NAME}" found. Set USER_UID or USER_EMAIL explicitly.`);
  return match;
}

async function main() {
  const user = await findUser();
  const name = user.displayName || user.username || USER_NAME;
  log(`${REVOKE ? 'Revoking admin from' : 'Granting admin to'}: ${name} (${user.uid})`);

  const fields = REVOKE
    ? {
        roles: admin.firestore.FieldValue.arrayRemove('admin'),
        isAdmin: false,
        adminRoleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }
    : {
        roles: admin.firestore.FieldValue.arrayUnion('admin'),
        isAdmin: true,
        adminRoleUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

  await db.collection('users').doc(user.uid).set(fields, { merge: true });

  const after = await db.collection('users').doc(user.uid).get();
  const data = after.data() || {};
  log(`Done. roles=${JSON.stringify(data.roles || [])} isAdmin=${data.isAdmin === true}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[grant-admin] failed:', e?.message || e);
  process.exit(1);
});
