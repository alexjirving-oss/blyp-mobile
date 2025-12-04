import { FinalCaption, PhotoKey } from './types';

// A caption is considered empty if:
// - it is null/undefined
// - OR it becomes length 0 after trimming whitespace and line breaks
export function isEmptyCaption(value: string | null | undefined): boolean {
  if (value == null) {
    return true;
  }
  return value.trim().length === 0;
}

// Normalize whitespace without changing semantic content:
// - convert CRLF/CR to LF
// - trim trailing spaces per line
// - trim leading/trailing whitespace overall
export function normalizeWhitespace(value: string): string {
  const withUnixNewlines = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = withUnixNewlines.split('\n').map((line) => line.trimEnd());
  return lines.join('\n').trim();
}

// Trim a string and return null if it is empty by the strict caption definition.
export function trimToNull(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Brand a string as a FinalCaption.
export function createFinalCaption(value: string): FinalCaption {
  return value as FinalCaption;
}

// Create a branded PhotoKey from a raw string id.
export function createPhotoKey(raw: string): PhotoKey {
  return raw as PhotoKey;
}

// Join multiple caption segments with a single newline separator
// and normalize whitespace at the boundaries.
export function joinCaptions(segments: string[]): string {
  if (segments.length === 0) {
    return '';
  }
  const joined = segments.join('\n');
  return normalizeWhitespace(joined);
}