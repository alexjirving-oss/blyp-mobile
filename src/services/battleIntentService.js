// battleIntentService — turns a natural-language request ("arrange a battle
// between me and Jordan for next Friday 8") into a structured battle intent the
// Blyp bar can act on: open the Create Battle screen, pre-filled with the
// opponent and start time.
//
//   resolveBattle(text) -> { isBattle, opponentName, startAt: epochMs|null, title }
//                       -> { isBattle: false }
//
// A fast offline regex parser handles the common phrasings; when a Gemini key is
// configured we let the model refine the opponent name and resolve fuzzy times
// ("next Friday 8", "a week on Thursday"). Everything degrades gracefully: no
// AI -> regex only; nothing parseable -> { isBattle: false } so the request
// falls through to a normal Blyp search.

import { geminiApiUrl, geminiAuthHeaders } from '../config/firebase';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Strong, unambiguous "arrange a competition" vocabulary.
const STRONG_BATTLE = /\b(battle|challenge|duel|face[- ]?off|head[- ]?to[- ]?head|pk)\b/i;
// "vs / versus" is weak on its own ("Arsenal vs Chelsea" is a content search, not
// a request to arrange a battle), so it only counts when paired with arrange/self.
const VS_HINT = /\b(versus|vs\.?)\b/i;
// Any battle vocabulary at all (used by extractor / time parser).
const BATTLE_HINT = /\b(battle|challenge|versus|vs\.?|head[- ]?to[- ]?head|face[- ]?off|duel|pk)\b/i;
// Verbs that signal the user wants to *arrange* one (vs. just searching for battle clips).
// Deliberately omits weak verbs like "do"/"have" that wrongly fire on questions.
const ARRANGE_HINT = /\b(arrange|set\s*up|setup|start|create|schedule|organi[sz]e|book|line\s*up|put\s+on|kick\s*off)\b/i;
// First-person involvement — the user putting themselves in the battle.
const SELF_HINT = /\b(me|my|i|i'?m|us)\b/i;
// If the request is clearly a content search, don't hijack it.
const SEARCH_TAIL = /\b(videos?|clips?|posts?|songs?|music|highlights?|compilation|montage|results?|score|scores|fixtures?|match|game)\b/i;
// Connector words that bound a person's name.
const TIME_BOUNDARY = '(?:for|on|at|next|tomorrow|tonight|today|this|in|by|sometime|later)';

/**
 * Cheap pre-filter: does this look like a request to ARRANGE a battle (vs. just
 * searching for battle content, or asking a question that mentions "battle")?
 * Kept conservative — the AI verdict in resolveBattle is the real authority.
 */
export function looksLikeBattle(text) {
  const t = String(text || '');
  if (SEARCH_TAIL.test(t)) return false;
  const arrange = ARRANGE_HINT.test(t);
  const connector = /\b(with|against|between)\b/i.test(t);
  const self = SELF_HINT.test(t);
  // Strong battle word: needs an arrange verb, a "with/against/between X" shape,
  // a "challenge X" target, or the user including themselves.
  if (STRONG_BATTLE.test(t)) {
    return arrange || connector || self || /\bchallenge\s+@?\w/i.test(t);
  }
  // Only "vs/versus": ambiguous, so require the user to be arranging/involving self.
  if (VS_HINT.test(t)) {
    return (arrange || self) && /\bvs\.?\s+\w/i.test(t);
  }
  return false;
}

function cleanName(raw) {
  let name = String(raw || '').trim().replace(/^@/, '');
  name = name.replace(/[,.!?]+$/g, '').trim();
  name = name.replace(/^(?:the|a|an|my|that|user|creator|account)\s+/i, '').trim();
  // Reject pronouns / placeholders that aren't a resolvable person.
  if (!name || /^(me|i|myself|you|us|them|someone|somebody|anyone|so[- ]?and[- ]?so)$/i.test(name)) {
    return '';
  }
  return name;
}

/** Pull the opponent's name out of the phrasing. */
function extractOpponent(t) {
  const B = TIME_BOUNDARY;
  const pats = [
    new RegExp(`between\\s+me\\s+and\\s+(.+?)(?:\\s+${B}\\b|[?.!]|$)`, 'i'),
    new RegExp(`between\\s+(.+?)\\s+and\\s+me\\b`, 'i'),
    new RegExp(`\\bchallenge\\s+(.+?)(?:\\s+(?:to|${B})\\b|[?.!]|$)`, 'i'),
    new RegExp(`\\b(?:battle|duel|face[- ]?off|pk|head[- ]?to[- ]?head)\\s+(?:with|against|vs\\.?)\\s+(.+?)(?:\\s+${B}\\b|[?.!]|$)`, 'i'),
    new RegExp(`\\b(?:with|against|vs\\.?)\\s+(.+?)(?:\\s+${B}\\b|[?.!]|$)`, 'i'),
    new RegExp(`\\bme\\s+vs\\.?\\s+(.+?)(?:\\s+${B}\\b|[?.!]|$)`, 'i'),
    /\b([\w@.\- ]+?)\s+vs\.?\s+me\b/i,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m && m[1]) {
      const name = cleanName(m[1]);
      if (name) return name;
    }
  }
  return '';
}

