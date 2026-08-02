import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson } from './canonical.js';

const OWNER_FILE = 'owner.json';

export interface TaskLeaseRecord {
  version: 1;
  taskId: string;
  runId: string;
  contractSha256: string;
  leaseToken: string;
  holder: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface AcquireTaskLeaseOptions {
  repository: string;
  taskId: string;
  runId: string;
  contractSha256: string;
  ttlMs?: number;
  heartbeatMs?: number;
}

export class LeaseConflictError extends Error {
  constructor(readonly current: TaskLeaseRecord) {
    super(
      `task ${current.taskId} is leased by ${current.holder} until ${current.expiresAt}`,
    );
    this.name = 'LeaseConflictError';
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function validateRecord(value: unknown): TaskLeaseRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('lease owner record is not an object');
  }
  const record = value as Partial<TaskLeaseRecord>;
  const keys = [
    'version',
    'taskId',
    'runId',
    'contractSha256',
    'leaseToken',
    'holder',
    'acquiredAt',
    'heartbeatAt',
    'expiresAt',
  ];
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !(key in record)) ||
    record.version !== 1 ||
    typeof record.taskId !== 'string' ||
    typeof record.runId !== 'string' ||
    typeof record.contractSha256 !== 'string' ||
    typeof record.leaseToken !== 'string' ||
    typeof record.holder !== 'string' ||
    typeof record.acquiredAt !== 'string' ||
    typeof record.heartbeatAt !== 'string' ||
    typeof record.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(record.acquiredAt)) ||
    !Number.isFinite(Date.parse(record.heartbeatAt)) ||
    !Number.isFinite(Date.parse(record.expiresAt))
  ) {
    throw new Error('lease owner record has an invalid shape');
  }
  return record as TaskLeaseRecord;
}

async function readRecord(lockDirectory: string): Promise<TaskLeaseRecord> {
  const ownerPath = path.join(lockDirectory, OWNER_FILE);
  const metadata = await lstat(ownerPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64 * 1024) {
    throw new Error('lease owner record must be a small regular file');
  }
  return validateRecord(JSON.parse(await readFile(ownerPath, 'utf8')));
}

async function writeRecord(lockDirectory: string, record: TaskLeaseRecord): Promise<void> {
  const ownerPath = path.join(lockDirectory, OWNER_FILE);
  const temporary = path.join(lockDirectory, `.owner-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  try {
    try {
      await handle.writeFile(`${canonicalJson(record)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, ownerPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export class TaskLease {
  private timer: NodeJS.Timeout | undefined;
  private failure: Error | null = null;
  private released = false;
  private stopping = false;
  private refreshQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly lockDirectory: string,
    readonly record: TaskLeaseRecord,
    readonly reclaimedRecord: TaskLeaseRecord | null,
    readonly reclaimReason: 'expired' | 'dead-local-holder' | null,
    private readonly ttlMs: number,
    private readonly heartbeatMs: number,
  ) {}

  startHeartbeat(): void {
    if (this.timer !== undefined || this.released || this.stopping) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.stopping || this.released) {
        return;
      }
      void this.enqueueRefresh().catch((error: unknown) => {
        if (this.stopping || this.released) {
          return;
        }
        this.failure = error instanceof Error ? error : new Error(String(error));
      });
    }, this.heartbeatMs);
    this.timer.unref();
  }

  private async refreshInternal(): Promise<void> {
    if (this.released || this.stopping) {
      throw new Error('cannot refresh a released task lease');
    }
    const current = await readRecord(this.lockDirectory);
    if (
      current.leaseToken !== this.record.leaseToken ||
      current.runId !== this.record.runId ||
      current.taskId !== this.record.taskId
    ) {
      throw new Error(`task lease ownership changed for ${this.record.taskId}`);
    }
    if (this.released || this.stopping) {
      throw new Error('cannot refresh a released task lease');
    }
    const heartbeatAt = new Date().toISOString();
    const updated: TaskLeaseRecord = {
      ...current,
      heartbeatAt,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    };
    await writeRecord(this.lockDirectory, updated);
    Object.assign(this.record, updated);
  }

  private enqueueRefresh(): Promise<void> {
    const operation = this.refreshQueue.then(async () => {
      await this.refreshInternal();
    });
    this.refreshQueue = operation.catch(() => undefined);
    return operation;
  }

  async refresh(): Promise<void> {
    return await this.enqueueRefresh();
  }

  assertHealthy(): void {
    if (this.failure !== null) {
      throw new Error(`task lease heartbeat failed: ${this.failure.message}`);
    }
    if (this.released || this.stopping) {
      throw new Error('task lease was released before the run finished');
    }
    if (Date.parse(this.record.expiresAt) <= Date.now()) {
      throw new Error('task lease expired before the run finished');
    }
  }

  async release(): Promise<void> {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.released) {
      return;
    }
    // Stop further heartbeats before draining the queue so a late interval
    // callback cannot recreate files while the lock directory is removed.
    this.stopping = true;
    const operation = this.refreshQueue.then(async () => {
      if (this.released) {
        return;
      }
      if (this.failure !== null) {
        throw new Error(`task lease heartbeat failed: ${this.failure.message}`);
      }
      const current = await readRecord(this.lockDirectory);
      if (current.leaseToken !== this.record.leaseToken) {
        throw new Error(`refusing to release a task lease owned by ${current.holder}`);
      }
      await rm(this.lockDirectory, { recursive: true, force: true });
      this.released = true;
    });
    this.refreshQueue = operation.catch(() => undefined);
    await operation;
  }
}

