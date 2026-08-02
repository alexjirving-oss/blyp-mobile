import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  timingSafeEqual,
  verify as verifyBytes,
  type KeyObject,
} from 'node:crypto';
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, sha256, sha256File } from './canonical.js';
import type {
  EvidenceReference,
  LedgerEvent,
  LedgerEventInput,
  LedgerVerification,
} from './types.js';

function signingPayload(event: Omit<LedgerEvent, 'hash' | 'signature'>): string {
  return canonicalJson(event);
}

function safeEvidencePath(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe evidence path: ${JSON.stringify(relativePath)}`);
  }
  return normalized;
}

function requireEd25519(key: KeyObject, description: string): KeyObject {
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${description} must be an Ed25519 key`);
  }
  return key;
}

function decodeDer(value: string): Buffer {
  const encoded = value.slice('base64:'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('Signing key contains invalid base64');
  }
  return Buffer.from(encoded, 'base64');
}

export function parsePrivateSigningKey(value: string): KeyObject {
  try {
    const key = value.startsWith('base64:')
      ? createPrivateKey({
          key: decodeDer(value),
          format: 'der',
          type: 'pkcs8',
        })
      : createPrivateKey(value);
    requireEd25519(key, 'ACCOUNTABILITY_SIGNING_PRIVATE_KEY');
    if (key.type !== 'private') {
      throw new Error('ACCOUNTABILITY_SIGNING_PRIVATE_KEY must be private');
    }
    return key;
  } catch (error) {
    throw new Error(
      `Invalid ACCOUNTABILITY_SIGNING_PRIVATE_KEY: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function parsePublicSigningKey(value: string): KeyObject {
  try {
    const key = value.startsWith('base64:')
      ? createPublicKey({
          key: decodeDer(value),
          format: 'der',
          type: 'spki',
        })
      : createPublicKey(value);
    requireEd25519(key, 'ACCOUNTABILITY_SIGNING_PUBLIC_KEY');
    if (key.type !== 'public') {
      throw new Error('ACCOUNTABILITY_SIGNING_PUBLIC_KEY must be public');
    }
    return key;
  } catch (error) {
    throw new Error(
      `Invalid ACCOUNTABILITY_SIGNING_PUBLIC_KEY: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function signingKeyId(publicKey: KeyObject): string {
  const key = requireEd25519(publicKey, 'public signing key');
  if (key.type !== 'public') {
    throw new Error('public signing key must be public');
  }
  const der = key.export({ format: 'der', type: 'spki' });
  return sha256(der);
}

export function generateSigningKeyPair(): {
  privateKey: string;
  publicKey: string;
  keyId: string;
} {
  const generated = generateKeyPairSync('ed25519');
  const privateDer = generated.privateKey.export({
    format: 'der',
    type: 'pkcs8',
  });
  const publicDer = generated.publicKey.export({
    format: 'der',
    type: 'spki',
  });
  return {
    privateKey: `base64:${privateDer.toString('base64')}`,
    publicKey: `base64:${publicDer.toString('base64')}`,
    keyId: signingKeyId(generated.publicKey),
  };
}

export class EvidenceStore {
  readonly runDirectory: string;

  constructor(runDirectory: string) {
    this.runDirectory = path.resolve(runDirectory);
  }

  async initialize(): Promise<void> {
    const parent = path.dirname(this.runDirectory);
    await mkdir(parent, { recursive: true });
    await mkdir(this.runDirectory, { recursive: false });
  }

  async writeJson(relativePath: string, value: unknown): Promise<EvidenceReference> {
    return this.writeText(relativePath, `${canonicalJson(value)}\n`);
  }

  async writeText(relativePath: string, value: string): Promise<EvidenceReference> {
    const safePath = safeEvidencePath(relativePath);
    const destination = path.join(this.runDirectory, ...safePath.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    const handle = await open(destination, 'wx');
    try {
      await handle.writeFile(value, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    const metadata = await stat(destination);
    return {
      relativePath: safePath,
      sha256: await sha256File(destination),
      bytes: metadata.size,
    };
  }

  async reference(relativePath: string): Promise<EvidenceReference> {
    const safePath = safeEvidencePath(relativePath);
    const destination = path.join(this.runDirectory, ...safePath.split('/'));
    const resolved = await realpath(destination);
    const expectedRoot = `${this.runDirectory}${path.sep}`;
    if (resolved !== this.runDirectory && !resolved.startsWith(expectedRoot)) {
      throw new Error('Evidence path escapes the run directory');
    }
    const metadata = await stat(resolved);
    return {
      relativePath: safePath,
      sha256: await sha256File(resolved),
      bytes: metadata.size,
    };
  }
}

export class SignedLedger {
  private readonly ledgerPath: string;
  private readonly keyId: string;
  private sequence = 0;
  private previousHash: string | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly runId: string,
    runDirectory: string,
    private readonly signingKey: KeyObject,
  ) {
    requireEd25519(signingKey, 'ledger signing key');
    if (signingKey.type !== 'private') {
      throw new Error('ledger signing key must be private');
    }
    this.keyId = signingKeyId(createPublicKey(signingKey));
    this.ledgerPath = path.join(runDirectory, 'ledger.ndjson');
  }

  get lastHash(): string | null {
    return this.previousHash;
  }

  async initialize(): Promise<void> {
    const handle = await open(this.ledgerPath, 'wx');
    await handle.close();
  }

  append(input: LedgerEventInput): Promise<LedgerEvent> {
    let resolveEvent: (event: LedgerEvent) => void;
    let rejectEvent: (error: unknown) => void;
    const eventPromise = new Promise<LedgerEvent>((resolve, reject) => {
      resolveEvent = resolve;
      rejectEvent = reject;
    });

    this.queue = this.queue.then(async () => {
      try {
        const event = await this.appendInternal(input);
        resolveEvent(event);
      } catch (error) {
        rejectEvent(error);
        throw error;
      }
    });
    this.queue = this.queue.catch(() => undefined);
    return eventPromise;
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private async appendInternal(input: LedgerEventInput): Promise<LedgerEvent> {
    const unsigned = {
      version: 1 as const,
      runId: this.runId,
      sequence: this.sequence + 1,
      timestamp: new Date().toISOString(),
      actor: input.actor,
      action: input.action,
      subject: input.subject,
      payload: input.payload,
      previousHash: this.previousHash,
      signatureAlgorithm: 'Ed25519' as const,
      signingKeyId: this.keyId,
    };
    const hash = sha256(signingPayload(unsigned));
    const event: LedgerEvent = {
      ...unsigned,
      hash,
      signature: signBytes(null, Buffer.from(hash, 'utf8'), this.signingKey).toString('base64'),
    };
    const handle = await open(this.ledgerPath, 'a');
    try {
      await handle.writeFile(`${canonicalJson(event)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    this.sequence = event.sequence;
    this.previousHash = event.hash;
    return event;
  }
}

function equalHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function isLedgerEvent(value: unknown): value is LedgerEvent {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const event = value as Partial<LedgerEvent>;
  return (
    event.version === 1 &&
    typeof event.runId === 'string' &&
    Number.isInteger(event.sequence) &&
    typeof event.timestamp === 'string' &&
    typeof event.actor === 'string' &&
    typeof event.action === 'string' &&
    typeof event.subject === 'string' &&
    (event.previousHash === null || typeof event.previousHash === 'string') &&
    event.signatureAlgorithm === 'Ed25519' &&
    typeof event.signingKeyId === 'string' &&
    typeof event.hash === 'string' &&
    typeof event.signature === 'string' &&
    'payload' in event
  );
}

export async function verifyLedger(
  ledgerPath: string,
  publicKey: KeyObject,
): Promise<LedgerVerification> {
  requireEd25519(publicKey, 'ledger verification key');
  const expectedKeyId = signingKeyId(publicKey);
  const text = await readFile(path.resolve(ledgerPath), 'utf8');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const errors: string[] = [];
  let previousHash: string | null = null;
  let runId: string | null = null;

  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      errors.push(
        `line ${index + 1}: invalid JSON (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      continue;
    }
    if (!isLedgerEvent(parsed)) {
      errors.push(`line ${index + 1}: invalid event shape`);
      continue;
    }
    const event = parsed;

    if (runId === null) {
      runId = event.runId;
    } else if (event.runId !== runId) {
      errors.push(`line ${index + 1}: runId changed`);
    }
    if (event.sequence !== index + 1) {
      errors.push(`line ${index + 1}: invalid sequence`);
    }
    if (event.previousHash !== previousHash) {
      errors.push(`line ${index + 1}: broken previousHash link`);
    }

    const unsigned = {
      version: event.version,
      runId: event.runId,
      sequence: event.sequence,
      timestamp: event.timestamp,
      actor: event.actor,
      action: event.action,
      subject: event.subject,
      payload: event.payload,
      previousHash: event.previousHash,
      signatureAlgorithm: event.signatureAlgorithm,
      signingKeyId: event.signingKeyId,
    };
    const expectedHash = sha256(signingPayload(unsigned));
    if (!equalHex(event.hash, expectedHash)) {
      errors.push(`line ${index + 1}: event hash mismatch`);
    }
    if (event.signingKeyId !== expectedKeyId) {
      errors.push(`line ${index + 1}: signing key id mismatch`);
    }
    let signatureValid = false;
    try {
      signatureValid = verifyBytes(
        null,
        Buffer.from(event.hash, 'utf8'),
        publicKey,
        Buffer.from(event.signature, 'base64'),
      );
    } catch {
      signatureValid = false;
    }
    if (!signatureValid) {
      errors.push(`line ${index + 1}: signature mismatch`);
    }
    previousHash = event.hash;
  }

  if (lines.length === 0) {
    errors.push('ledger is empty');
  }

  return {
    valid: errors.length === 0,
    eventCount: lines.length,
    lastHash: previousHash,
    errors,
  };
}
