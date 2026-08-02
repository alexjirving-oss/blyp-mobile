import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Canonical JSON does not permit non-finite numbers');
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error('Canonical JSON does not permit circular arrays');
    }
    seen.add(value);
    const normalized = value.map((item) => normalize(item, seen));
    seen.delete(value);
    return normalized;
  }

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) {
      throw new Error('Canonical JSON does not permit circular objects');
    }
    seen.add(object);
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      const item = object[key];
      if (item === undefined) {
        continue;
      }
      normalized[key] = normalize(item, seen);
    }
    seen.delete(object);
    return normalized;
  }

  throw new Error(`Canonical JSON cannot encode ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value, new Set()));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}
