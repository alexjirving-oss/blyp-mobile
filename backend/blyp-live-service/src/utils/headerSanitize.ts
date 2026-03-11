/**
 * Header sanitization utilities.
 *
 * HARD RULES:
 * - Never log raw values (tokens, secrets, full headers).
 * - Diagnostics returned by `headerValueDiagnostics` are safe to log: lengths/flags/char codes only.
 */

const CONTROL_OR_UNSAFE_RE = /[\u0000-\u001F\u007F\u0080-\u009F]/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const CRLF_TAB_RE = /[\r\n\t]/g;

export type HeaderValueDiagnostics = {
  label: string;
  length: number;
  hasBadChars: boolean;
  badCharCodes: number[];
  startsWithWhitespace: boolean;
  endsWithWhitespace: boolean;
};

export function sanitizeHeaderValue(value: unknown): string {
  if (value == null) return '';

  let s = String(value);

  // Remove BOM/zero-width and control chars.
  s = s.replace(ZERO_WIDTH_RE, '');
  s = s.replace(CONTROL_OR_UNSAFE_RE, '');

  // Extra safety for header folding / tabs.
  s = s.replace(CRLF_TAB_RE, '');

  // Trim accidental surrounding whitespace.
  s = s.trim();

  return s;
}

export function sanitizeBearerAuthorization(value: unknown): string {
  // Don’t change semantics beyond making it a single-line safe header.
  return sanitizeHeaderValue(value);
}

export function sanitizeAwsCredentialValue(value: unknown): string {
  // Credentials should never contain whitespace/control/zero-width chars.
  // For safety, also strip remaining whitespace after control/ZW removal.
  const base = sanitizeHeaderValue(value);
  return base.replace(/\s+/g, '');
}

export function headerValueDiagnostics(label: string, value: unknown): HeaderValueDiagnostics {
  const raw = value == null ? '' : String(value);

  const bad: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    const isCtl = c <= 31 || c === 127 || (c >= 128 && c <= 159);
    const isZw = (c >= 0x200b && c <= 0x200d) || c === 0xfeff;
    if (isCtl || isZw) bad.push(c);
  }

  return {
    label,
    length: raw.length,
    hasBadChars: bad.length > 0,
    badCharCodes: Array.from(new Set(bad)).slice(0, 20),
    startsWithWhitespace: /^\s/.test(raw),
    endsWithWhitespace: /\s$/.test(raw),
  };
}
