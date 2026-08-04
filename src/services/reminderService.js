// reminderService — turns a natural-language request ("remind me to buy
// potatoes tomorrow") into a real scheduled device notification.
//
// Two parts:
//   parseReminder(text)   -> { isReminder, task, when: Date, whenLabel } | { isReminder:false }
//   scheduleReminder(...)  -> schedules a local notification via expo-notifications
//
// Everything is defensively guarded: if expo-notifications isn't present or
// permission is denied, scheduling fails softly with a clear reason rather than
// throwing. Reminders are local-only (work offline); no server round-trip.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { geminiApiUrl, geminiAuthHeaders } from '../config/firebase';
import { looksLikeWatch } from './userWatchService';
import { looksLikeEventWatch } from './eventWatchService';

const DEFAULT_HOUR = 9; // 9am when only a day is given
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function getNotifications() {
  try {
    // eslint-disable-next-line global-require
    return require('expo-notifications');
  } catch {
    return null;
  }
}

function clampFuture(date) {
  // Never schedule in the past; nudge to one minute out as a safety net.
  if (date.getTime() <= Date.now()) {
    return new Date(Date.now() + 60 * 1000);
  }
  return date;
}

function timeOfDayDefault(token) {
  switch (token) {
    case 'morning':
      return { h: 9, m: 0 };
    case 'afternoon':
      return { h: 14, m: 0 };
    case 'evening':
    case 'tonight':
      return { h: 19, m: 0 };
    case 'night':
      return { h: 21, m: 0 };
    default:
      return null;
  }
}

/** Parse an explicit clock time like "at 6pm", "6:30 pm", "18:00". */
function parseClock(text) {
  const m = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3] ? m[3].toLowerCase() : null;
  if (hour > 23 || minute > 59) return null;
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  // A bare 1-2 digit number with no am/pm and no colon is too ambiguous to be a
  // time on its own (e.g. "buy 2 apples") — require a meridiem or a colon.
  if (!mer && !m[2]) return null;
  return { h: hour, m: minute, raw: m[0] };
}

/**
 * Parse a reminder request. Returns isReminder:false for anything that isn't one.
 */
