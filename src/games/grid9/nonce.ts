import {
  GRID9_NONCE_BYTES,
  GRID9_NONCE_MAX_BASE64URL_LENGTH,
  GRID9_NONCE_MIN_BASE64URL_LENGTH,
} from './constants';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== 'function') {
    throw new Error('Grid 9 requires a CSPRNG (crypto.getRandomValues)');
  }
  cryptoObj.getRandomValues(bytes);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const triple = (first << 16) | (second << 8) | third;
    output += BASE64URL[(triple >> 18) & 63];
    output += BASE64URL[(triple >> 12) & 63];
    if (index + 1 < bytes.length) output += BASE64URL[(triple >> 6) & 63];
    if (index + 2 < bytes.length) output += BASE64URL[triple & 63];
  }
  return output;
}

/** 128-bit base64url nonce. The server rejects UUID-shaped or short values. */
export function createGrid9ClientNonce(): string {
  return toBase64Url(randomBytes(GRID9_NONCE_BYTES));
}

function decodeBase64Url(value: string): Uint8Array | null {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  try {
    if (typeof globalThis.atob !== 'function') return null;
    const binary = globalThis.atob(padded + '='.repeat(padLength));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isGrid9NonceEncoding(value: string): boolean {
  if (
    value.length < GRID9_NONCE_MIN_BASE64URL_LENGTH ||
    value.length > GRID9_NONCE_MAX_BASE64URL_LENGTH ||
    UUID_SHAPE.test(value) ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return false;
  }
  const decoded = decodeBase64Url(value);
  return !!decoded && decoded.length >= GRID9_NONCE_BYTES && toBase64Url(decoded) === value;
}

export function createGrid9Id(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
