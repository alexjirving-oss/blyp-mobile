import { ApiError } from './apiContract';

export type CursorPayload = {
  sortValue: string;
  id: string;
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(value: unknown): CursorPayload | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 1024) {
    throw new ApiError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid.');
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorPayload>;
    if (
      typeof parsed.sortValue !== 'string' ||
      parsed.sortValue.length === 0 ||
      parsed.sortValue.length > 256 ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0 ||
      parsed.id.length > 256
    ) {
      throw new Error('invalid cursor payload');
    }
    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', 'The pagination cursor is invalid.');
  }
}

export function parsePageSize(value: unknown, options: { defaultSize?: number; maxSize?: number } = {}) {
  const defaultSize = options.defaultSize ?? 25;
  const maxSize = options.maxSize ?? 100;
  if (value === undefined || value === null || value === '') return defaultSize;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxSize) {
    throw new ApiError(400, 'INVALID_PAGE_SIZE', `limit must be an integer between 1 and ${maxSize}.`);
  }
  return parsed;
}
