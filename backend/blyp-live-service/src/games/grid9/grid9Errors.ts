import type { Grid9ErrorCode } from './protocol';

export class Grid9Error extends Error {
  readonly code: Grid9ErrorCode;
  readonly retryable: boolean;
  readonly stateVersion: number | null;

  constructor(
    code: Grid9ErrorCode,
    message: string,
    options: { retryable?: boolean; stateVersion?: number | null } = {},
  ) {
    super(message);
    this.name = 'Grid9Error';
    this.code = code;
    this.retryable = options.retryable === true;
    this.stateVersion = options.stateVersion ?? null;
  }
}

export function asGrid9Error(error: unknown): Grid9Error {
  if (error instanceof Grid9Error) return error;
  return new Grid9Error('INTERNAL_ERROR', 'Grid 9 request failed', {
    retryable: true,
  });
}
