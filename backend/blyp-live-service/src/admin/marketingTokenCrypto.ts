/**
 * Encrypt marketing OAuth tokens at rest (AES-256-GCM).
 * Never log plaintext tokens. Key: MARKETING_TOKEN_ENCRYPTION_KEY (32-byte hex or base64).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

export type MarketingTokenPayload = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  tokenType?: string | null;
  /** Facebook Page access token when posting as Page */
  pageAccessToken?: string | null;
  pageId?: string | null;
  /** Instagram Business / Creator account id */
  igUserId?: string | null;
};

function resolveKey(): Buffer | null {
  const raw = String(process.env.MARKETING_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    /* fall through */
  }
  // Deterministic derive so operators can set a passphrase in emergencies — still 32 bytes.
  return createHash('sha256').update(raw, 'utf8').digest();
}

export function marketingCryptoConfigured(): boolean {
  return Boolean(String(process.env.MARKETING_TOKEN_ENCRYPTION_KEY || '').trim());
}

export function encryptMarketingToken(payload: MarketingTokenPayload): string {
  const key = resolveKey();
  if (!key) {
    throw new Error('MARKETING_TOKEN_ENCRYPTION_KEY_REQUIRED');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptMarketingToken(ciphertext: string): MarketingTokenPayload {
  const key = resolveKey();
  if (!key) {
    throw new Error('MARKETING_TOKEN_ENCRYPTION_KEY_REQUIRED');
  }
  const parts = String(ciphertext || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('MARKETING_TOKEN_CIPHER_INVALID');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const data = Buffer.from(parts[3], 'base64url');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  const parsed = JSON.parse(plain.toString('utf8')) as MarketingTokenPayload;
  if (!parsed?.accessToken) {
    throw new Error('MARKETING_TOKEN_PAYLOAD_INVALID');
  }
  return parsed;
}
