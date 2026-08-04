// presenceService.js
//
// Lightweight foreground presence so "notify me when <person> is next on the
// app" can work. We stamp users/{uid}.presence = { state, lastSeenAt } when the
// app becomes active/backgrounded. A Cloud Function watches the offline->online
// transition and notifies anyone who asked to be told. A server-side sweep marks
// stale sessions offline (covers hard kills), so the next open is a real
// transition. This is intentionally cheap: we only write on AppState changes,
// not on a timer.

import { AppState } from 'react-native';
import { db, firebaseEnabled } from '../config/firebase';

function userDoc(uid) {
  return db.collection('users').doc(uid);
}

async function writePresence(uid, state) {
  if (!firebaseEnabled || !db?.collection || !uid) return;
  try {
    await userDoc(uid).set({ presence: { state, lastSeenAt: Date.now() } }, { merge: true });
  } catch {
    /* presence is best-effort; never break the app */
  }
}

/**
 * Begin tracking presence for a signed-in user. Returns a cleanup function that
 * detaches the listener and marks the user offline (e.g. on logout/unmount).
 */
export function startPresence(uid) {
  if (!firebaseEnabled || !uid) return () => {};

  writePresence(uid, 'online');

  const onChange = (next) => {
    if (next === 'active') writePresence(uid, 'online');
    else if (next === 'background' || next === 'inactive') writePresence(uid, 'offline');
  };

  let sub = null;
  try {
    sub = AppState.addEventListener('change', onChange);
  } catch {
    /* ignore */
  }

  return () => {
    try {
      sub?.remove?.();
    } catch {
      /* ignore */
    }
    writePresence(uid, 'offline');
  };
}

export default { startPresence };
