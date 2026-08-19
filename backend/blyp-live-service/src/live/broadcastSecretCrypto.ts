/**
 * Encrypt session-scoped RTMP credentials at rest (AES-256-GCM).
 * Key: BROADCAST_SECRET_ENCRYPTION_KEY, falling back to MARKETING_TOKEN_ENCRYPTION_KEY.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

export type BroadcastRtmpSecret = {
  rtmpUrl: string;
  streamKey: string;
};

function resolveKey(): Buffer | null {
  const raw = String(
    process.env.BROADCAST_SECRET_ENCRYPTION_KEY || process.env.MARKETING_TOKEN_ENCRYPTION_KEY || '',
  ).trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    /* fall through */
  }
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function broadcastCryptoConfigured(): boolean {
  return Boolean(resolveKey());
}

export function encryptBroadcastSecret(payload: BroadcastRtmpSecret): string {
  const key = resolveKey();
  if (!key) throw new Error('BROADCAST_SECRET_ENCRYPTION_KEY_REQUIRED');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptBroadcastSecret(ciphertext: string): BroadcastRtmpSecret {
  const key = resolveKey();
  if (!key) throw new Error('BROADCAST_SECRET_ENCRYPTION_KEY_REQUIRED');
  const parts = String(ciphertext || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('BROADCAST_SECRET_CIPHER_INVALID');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  const parsed = JSON.parse(plain.toString('utf8')) as BroadcastRtmpSecret;
  if (!parsed?.rtmpUrl || !parsed?.streamKey) {
    throw new Error('BROADCAST_SECRET_PAYLOAD_INVALID');
  }
  return parsed;
}