export function parseReminder(input) {
  const raw = String(input || '').trim();
  if (!raw) return { isReminder: false };

  // Must clearly be a reminder ask.
  if (!/\bremind(er)?\b/i.test(raw)) return { isReminder: false };

  // "Remind me when Melody goes live" is a watch, not a calendar reminder.
  if (looksLikeWatch(raw) || looksLikeEventWatch(raw)) return { isReminder: false };

  // Strip the trigger phrase to isolate the task + time.
  let rest = raw
    .replace(/^.*?\bremind(?:\s+me)?\b/i, '')
    .replace(/^\s*(?:to|that|about|of|for)\s+/i, '')
    .replace(/^.*?\bset\s+(?:a\s+)?reminder\b\s*(?:to|for|about)?\s*/i, '')
    .trim();
  if (!rest) rest = raw.replace(/\bremind(er)?\b/i, '').trim();

  const now = new Date();
  const when = new Date(now);
  let dayResolved = false;
  let clock = null;
  let removed = [];

  const lower = rest.toLowerCase();

  // 1) Relative: "in 30 minutes", "in 2 hours", "in 3 days"
  const rel = lower.match(/\bin\s+(\d{1,3})\s*(min(?:ute)?s?|hour?s?|hrs?|days?|weeks?)\b/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    if (/^min/.test(unit)) when.setMinutes(when.getMinutes() + n);
    else if (/^h/.test(unit)) when.setHours(when.getHours() + n);
    else if (/^day/.test(unit)) when.setDate(when.getDate() + n);
    else if (/^week/.test(unit)) when.setDate(when.getDate() + n * 7);
    dayResolved = true;
    removed.push(rel[0]);
  }

  // 2) Explicit clock time ("at 6pm")
  if (!rel) {
    clock = parseClock(rest);
    if (clock) removed.push(clock.raw);
  }

  // 3) Day keywords
  if (!dayResolved) {
    if (/\btomorrow\b/i.test(lower)) {
      when.setDate(when.getDate() + 1);
      dayResolved = true;
      removed.push('tomorrow');
    } else if (/\b(today|tonight|this (morning|afternoon|evening))\b/i.test(lower)) {
      dayResolved = true;
      const tod = lower.match(/\b(tonight|morning|afternoon|evening)\b/);
      if (tod && !clock) {
        const def = timeOfDayDefault(tod[1]);
        if (def) clock = { h: def.h, m: def.m };
      }
      removed.push((lower.match(/\b(today|tonight|this (morning|afternoon|evening))\b/) || [])[0]);
    } else if (/\bnext week\b/i.test(lower)) {
      when.setDate(when.getDate() + 7);
      dayResolved = true;
      removed.push('next week');
    } else {
      // weekday name (optionally "next monday" / "on friday")
      for (let i = 0; i < WEEKDAYS.length; i += 1) {
        const re = new RegExp(`\\b(next\\s+)?(on\\s+)?${WEEKDAYS[i]}\\b`, 'i');
        const wm = lower.match(re);
        if (wm) {
          const target = i;
          let delta = (target - when.getDay() + 7) % 7;
          if (delta === 0) delta = 7; // "monday" => next monday, not today
          if (wm[1]) delta += 0; // "next monday" already next occurrence
          when.setDate(when.getDate() + delta);
          dayResolved = true;
          removed.push(wm[0]);
          break;
        }
      }
    }
  }

  // Morning/evening words without a specific day default the time-of-day.
  if (!clock) {
    const tod = lower.match(/\b(morning|afternoon|evening|night)\b/);
    if (tod) {
      const def = timeOfDayDefault(tod[1]);
      if (def) {
        clock = { h: def.h, m: def.m };
        removed.push(tod[0]);
      }
    }
  }

  // Apply the time-of-day.
  if (!rel) {
    if (clock) {
      when.setHours(clock.h, clock.m, 0, 0);
    } else {
      when.setHours(DEFAULT_HOUR, 0, 0, 0);
    }
    // If only a clock time was given and it's already passed today, push to tomorrow.
    if (!dayResolved && clock && when.getTime() <= now.getTime()) {
      when.setDate(when.getDate() + 1);
    }
    // No day and no clock => tomorrow morning (a sensible default).
    if (!dayResolved && !clock) {
      when.setDate(when.getDate() + 1);
    }
  }

  // Build the task text by removing the matched time tokens + connector words.
  let task = rest;
  removed.filter(Boolean).forEach((tok) => {
    task = task.replace(new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  });
  task = task
    .replace(/\b(at|on|in|by|this|next)\b\s*$/i, '')
    .replace(/^\s*(?:a|an|the)\s+/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  if (!task) task = 'your reminder';
  // Capitalise the first letter for a tidy display ("hospital appointment" -> "Hospital appointment").
  task = task.charAt(0).toUpperCase() + task.slice(1);

  const safeWhen = clampFuture(when);
  return {
    isReminder: true,
    task,
    when: safeWhen,
    whenLabel: formatWhen(safeWhen),
  };
}

/** Friendly "Tomorrow at 9:00 AM" style label. */
export function formatWhen(date) {
  try {
    const d = new Date(date);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `today at ${time}`;
    if (isTomorrow) return `tomorrow at ${time}`;
    const day = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    return `${day} at ${time}`;
  } catch {
    return 'soon';
  }
}

async function ensurePermissionAndChannel(Notifications) {
  try {
    // Match PushService so local reminders use the same channel + foreground
    // presentation behaviour as FCM pushes.
    try {
      // eslint-disable-next-line global-require
      const PushService = require('./PushService');
      PushService.configureForegroundPresentation?.();
      await PushService.ensureAndroidChannel?.();
    } catch {
      /* optional */
    }

    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted || settings?.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;
    if (!granted && settings.canAskAgain !== false) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted || req?.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;
    }
    if (Platform.OS === 'android') {
      // Prefer PushService channel (blyp + custom jingle); fall back to local create.
      let channelId = 'blyp';
      let soundName = 'blyp_notify.wav';
      try {
        // eslint-disable-next-line global-require
        const PushService = require('./PushService');
        channelId = PushService.DEFAULT_CHANNEL_ID || channelId;
        soundName = PushService.DEFAULT_SOUND || soundName;
      } catch {
        /* optional */
      }
      await Notifications.setNotificationChannelAsync(channelId, {
        name: 'Blyp',
        importance: Notifications.AndroidImportance?.HIGH ?? 4,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#00D2BE',
        sound: soundName,
      });
    }
    return !!granted;
  } catch {
    return false;
  }
}

/**
 * Schedule a local notification for a parsed reminder.
 * Returns { ok, id, whenLabel } or { ok:false, reason }.
 */
export async function scheduleReminder({ task, when }) {
  const Notifications = getNotifications();
  if (!Notifications) return { ok: false, reason: 'unavailable' };
  if (!when) return { ok: false, reason: 'no_time' };

  const granted = await ensurePermissionAndChannel(Notifications);
  if (!granted) return { ok: false, reason: 'permission_denied' };

  const fireDate = when instanceof Date ? when : new Date(when);
  if (!Number.isFinite(fireDate.getTime())) return { ok: false, reason: 'no_time' };

  const channelId = Platform.OS === 'android' ? 'blyp' : undefined;
  const soundName = 'blyp_notify.wav';

  const content = {
    title: 'Reminder',
    body: String(task || 'Your reminder'),
    data: { type: 'reminder' },
    sound: soundName,
    ...(channelId ? { channelId } : {}),
  };

  // Expo SDK 54 requires an explicit SchedulableTriggerInputTypes value.
  // Older `{ date }` / bare interval shapes throw and were silently skipped.
  const DateType = Notifications.SchedulableTriggerInputTypes?.DATE || 'date';
  const IntervalType = Notifications.SchedulableTriggerInputTypes?.TIME_INTERVAL || 'timeInterval';
  const seconds = Math.max(1, Math.round((fireDate.getTime() - Date.now()) / 1000));

  const triggers = [
    {
      type: DateType,
      date: fireDate,
      ...(channelId ? { channelId } : {}),
    },
    {
      type: IntervalType,
      seconds,
      repeats: false,
      ...(channelId ? { channelId } : {}),
    },
  ];

  let lastErr = null;
  for (const trigger of triggers) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const id = await Notifications.scheduleNotificationAsync({ content, trigger });
      if (id) {
        console.log('[reminder] scheduled', { id, when: fireDate.toISOString(), seconds });
        return { ok: true, id, whenLabel: formatWhen(fireDate) };
      }
    } catch (e) {
      lastErr = e;
      console.warn('[reminder] trigger failed', trigger?.type, e?.message || e);
    }
  }
  console.warn('[reminder] schedule_failed', lastErr?.message || lastErr);
  return { ok: false, reason: 'schedule_failed' };
}

