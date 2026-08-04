// userWatchService.js
//
// "Notify me when <person> is next live / next on the app."
//
// The blyp bar can turn a natural-language request into an opt-in *watch* on
// another user. We resolve the person to a real Blyp user, then write a doc to
// Firestore `userWatches`. A Cloud Function (Admin SDK) reads watches by target
// and fans a push out the moment that user goes live or comes online, then
// deactivates the one-shot watch. Delivery rides the existing notification spine
// (users/{uid}/devices + dispatcher + FCM), so it works with the app closed.
//
// Everything degrades gracefully: no Firebase -> no-op; no Gemini -> regex parse.

import { db, firebaseEnabled, geminiApiUrl, geminiAuthHeaders } from '../config/firebase';
import { fixStorageUrl } from '../utils/urlUtils';

const WATCHES = 'userWatches';

// ---------------------------------------------------------------------------
// Intent detection + parsing
// ---------------------------------------------------------------------------

const WATCH_TRIGGER = /\b(notify|tell|alert|let me know|ping|message|remind)\b/i;
const LIVE_HINT = /\b(go(?:es)?\s+live|going\s+live|live|streaming|stream|on\s+stream)\b/i;
const ONLINE_HINT = /\b(on the app|on blyp|online|comes?\s+on(?:line)?|is\s+on|active|opens?\s+the\s+app|next\s+on)\b/i;

/** Cheap pre-filter: does this look like a "notify me when <person>…" request? */
export function looksLikeWatch(text) {
  const t = String(text || '');
  if (!/\bwhen\b/i.test(t)) return false;
  if (!WATCH_TRIGGER.test(t)) return false;
  return LIVE_HINT.test(t) || ONLINE_HINT.test(t);
}

function guessType(text) {
  const t = String(text || '');
  // "live" is the stronger signal; only fall back to online when live isn't implied.
  if (LIVE_HINT.test(t) && !/\bonline\b/i.test(t)) return 'live';
  if (ONLINE_HINT.test(t)) return 'online';
  if (LIVE_HINT.test(t)) return 'live';
  return '';
}

