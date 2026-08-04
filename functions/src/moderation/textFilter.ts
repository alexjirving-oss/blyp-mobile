/**
 * Server-side text safety filter (authoritative).
 *
 * This is the backstop that runs in Cloud Functions on every comment / DM, so a
 * malicious or modified client cannot bypass moderation. It mirrors (and extends)
 * the client filter in src/utils/contentFilter.js, but the server result is the
 * one that decides whether content is removed/masked.
 *
 * Design goals:
 *  - Catch hard-blocked content (slurs, sexualisation of minors, explicit threats)
 *    and signal removal.
 *  - Mask softer profanity in place rather than nuking the whole message.
 *  - Resist trivial obfuscation (leetspeak, spacing, repeated chars, punctuation
 *    between letters) via a normalized comparison pass.
 *  - NEVER throw — moderation must not break the write pipeline.
 */

export type Severity = 'clean' | 'masked' | 'blocked';

export interface InspectionResult {
  /** true when the text contains hard-blocked content and must be removed. */
  blocked: boolean;
  /** The text with soft profanity masked (empty string when blocked). */
  clean: string;
  /** Whether soft profanity was masked (clean differs from input, not blocked). */
  masked: boolean;
  /** Overall severity. */
  severity: Severity;
  /** Categories that matched (e.g. ['hate'], ['minor_safety']). */
  categories: string[];
}

// Hard-blocked content. Each entry maps a category to leet-tolerant patterns.
// Patterns run against BOTH the raw text and a normalized form (see normalize()),
// so "n i g g e r", "n1gg3r", "n.i.g.g.e.r" all collapse to the same match.
const BLOCKED: Array<{ category: string; re: RegExp }> = [
  // Racial / ethnic / homophobic slurs (intentionally leet-tolerant).
  { category: 'hate', re: /\bn[i1l|]gg(?:er|a|uh)s?\b/i },
  { category: 'hate', re: /\bf[a@4]gg?[o0]ts?\b/i },
  { category: 'hate', re: /\bk[i1l|]kes?\b/i },
  { category: 'hate', re: /\bsp[i1l|]cs?\b/i },
  { category: 'hate', re: /\bch[i1l|]nks?\b/i },
  { category: 'hate', re: /\bg[o0]oks?\b/i },
  { category: 'hate', re: /\bw[e3]tb[a@4]cks?\b/i },
  { category: 'hate', re: /\btr[a@4]nn(?:y|ie)s?\b/i },
  { category: 'hate', re: /\bret[a@4]rds?\b/i },
  // Sexualisation / solicitation of minors — zero tolerance.
  { category: 'minor_safety', re: /\b(child|teen|minor|underage|preteen|kid)s?\s*(porn|p[o0]rn|nudes?|sex|naked|nsfw)\b/i },
  { category: 'minor_safety', re: /\b(cp|c\.p\.)\b.*\b(link|trade|sell|buy)\b/i },
  { category: 'minor_safety', re: /\bloli(?:con)?\b/i },
  // Explicit threats of violence / harm to a person.
  { category: 'threat', re: /\bi(?:'?m| am| will| ll| wanna| want to)?\s*(?:gonna|going to)?\s*(kill|murder|rape|behead|shoot|stab)\s+(you|u|him|her|them|yall|y'all)\b/i },
];

// Softer profanity we mask but allow through.
const PROFANITY: RegExp[] = [
  /\bf[u\*v]ck(?:ing|er|ed|s)?\b/i,
  /\bsh[i1\*]t(?:ty|s)?\b/i,
  /\bb[i1\*]tch(?:es|ing|y)?\b/i,
  /\bd[i1\*]ck(?:head|s)?\b/i,
  /\ba[s\$\*]{2}h[o0]les?\b/i,
  /\bc[u\*]nts?\b/i,
  /\bp[i1]ss(?:ing|ed)?\b/i,
  /\bb[a@4]st[a@4]rds?\b/i,
  /\bwh[o0]res?\b/i,
  /\bsl[u\*]ts?\b/i,
];

/**
 * Normalize text to defeat common obfuscation:
 *  - lowercases
 *  - maps leet digits/symbols to letters
 *  - strips characters between letters (spaces, dots, dashes) so "f u c k"->"fuck"
 *  - collapses 3+ repeated chars to 2 ("fuuuuck"->"fuuck" then pattern matches)
 * This is a *secondary* pass; raw text is still checked first to avoid false
 * positives on legitimate words that only collapse after aggressive stripping.
 */
function normalize(input: string): string {
  let s = String(input || '').toLowerCase();
  const leet: Record<string, string> = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '|': 'i', '!': 'i',
  };
  s = s.replace(/[013457 8@$|!]/g, (c) => leet[c] ?? c);
  // Remove separators commonly inserted between letters.
  s = s.replace(/[\s._\-*]+/g, '');
  // Collapse long runs of the same character.
  s = s.replace(/(.)\1{2,}/g, '$1$1');
  return s;
}

function mask(word: string): string {
  if (word.length <= 2) return '*'.repeat(word.length);
  return word[0] + '*'.repeat(Math.max(1, word.length - 2)) + word[word.length - 1];
}

/**
 * Inspect text and decide blocked/masked/clean. Never throws.
 */
export function inspectText(input: string): InspectionResult {
  const text = String(input || '');
  const trimmed = text.trim();
  if (!trimmed) {
    return { blocked: false, clean: text, masked: false, severity: 'clean', categories: [] };
  }

  let normalized = '';
  try {
    normalized = normalize(text);
  } catch {
    normalized = '';
  }

  const categories = new Set<string>();
  for (const { category, re } of BLOCKED) {
    try {
      if (re.test(text) || (normalized && re.test(normalized))) {
        categories.add(category);
      }
    } catch {
      /* ignore individual pattern errors */
    }
  }
  if (categories.size > 0) {
    return { blocked: true, clean: '', masked: false, severity: 'blocked', categories: Array.from(categories) };
  }

  let clean = text;
  let didMask = false;
  for (const re of PROFANITY) {
    try {
      const g = new RegExp(re.source, 'gi');
      clean = clean.replace(g, (m) => {
        didMask = true;
        return mask(m);
      });
    } catch {
      /* ignore */
    }
  }

  return {
    blocked: false,
    clean,
    masked: didMask,
    severity: didMask ? 'masked' : 'clean',
    categories: [],
  };
}

export function isBlockedText(input: string): boolean {
  return inspectText(input).blocked;
}

export function sanitizeText(input: string): string {
  return inspectText(input).clean;
}

export default { inspectText, isBlockedText, sanitizeText };
