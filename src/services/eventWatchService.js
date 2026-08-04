// eventWatchService.js
//
// Opt-in alerts for app-wide events (e.g. "notify me when there's a battle").
// Stored in Firestore `eventWatches`; Cloud Functions fan out pushes when the
// event fires.

import { db, firebaseEnabled } from '../config/firebase';

const EVENT_WATCHES = 'eventWatches';

const WATCH_TRIGGER = /\b(notify|tell|alert|let me know|ping|message|remind)\b/i;
const BATTLE_HINT = /\b(battle|battles|pk|face[- ]?off|head[- ]?to[- ]?head)\b/i;

/** Cheap pre-filter for battle-event watches (not person-specific live watches). */
export function looksLikeEventWatch(text) {
  const t = String(text || '');
  if (!/\bwhen\b/i.test(t)) return false;
  if (!WATCH_TRIGGER.test(t)) return false;
  if (!BATTLE_HINT.test(t)) return false;
  // Person-specific battle arrange / live watch should win elsewhere.
  if (/\b(between|with|against|vs\.?)\s+\w/i.test(t) && /\b(me|my|i)\b/i.test(t)) return false;
  return (
    /\bwhen\s+(?:there(?:'s| is)|a|any)\s+(?:\w+\s+){0,2}battle/i.test(t) ||
    /\bwhen\s+(?:a\s+)?battle\s+(?:starts?|begins?|happens?|goes?\s+live)\b/i.test(t) ||
    /\b(battle|battles)\s+(?:start|begin|go\s+live|happen)/i.test(t)
  );
}

export async function resolveEventWatch(text) {
  if (looksLikeEventWatch(text)) {
    return { isEventWatch: true, type: 'battle' };
  }
  return { isEventWatch: false };
}

function eventWatchId(watcherUid, type) {
  return `${watcherUid}__${type}`;
}

export async function addEventWatch(watcherUid, type) {
  if (!firebaseEnabled || !db?.collection || !watcherUid) return null;
  if (type !== 'battle') return null;
  const id = eventWatchId(watcherUid, type);
  const rec = {
    watcherUid,
    type,
    active: true,
    createdAt: Date.now(),
  };
  try {
    await db.collection(EVENT_WATCHES).doc(id).set(rec, { merge: true });
    return { id, ...rec };
  } catch {
    return null;
  }
}

export async function listEventWatches(watcherUid) {
  if (!firebaseEnabled || !db?.collection || !watcherUid) return [];
  try {
    const snap = await db.collection(EVENT_WATCHES).where('watcherUid', '==', watcherUid).get();
    return (snap?.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.active !== false)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}

export async function removeEventWatch(watcherUid, id) {
  if (!firebaseEnabled || !db?.collection || !id) return;
  try {
    await db.collection(EVENT_WATCHES).doc(id).delete();
  } catch {
    /* ignore */
  }
}

export function eventWatchLabel(type) {
  return type === 'battle' ? 'a battle goes live on Blyp' : 'that happens';
}

export default {
  looksLikeEventWatch,
  resolveEventWatch,
  addEventWatch,
  listEventWatches,
  removeEventWatch,
  eventWatchLabel,
};
