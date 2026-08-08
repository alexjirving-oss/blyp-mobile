import { AppState } from 'react-native';
import { db, firebaseEnabled } from '../config/firebase';

// Heartbeat keeps lastSeenAt fresh while the app stays foregrounded so chat
// headers do not flip to a stale "Xm ago" mid-session. Offline sweep still
// covers hard kills; this interval is intentionally light.
const HEARTBEAT_MS = 45 * 1000;

function userDoc(uid) {
  return db.collection('users').doc(uid);
}

async function writePresence(uid, state) {
  if (!firebaseEnabled || !db?.collection || !uid) return;
  try {
    await userDoc(uid).set(
      { presence: { state, lastSeenAt: Date.now() } },
      { merge: true },
    );
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

  let heartbeat = null;
  const clearHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  const armHeartbeat = () => {
    clearHeartbeat();
    heartbeat = setInterval(() => {
      try {
        if (AppState.currentState === 'active') writePresence(uid, 'online');
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_MS);
  };
  armHeartbeat();

  const onChange = (next) => {
    if (next === 'active') {
      writePresence(uid, 'online');
      armHeartbeat();
    } else if (next === 'background' || next === 'inactive') {
      clearHeartbeat();
      writePresence(uid, 'offline');
    }
  };

  let sub = null;
  try {
    sub = AppState.addEventListener('change', onChange);
  } catch {
    /* ignore */
  }

  return () => {
    clearHeartbeat();
    try {
      sub?.remove?.();
    } catch {
      /* ignore */
    }
    writePresence(uid, 'offline');
  };
}

/**
 * Relative / calendar last-seen label from an epoch ms (or numeric) stamp.
 * Uses the device locale for clock strings — no hardcoded timezone offset.
 */
export function formatLastSeenLabel(ms) {
  const ts = Number(ms);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';

  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return 'just now';

  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;

  const timeOpts = { hour: 'numeric', minute: '2-digit' };
  let timeStr = '';
  try {
    timeStr = date.toLocaleTimeString(undefined, timeOpts);
  } catch {
    timeStr = date.toLocaleTimeString();
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const todayStart = startOfDay(new Date());
  const thatStart = startOfDay(date);

  if (thatStart === todayStart) return `today at ${timeStr}`;
  if (thatStart === todayStart - 24 * 60 * 60 * 1000) return `yesterday at ${timeStr}`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24 * 7) {
    try {
      return date.toLocaleString(undefined, { weekday: 'short', ...timeOpts });
    } catch {
      return `${Math.floor(hrs / 24)}d ago`;
    }
  }

  try {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      ...timeOpts,
    });
  } catch {
    return date.toLocaleDateString();
  }
}

/** True when presence is online and the heartbeat is still fresh. */
export function isPresenceOnline(presence, freshnessMs = 3 * 60 * 1000) {
  if (!presence || presence.state !== 'online') return false;
  const last = Number(presence.lastSeenAt);
  if (!Number.isFinite(last) || last <= 0) return false;
  return Date.now() - last < freshnessMs;
}

export default { startPresence, formatLastSeenLabel, isPresenceOnline };