// ---------------------------------------------------------------------------
// AI-assisted understanding
//
// The regex parser above is fast and works offline, but it can miss natural
// phrasings ("dentist a week on Thursday", "pick up the kids after school").
// When a Gemini key is configured we ask the model to resolve the request into
// a clean task + an absolute ISO time, then fall back to the regex result.
// ---------------------------------------------------------------------------

const REMINDER_HINT = /\b(remind|reminder|appointment|don'?t\s+forget|set\s+(?:an?\s+)?(?:alarm|reminder)|wake\s+me|alert\s+me)\b/i;

/** True when the text looks like a reminder even without the literal word "remind". */
export function looksLikeReminder(text) {
  return REMINDER_HINT.test(String(text || ''));
}

/**
 * Ask Gemini to parse a reminder request into { isReminder, task, when }.
 * Returns null when AI is unavailable or the response can't be trusted, so the
 * caller can fall back to the regex parser.
 */
export async function parseReminderAI(text) {
  const url = geminiApiUrl;
  const raw = String(text || '').trim();
  if (!url || !raw) return null;

  const nowIso = new Date().toString();
  const prompt =
    `You convert a user's message into a reminder. The current local date and time is: ${nowIso}.\n` +
    `User message: "${raw}"\n\n` +
    `Decide whether the user is asking to be reminded about something (an appointment, task, event, alarm, etc.).\n` +
    `Respond with ONLY strict minified JSON, no markdown, in this exact shape:\n` +
    `{"isReminder": boolean, "task": string, "whenISO": string}\n` +
    `Rules:\n` +
    `- "task": a short, clean description of WHAT to be reminded about. Remove words like "remind me", "to", "of", and any date/time words. Keep it natural (e.g. "Hospital appointment").\n` +
    `- "whenISO": the absolute date-time the reminder should fire, in ISO-8601 with timezone offset, resolved from relative phrases ("next Wednesday", "tomorrow", "in 2 hours", "tonight"). If only a day is implied, use 09:00 local time. If no time can be determined at all, use an empty string.\n` +
    `- If it is not a reminder request, return {"isReminder": false, "task": "", "whenISO": ""}.`;

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
    if (!parsed || parsed.isReminder !== true) return { isReminder: false };
    const when = parsed.whenISO ? new Date(parsed.whenISO) : null;
    if (!when || Number.isNaN(when.getTime())) return null; // let regex try to find a time
    const safeWhen = clampFuture(when);
    let task = String(parsed.task || '').trim();
    if (!task) task = 'your reminder';
    task = task.charAt(0).toUpperCase() + task.slice(1);
    return { isReminder: true, task, when: safeWhen, whenLabel: formatWhen(safeWhen) };
  } catch {
    return null;
  }
}