/**
 * Best-effort time extraction. Battles are evening events, so a bare hour with
 * no am/pm is read as PM ("Friday 8" -> 20:00). Returns epoch ms or null.
 */
function parseWhenLoose(text) {
  const lower = String(text || '').toLowerCase();
  const now = new Date();
  const when = new Date(now);
  let dayResolved = false;
  let clock = null;

  // Relative: "in 2 hours", "in 3 days"
  const rel = lower.match(/\bin\s+(\d{1,3})\s*(min(?:ute)?s?|hours?|hrs?|days?|weeks?)\b/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    if (/^min/.test(unit)) when.setMinutes(when.getMinutes() + n);
    else if (/^h/.test(unit)) when.setHours(when.getHours() + n);
    else if (/^day/.test(unit)) when.setDate(when.getDate() + n);
    else if (/^week/.test(unit)) when.setDate(when.getDate() + n * 7);
    return when.getTime();
  }

  // Clock time: "at 8", "8pm", "20:30"
  const cm = lower.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (cm) {
    let h = parseInt(cm[1], 10);
    const m = cm[2] ? parseInt(cm[2], 10) : 0;
    const mer = cm[3] ? cm[3].toLowerCase() : null;
    if (h <= 23 && m <= 59) {
      if (mer === 'pm' && h < 12) h += 12;
      else if (mer === 'am' && h === 12) h = 0;
      else if (!mer && h >= 1 && h <= 11) h += 12; // evening assumption for battles
      clock = { h, m };
    }
  }

  // Day keywords
  if (/\btomorrow\b/.test(lower)) {
    when.setDate(when.getDate() + 1);
    dayResolved = true;
  } else if (/\b(today|tonight)\b/.test(lower)) {
    dayResolved = true;
    if (!clock && /tonight/.test(lower)) clock = { h: 20, m: 0 };
  } else if (/\bnext week\b/.test(lower)) {
    when.setDate(when.getDate() + 7);
    dayResolved = true;
  } else {
    for (let i = 0; i < WEEKDAYS.length; i += 1) {
      const re = new RegExp(`\\b(next\\s+)?(on\\s+)?${WEEKDAYS[i]}\\b`, 'i');
      if (re.test(lower)) {
        let delta = (i - when.getDay() + 7) % 7;
        if (delta === 0) delta = 7; // "friday" -> next friday, not today
        when.setDate(when.getDate() + delta);
        dayResolved = true;
        break;
      }
    }
  }

  if (!dayResolved && !clock) return null;
  if (clock) when.setHours(clock.h, clock.m, 0, 0);
  else when.setHours(20, 0, 0, 0); // default 8pm
  if (when.getTime() <= now.getTime()) {
    if (!dayResolved) when.setDate(when.getDate() + 1);
  }
  return when.getTime();
}

