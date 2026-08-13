// contentFilter.js
//
// Lightweight client-side text safety filter for live chat / comments. This is a
// first line of defence (slurs + obvious abuse), NOT a replacement for real
// server-side moderation. It masks matched terms and can flag a message so the
// UI can drop or soften it.

const BLOCKED_PATTERNS = [
  // Slurs / hate (kept intentionally small + leet-tolerant). Extend server-side.
  /\bn[i1]gg(?:er|a)s?\b/i,
  /\bf[a@]gg?[o0]ts?\b/i,
  /\bk[i1]kes?\b/i,
  /\bsp[i1]cs?\b/i,
  /\bch[i1]nks?\b/i,
  /\bret[a@]rds?\b/i,
  /\bc[u\*]nts?\b/i,
  // Sexual solicitation of minors / obvious grooming markers
  /\b(child|teen|minor)\s*(porn|nudes?|sex)\b/i,
  // Direct threats / self-harm solicitation (also covered by LiveChatNlp)
  /\bkill\s*(yourself|urself)\b/i,
  /\bkys\b/i,
];

// Softer profanity we mask but allow through.
const PROFANITY = [
  /\bf[u\*]ck(?:ing|er|ed)?\b/i,
  /\bsh[i1]t\b/i,
  /\bb[i1]tch(?:es)?\b/i,
  /\bd[i1]ck(?:head)?\b/i,
  /\ba[s\$]{2}h[o0]le\b/i,
];

function mask(word) {
  if (word.length <= 2) return '*'.repeat(word.length);
  return word[0] + '*'.repeat(Math.max(1, word.length - 2)) + word[word.length - 1];
}

/**
 * Inspect text. Returns { blocked, clean }.
 *  - blocked: true if it contains hard-blocked content and should be dropped.
 *  - clean: the text with soft profanity masked.
 */
export function inspectText(input) {
  const text = String(input || '');
  if (!text.trim()) return { blocked: false, clean: text };

  for (const re of BLOCKED_PATTERNS) {
    if (re.test(text)) return { blocked: true, clean: '' };
  }

  let clean = text;
  for (const re of PROFANITY) {
    clean = clean.replace(new RegExp(re.source, 'gi'), (m) => mask(m));
  }
  return { blocked: false, clean };
}

/** Convenience: true if text must be rejected entirely. */
export function isBlockedText(input) {
  return inspectText(input).blocked;
}

/** Convenience: return masked text (empty string if hard-blocked). */
export function sanitizeText(input) {
  return inspectText(input).clean;
}

export default { inspectText, isBlockedText, sanitizeText };