/**
 * Best-effort reminder understanding. Uses the fast regex parser first, then
 * leans on Gemini to (a) catch reminder phrasings the regex misses and (b)
 * refine the task/time when the regex result is vague. Always resolves to a
 * { isReminder, ... } object.
 */
export async function resolveReminder(text) {
  const rx = parseReminder(text);
  if (rx.isReminder) {
    // The regex already understood it (fast + offline). Try to refine with AI,
    // but never let a slow/failed AI call block a working reminder.
    try {
      const ai = await parseReminderAI(text);
      if (ai && ai.isReminder) return ai;
    } catch {
      /* ignore — fall through to regex result */
    }
    return rx;
  }
  // No literal "remind" trigger — consult AI when it still looks like one.
  if (looksLikeReminder(text)) {
    try {
      const ai = await parseReminderAI(text);
      if (ai && ai.isReminder) return ai;
    } catch {
      /* ignore */
    }
  }
  return { isReminder: false };
}

// ---------------------------------------------------------------------------
// Persistence — so reminders show up as a list (e.g. on the home screen) and
// survive app restarts, separate from the one-shot OS notification.
// ---------------------------------------------------------------------------

const remindersKey = (uid) => `@blyp/reminders/${uid || 'anon'}`;

// How long before the event to fire the notification. The user can change this
// per-reminder ("at the time", "1 hour before", "1 day before", …).
export const LEAD_OPTIONS = [
  { minutes: 0, label: 'At time of event' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
];

/** Short label for a lead time, e.g. 60 -> "1 hr before". */
export function formatLead(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m === 0) return 'At time';
  if (m < 60) return `${m} min before`;
  if (m < 1440) {
    const h = Math.round(m / 60);
    return `${h} hr${h === 1 ? '' : 's'} before`;
  }
  if (m < 10080) {
    const d = Math.round(m / 1440);
    return `${d} day${d === 1 ? '' : 's'} before`;
  }
  const w = Math.round(m / 10080);
  return `${w} week${w === 1 ? '' : 's'} before`;
}

function reminderEventMs(r) {
  return new Date(r?.eventISO || r?.whenISO).getTime();
}

function fireTimeFor(event, leadMinutes) {
  return new Date(new Date(event).getTime() - (Number(leadMinutes) || 0) * 60 * 1000);
}

function sortByEvent(rows) {
  return [...rows].sort((a, b) => reminderEventMs(a) - reminderEventMs(b));
}