/** Best-effort offline extraction of the person's name from the phrasing. */
function parseWatchRegex(text) {
  const raw = String(text || '').trim();
  if (!looksLikeWatch(raw)) return { isWatch: false };
  const type = guessType(raw);
  if (!type) return { isWatch: false };

  const patterns = [
    /when\s+(.+?)(?:'s)?\s+next\s+live\b/i,
    /when\s+(.+?)\s+(?:is|are|'s|next|goes?|going|comes?|come|gets?|starts?|begins?|logs?|signs?)\b/i,
    /when\s+(.+?)\s+(?:live|streaming|online|on\s+(?:the\s+)?app)\b/i,
  ];
  let name = '';
  for (const re of patterns) {
    const m = raw.match(re);
    if (m && m[1]) {
      name = m[1].trim();
      break;
    }
  }
  // Strip leading articles/pronouns that aren't part of a name.
  name = name.replace(/^(?:the|a|an|my|that)\s+/i, '').trim();
  if (!name) return { isWatch: false };
  // Pronoun subjects ("when I'm online", "when you're live") aren't a person to
  // resolve — bail so this falls through to the AI parse / reminder path.
  if (/^(?:i|i'm|im|me|you|you're|youre|we|we're|they|they're|he|she|it)$/i.test(name)) {
    return { isWatch: false };
  }
  return { isWatch: true, targetName: name, type };
}

/** Ask Gemini to pull out { isWatch, targetName, type }. Returns null on failure. */
export async function parseWatchAI(text) {
  const url = geminiApiUrl;
  const raw = String(text || '').trim();
  if (!url || !raw) return null;

  const prompt =
    `Decide whether the user wants to be notified about a specific PERSON becoming available.\n` +
    `User message: "${raw}"\n\n` +
    `Respond with ONLY strict minified JSON in this exact shape:\n` +
    `{"isWatch": boolean, "targetName": string, "type": "live" | "online" | ""}\n` +
    `Rules:\n` +
    `- isWatch true ONLY if they want an alert WHEN a specific named person becomes available.\n` +
    `- "type" = "live" if it's about that person going live / streaming; "online" if it's about them being on the app / online / active again.\n` +
    `- "targetName" = just the person's name or @handle, nothing else (no "notify me", no verbs).\n` +
    `- If it isn't such a request, return {"isWatch": false, "targetName": "", "type": ""}.`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: await geminiAuthHeaders(),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(out);
    if (!parsed || parsed.isWatch !== true) return { isWatch: false };
    const type = parsed.type === 'live' || parsed.type === 'online' ? parsed.type : '';
    const targetName = String(parsed.targetName || '').trim();
    if (!type || !targetName) return { isWatch: false };
    return { isWatch: true, targetName, type };
  } catch {
    return null;
  }
}

/**
 * Resolve a free-text request into a watch intent. Fast regex first; lean on AI
 * to catch phrasings the regex misses. Always resolves to a { isWatch, … } shape.
 */
export async function resolveWatch(text) {
  const rx = parseWatchRegex(text);
  if (rx.isWatch) return rx;
  if (looksLikeWatch(text)) {
    try {
      const ai = await parseWatchAI(text);
      if (ai && ai.isWatch) return ai;
    } catch {
      /* ignore */
    }
  }
  return { isWatch: false };
}

// ---------------------------------------------------------------------------
// Person resolution
// ---------------------------------------------------------------------------

function userPhoto(u) {
  return fixStorageUrl(u?.photoURL || u?.avatar || u?.userPhotoURL || u?.photo || '');
}

/**
 * Find the Blyp user that best matches a free-text name/@handle. Returns
 * { id, displayName, username, photoURL } or null.
 */
export async function findUserByName(name, excludeUid) {
  if (!firebaseEnabled || !db?.collection) return null;
  const q = String(name || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!q) return null;

  try {
    const snap = await db.collection('users').limit(150).get();
    const all = (snap?.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u?.id && u.id !== excludeUid);

    let best = null;
    let bestScore = 0;
    for (const u of all) {
      const username = String(u.username || '').toLowerCase();
      const display = String(u.displayName || u.name || '').toLowerCase();
      let score = 0;
      if (username && username === q) score = 100;
      else if (display && display === q) score = 95;
      else if (username && username.startsWith(q)) score = 80;
      else if (display && display.startsWith(q)) score = 70;
      else if (username && username.includes(q)) score = 50;
      else if (display && display.includes(q)) score = 45;
      // Also try matching the query's first token against a first name.
      else if (display) {
        const firstName = display.split(/\s+/)[0];
        if (firstName && (firstName === q || q.startsWith(firstName) || firstName.startsWith(q))) score = 40;
      }
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    if (!best) return null;
    return {
      id: best.id,
      displayName: best.displayName || best.name || best.username || 'User',
      username: best.username || '',
      photoURL: userPhoto(best),
    };
  } catch {
    return null;
  }
}

/**
 * Like findUserByName, but returns a ranked list of plausible matches so the
 * caller can ask the user to confirm which person they meant ("did you mean…").
 * Returns [{ id, displayName, username, photoURL }] best-first, or [].
 */
export async function findUsersByName(name, excludeUid, limit = 6) {
  if (!firebaseEnabled || !db?.collection) return [];
  const q = String(name || '').replace(/^@/, '').trim().toLowerCase();
  if (!q) return [];
  try {
    const snap = await db.collection('users').limit(300).get();
    const all = (snap?.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((u) => u?.id && u.id !== excludeUid);
    const scored = [];
    for (const u of all) {
      const username = String(u.username || '').toLowerCase();
      const display = String(u.displayName || u.name || '').toLowerCase();
      let score = 0;
      if (username && username === q) score = 100;
      else if (display && display === q) score = 95;
      else if (username && username.startsWith(q)) score = 80;
      else if (display && display.startsWith(q)) score = 70;
      else if (username && username.includes(q)) score = 50;
      else if (display && display.includes(q)) score = 45;
      else if (display) {
        const firstName = display.split(/\s+/)[0];
        if (firstName && (firstName === q || q.startsWith(firstName) || firstName.startsWith(q))) score = 40;
      }
      if (score > 0) {
        scored.push({
          score,
          user: {
            id: u.id,
            displayName: u.displayName || u.name || u.username || 'User',
            username: u.username || '',
            photoURL: userPhoto(u),
          },
        });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, limit)).map((s) => s.user);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function watchId(watcherUid, targetUid, type) {
  return `${watcherUid}__${targetUid}__${type}`;
}

/** Create (or refresh) a watch. Returns the stored record, or null on failure. */
export async function addWatch(watcherUid, target, type) {
  if (!firebaseEnabled || !db?.collection || !watcherUid || !target?.id) return null;
  if (type !== 'live' && type !== 'online') return null;
  const id = watchId(watcherUid, target.id, type);
  const rec = {
    watcherUid,
    targetUid: target.id,
    type,
    // Backend queries watches by this single field (no composite index needed).
    key: `${target.id}__${type}`,
    targetName: target.displayName || target.username || 'User',
    targetUsername: target.username || '',
    targetPhotoURL: target.photoURL || '',
    active: true,
    createdAt: Date.now(),
  };
  try {
    await db.collection(WATCHES).doc(id).set(rec, { merge: true });
    return { id, ...rec };
  } catch {
    return null;
  }
}

/** List the current user's active watches, newest first. */
export async function listWatches(watcherUid) {
  if (!firebaseEnabled || !db?.collection || !watcherUid) return [];
  try {
    const snap = await db.collection(WATCHES).where('watcherUid', '==', watcherUid).get();
    const rows = (snap?.docs || [])
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.active !== false);
    return rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}

/** Cancel a watch. */
export async function removeWatch(watcherUid, id) {
  if (!firebaseEnabled || !db?.collection || !id) return;
  try {
    await db.collection(WATCHES).doc(id).delete();
  } catch {
    /* ignore */
  }
}

/** Human label for a watch type, e.g. for confirmation copy. */
export function watchTypeLabel(type) {
  return type === 'live' ? 'goes live' : 'is next on the app';
}

export default {
  looksLikeWatch,
  parseWatchAI,
  resolveWatch,
  findUserByName,
  findUsersByName,
  addWatch,
  listWatches,
  removeWatch,
  watchTypeLabel,
};