/** Offline parse. Returns { isBattle, opponentName, startAt, title }. */
export function parseBattleRegex(text) {
  const raw = String(text || '').trim();
  if (!looksLikeBattle(raw)) return { isBattle: false };
  const opponentName = extractOpponent(raw);
  const startAt = parseWhenLoose(raw);
  return { isBattle: true, opponentName, startAt: startAt || null, title: '' };
}

/** Ask Gemini to resolve the request. Returns parsed shape or null on failure. */
export async function parseBattleAI(text) {
  const url = geminiApiUrl;
  const raw = String(text || '').trim();
  if (!url || !raw) return null;

  const nowIso = new Date().toString();
  const prompt =
    `You decide whether the user wants to ARRANGE a head-to-head "battle" (a scheduled ` +
    `live competition) against another person on a social app. Current local date/time: ${nowIso}.\n` +
    `User message: "${raw}"\n\n` +
    `Respond with ONLY strict minified JSON in this exact shape:\n` +
    `{"isBattle": boolean, "opponentName": string, "whenISO": string, "title": string}\n` +
    `Rules:\n` +
    `- isBattle true ONLY if they want to set up / arrange / schedule / start a battle, challenge or versus match against someone.\n` +
    `- "opponentName": just the OTHER person's name or @handle (never the speaker, never "me"). Empty string if they didn't name anyone.\n` +
    `- "whenISO": the absolute start date-time in ISO-8601 with timezone offset, resolved from phrases like "next Friday 8" (treat a bare evening hour as PM), "tomorrow 8pm", "in 2 hours". Empty string if no time was given.\n` +
    `- "title": a short battle title if implied (e.g. "Sing-off"), else empty string.\n` +
    `- If it is NOT a battle arrangement request, return {"isBattle": false, "opponentName": "", "whenISO": "", "title": ""}.`;

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
    if (!parsed || parsed.isBattle !== true) return { isBattle: false };
    let startAt = null;
    if (parsed.whenISO) {
      const d = new Date(parsed.whenISO);
      if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) startAt = d.getTime();
    }
    return {
      isBattle: true,
      opponentName: cleanName(parsed.opponentName || ''),
      startAt,
      title: String(parsed.title || '').trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a free-text request into a battle intent. Fast regex first, then lean
 * on AI to refine the opponent name + time. Always resolves to { isBattle, … }.
 */
export async function resolveBattle(text) {
  const rx = parseBattleRegex(text);
  if (rx.isBattle) {
    // The regex is a loose pre-filter. When AI is available, it is the authority:
    // if it says "not a battle", trust it so a plain search ("how do I win a rap
    // battle", "Arsenal vs Chelsea") is NEVER hijacked into the Create Battle flow.
    try {
      const ai = await parseBattleAI(text);
      if (ai) {
        if (ai.isBattle) {
          return {
            isBattle: true,
            opponentName: ai.opponentName || rx.opponentName || '',
            startAt: ai.startAt || rx.startAt || null,
            title: ai.title || rx.title || '',
          };
        }
        // AI explicitly disagreed → it's a search, not a battle.
        return { isBattle: false };
      }
    } catch {
      /* AI unreachable — fall back to the regex verdict below */
    }
    // No AI verdict available: only act on the regex when it actually found an
    // opponent or a time, so an ambiguous match doesn't yank the user away.
    if (rx.opponentName || rx.startAt) return rx;
    return { isBattle: false };
  }
  if (looksLikeBattle(text)) {
    try {
      const ai = await parseBattleAI(text);
      if (ai && ai.isBattle) return ai;
    } catch {
      /* ignore */
    }
  }
  return { isBattle: false };
}

export default {
  looksLikeBattle,
  parseBattleRegex,
  parseBattleAI,
  resolveBattle,
};