/** List upcoming reminders for a user, pruning any whose event has passed. */
export async function listReminders(uid) {
  try {
    const stored = await AsyncStorage.getItem(remindersKey(uid));
    const rows = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(rows)) return [];
    const cutoff = Date.now() - 60 * 1000; // small grace so a just-passed event lingers briefly
    const upcoming = rows.filter((r) => {
      const t = reminderEventMs(r);
      return Number.isFinite(t) && t > cutoff;
    });
    if (upcoming.length !== rows.length) {
      await AsyncStorage.setItem(remindersKey(uid), JSON.stringify(upcoming));
    }
    return sortByEvent(upcoming);
  } catch {
    return [];
  }
}

/**
 * Re-schedule any persisted reminders that never got a local notification
 * (e.g. permission was denied, or an older trigger format failed).
 */
export async function repairUnscheduledReminders(uid) {
  const rows = await listReminders(uid);
  if (!rows.length) return rows;
  let changed = false;
  const next = [];
  for (const rem of rows) {
    if (rem?.scheduled && rem?.notificationId) {
      next.push(rem);
      continue;
    }
    const fire = clampFuture(new Date(rem.whenISO || rem.eventISO));
    // eslint-disable-next-line no-await-in-loop
    const sched = await scheduleReminder({ task: rem.task, when: fire });
    if (sched?.ok) {
      changed = true;
      next.push({
        ...rem,
        whenISO: fire.toISOString(),
        whenLabel: formatWhen(fire),
        notificationId: sched.id,
        scheduled: true,
      });
    } else {
      next.push({ ...rem, scheduled: false, notificationId: null });
    }
  }
  if (changed) {
    try {
      await AsyncStorage.setItem(remindersKey(uid), JSON.stringify(sortByEvent(next)));
    } catch {
      /* ignore */
    }
  }
  return sortByEvent(next);
}

/** Persist a reminder (event time + lead) and return the stored record. */
export async function saveReminder(uid, { task, event, when, leadMinutes = 0, notificationId = null, scheduled = false }) {
  const eventDate = new Date(event != null ? event : when);
  const lead = Math.max(0, Number(leadMinutes) || 0);
  const fire = fireTimeFor(eventDate, lead);
  const rec = {
    id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    task: task || 'your reminder',
    eventISO: eventDate.toISOString(),
    leadMinutes: lead,
    whenISO: fire.toISOString(),
    eventLabel: formatWhen(eventDate),
    whenLabel: formatWhen(fire),
    notificationId,
    scheduled,
    createdAt: Date.now(),
  };
  try {
    const existing = await listReminders(uid);
    await AsyncStorage.setItem(remindersKey(uid), JSON.stringify(sortByEvent([rec, ...existing])));
  } catch {
    /* ignore persistence failure */
  }
  return rec;
}

/**
 * Schedule + persist a reminder in one step. `event` is when the thing happens;
 * the notification fires `leadMinutes` before it. Returns { rec, sched }.
 */
export async function createReminder(uid, { task, event, leadMinutes = 0 }) {
  const fire = clampFuture(fireTimeFor(event, leadMinutes));
  const sched = await scheduleReminder({ task, when: fire });
  const rec = await saveReminder(uid, {
    task,
    event,
    leadMinutes,
    notificationId: sched?.ok ? sched.id : null,
    scheduled: !!sched?.ok,
  });
  return { rec, sched };
}