function localHolderAlive(record: TaskLeaseRecord): boolean | null {
  const [host, pidText] = record.holder.split(':', 3);
  if (
    host === undefined ||
    pidText === undefined ||
    host.toLowerCase() !== os.hostname().toLowerCase()
  ) {
    return null;
  }
  const pid = Number.parseInt(pidText, 10);
  if (!Number.isSafeInteger(pid) || pid < 1) {
    return null;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : true;
  }
}

export async function acquireTaskLease(options: AcquireTaskLeaseOptions): Promise<TaskLease> {
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(options.taskId)) {
    throw new Error('task lease requires a normalized task id');
  }
  if (!/^[a-f0-9]{64}$/.test(options.contractSha256)) {
    throw new Error('task lease requires a SHA-256 contract digest');
  }
  const ttlMs = options.ttlMs ?? 5 * 60_000;
  const heartbeatMs = options.heartbeatMs ?? Math.max(1_000, Math.floor(ttlMs / 3));
  if (
    !Number.isSafeInteger(ttlMs) ||
    ttlMs < 50 ||
    !Number.isSafeInteger(heartbeatMs) ||
    heartbeatMs < 10 ||
    heartbeatMs >= ttlMs
  ) {
    throw new Error('task lease TTL and heartbeat interval are invalid');
  }
  const leaseRoot = path.join(path.resolve(options.repository), '.accountability', 'leases');
  const lockDirectory = path.join(leaseRoot, `${options.taskId}.lock`);
  await mkdir(leaseRoot, { recursive: true });
  let reclaimedRecord: TaskLeaseRecord | null = null;
  let reclaimReason: 'expired' | 'dead-local-holder' | null = null;

  while (true) {
    try {
      await mkdir(lockDirectory);
      break;
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) {
        throw error;
      }
      let current: TaskLeaseRecord;
      try {
        current = await readRecord(lockDirectory);
      } catch (readError) {
        throw new Error(
          `existing task lease is unreadable and will not be broken automatically: ${
            readError instanceof Error ? readError.message : String(readError)
          }`,
        );
      }
      const expired = Date.parse(current.expiresAt) <= Date.now();
      const holderAlive = localHolderAlive(current);
      if (!expired && holderAlive !== false) {
        throw new LeaseConflictError(current);
      }
      reclaimedRecord = current;
      reclaimReason = expired ? 'expired' : 'dead-local-holder';
      const staleDirectory = `${lockDirectory}.stale-${randomUUID()}`;
      try {
        await rename(lockDirectory, staleDirectory);
      } catch (renameError) {
        if (isErrno(renameError, 'ENOENT')) {
          continue;
        }
        throw renameError;
      }
      await rm(staleDirectory, { recursive: true, force: true });
    }
  }

  const now = new Date().toISOString();
  const record: TaskLeaseRecord = {
    version: 1,
    taskId: options.taskId,
    runId: options.runId,
    contractSha256: options.contractSha256,
    leaseToken: randomUUID(),
    holder: `${os.hostname()}:${process.pid}:${options.runId}`,
    acquiredAt: now,
    heartbeatAt: now,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
  try {
    const ownerPath = path.join(lockDirectory, OWNER_FILE);
    const handle = await open(ownerPath, 'wx');
    try {
      await handle.writeFile(`${canonicalJson(record)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(lockDirectory, { recursive: true, force: true });
    throw error;
  }

  const lease = new TaskLease(
    lockDirectory,
    record,
    reclaimedRecord,
    reclaimReason,
    ttlMs,
    heartbeatMs,
  );
  lease.startHeartbeat();
  return lease;
}