/** Change a reminder's lead time: cancel the old notification, reschedule, persist. */
export async function rescheduleReminder(uid, id, leadMinutes) {
  const rows = await listReminders(uid);
  const cur = rows.find((r) => r.id === id);
  if (!cur) return null;
  if (cur.notificationId) {
    try {
      const Notifications = getNotifications();
      await Notifications?.cancelScheduledNotificationAsync?.(cur.notificationId);
    } catch {
      /* ignore */
    }
  }
  const lead = Math.max(0, Number(leadMinutes) || 0);
  const fire = clampFuture(fireTimeFor(cur.eventISO, lead));
  const sched = await scheduleReminder({ task: cur.task, when: fire });
  const updated = {
    ...cur,
    leadMinutes: lead,
    whenISO: fire.toISOString(),
    whenLabel: formatWhen(fire),
    notificationId: sched?.ok ? sched.id : null,
    scheduled: !!sched?.ok,
  };
  try {
    const next = rows.map((r) => (r.id === id ? updated : r));
    await AsyncStorage.setItem(remindersKey(uid), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return updated;
}

/** Remove a reminder and cancel its scheduled notification if present. */
export async function removeReminder(uid, id, notificationId) {
  try {
    const existing = await listReminders(uid);
    await AsyncStorage.setItem(remindersKey(uid), JSON.stringify(existing.filter((r) => r.id !== id)));
  } catch {
    /* ignore */
  }
  if (notificationId) {
    try {
      const Notifications = getNotifications();
      await Notifications?.cancelScheduledNotificationAsync?.(notificationId);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Multi-event planning — "look up every Arsenal match this year and set a
// reminder for each, one hour before kickoff". Gemini returns a list of events
// (each with its own time) plus a single lead time to apply to all of them.
// ---------------------------------------------------------------------------

const MULTI_HINT = /\b(each|every|all|both|fixtures?|matches|games|episodes?|sessions?)\b/i;

/** True when the request looks like it wants reminders for MULTIPLE events. */
export function isMultiReminderRequest(text) {
  const t = String(text || '');
  return looksLikeReminder(t) && MULTI_HINT.test(t);
}

/**
 * Ask Gemini to expand a request into many events + a shared lead time.
 * Returns { isPlan, leadMinutes, events: [{ task, when: Date }], note } or null.
 */
export async function planReminders(text) {
  const url = geminiApiUrl;
  const raw = String(text || '').trim();
  if (!url || !raw) return null;

  const nowIso = new Date().toString();
  const prompt =
    `You turn a request into a set of calendar reminders. Current local date/time: ${nowIso}.\n` +
    `User request: "${raw}"\n\n` +
    `If the user wants reminders for MULTIPLE events (e.g. every match in a season, all episodes, each session), expand them.\n` +
    `Respond with ONLY strict minified JSON in this exact shape:\n` +
    `{"isPlan": boolean, "leadMinutes": number, "note": string, "events": [{"task": string, "whenISO": string}]}\n` +
    `Rules:\n` +
    `- "events": each real occurrence, with "whenISO" = the event's absolute start date-time in ISO-8601 with timezone offset. Use your knowledge of real schedules/fixtures; give your best, most up-to-date estimate. Skip events you cannot date.\n` +
    `- "task": a short label for each event (e.g. "Arsenal vs Chelsea").\n` +
    `- "leadMinutes": how long BEFORE each event to notify, from phrases like "one hour before"=60, "a day before"=1440, "at kickoff"=0. Default 0.\n` +
    `- "note": one short sentence to show the user (e.g. how many you set, and a caveat that fixtures can change). No markdown.\n` +
    `- Cap at 40 events. Only future events (after now).\n` +
    `- If this is NOT a multi-event reminder request, return {"isPlan": false, "leadMinutes": 0, "note": "", "events": []}.`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: await geminiAuthHeaders(),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(out);
    if (!parsed || parsed.isPlan !== true || !Array.isArray(parsed.events)) {
      return { isPlan: false, leadMinutes: 0, note: '', events: [] };
    }
    const now = Date.now();
    const events = parsed.events
      .map((e) => {
        const when = e?.whenISO ? new Date(e.whenISO) : null;
        if (!when || Number.isNaN(when.getTime()) || when.getTime() <= now) return null;
        let task = String(e?.task || '').trim() || 'Event';
        task = task.charAt(0).toUpperCase() + task.slice(1);
        return { task, when };
      })
      .filter(Boolean)
      .slice(0, 40);
    const leadMinutes = Math.max(0, Math.round(Number(parsed.leadMinutes) || 0));
    return { isPlan: events.length > 0, leadMinutes, note: String(parsed.note || '').trim(), events };
  } catch {
    return null;
  }
}

export default {
  parseReminder,
  parseReminderAI,
  resolveReminder,
  looksLikeReminder,
  isMultiReminderRequest,
  planReminders,
  scheduleReminder,
  formatWhen,
  formatLead,
  LEAD_OPTIONS,
  listReminders,
  saveReminder,
  createReminder,
  rescheduleReminder,
  removeReminder,
};
