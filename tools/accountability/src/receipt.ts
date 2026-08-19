import { randomUUID } from 'node:crypto';
import { lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, sha256, sha256File } from './canonical.js';
import { currentHead, repositoryRoot } from './git.js';
import type { EvidenceReference, Verdict } from './types.js';
import { normalizeRepoPath } from './policy.js';
import { runProcess, verificationEnvironment } from './process.js';

export const VERIFICATION_RECEIPT_SCHEMA = 'blyp.verification-receipt' as const;
export const VERIFICATION_RECEIPT_VERSION = 1 as const;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ReceiptVerdict = 'PASS' | 'REJECTED' | 'BLOCKED';

export interface TouchedFileEvidence {
  path: string;
  exists: boolean;
  sha256: string | null;
  bytes: number;
}

export interface ReceiptCommand {
  stepId: string;
  runner: string;
  executable: string;
  args: string[];
  processArgs: string[];
  cwd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  timeoutMs: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError: string | null;
  verdict: Verdict;
  stdout: EvidenceReference;
  stderr: EvidenceReference;
}

export interface VerificationReceipt {
  schema: typeof VERIFICATION_RECEIPT_SCHEMA;
  version: typeof VERIFICATION_RECEIPT_VERSION;
  receiptId: string;
  verifier: {
    name: string;
    version: string;
    implementation: string;
    implementationSha256: string;
  };
  binding: {
    repoRoot: string;
    headSha: string;
    baseSha: string;
    branch: string | null;
    worktreeStatusSha256: string;
    sessionId: string;
    taskId: string;
    contractSha256: string | null;
  };
  timing: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
  touchedFiles: {
    source: 'session.json' | 'session+worktree';
    files: TouchedFileEvidence[];
    pathsSha256: string;
    contentSha256: string;
  };
  commands: ReceiptCommand[];
  artifacts: EvidenceReference[];
  outcome: {
    verdict: ReceiptVerdict;
    reasonCode: string;
    parseStatus: 'OK';
  };
  authority: {
    kind: 'local-session' | 'signed-controller';
    signed: boolean;
    ledgerEventHash: string | null;
  };
  payloadSha256: string;
}

export type UnsignedVerificationReceipt = Omit<VerificationReceipt, 'payloadSha256'>;

function fail(location: string, detail: string): never {
  throw new Error(`Invalid verification receipt at ${location}: ${detail}`);
}

function objectAt(value: unknown, location: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(location, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, location: string, keys: string[]): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      fail(location, `unknown property "${key}"`);
    }
  }
  for (const key of keys) {
    if (!(key in value)) {
      fail(location, `missing property "${key}"`);
    }
  }
}

function stringAt(value: unknown, location: string, maximum = 10_000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail(location, `expected a non-empty string no longer than ${maximum} characters`);
  }
  return value;
}

function nullableStringAt(value: unknown, location: string): string | null {
  return value === null ? null : stringAt(value, location);
}

function booleanAt(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') {
    fail(location, 'expected a boolean');
  }
  return value;
}

function integerAt(value: unknown, location: string, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    fail(location, `expected an integer >= ${minimum}`);
  }
  return value as number;
}

function stringArrayAt(value: unknown, location: string): string[] {
  if (!Array.isArray(value) || value.length > 500) {
    fail(location, 'expected an array with at most 500 entries');
  }
  return value.map((item, index) => stringAt(item, `${location}[${index}]`, 2_000));
}

function isoAt(value: unknown, location: string): string {
  const text = stringAt(value, location, 100);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed) || !text.endsWith('Z')) {
    fail(location, 'expected an ISO-8601 UTC timestamp');
  }
  return text;
}

function sha256At(value: unknown, location: string): string {
  const digest = stringAt(value, location, 64);
  if (!SHA256_PATTERN.test(digest)) {
    fail(location, 'expected a lowercase SHA-256 digest');
  }
  return digest;
}

function evidenceAt(value: unknown, location: string): EvidenceReference {
  const object = objectAt(value, location);
  exactKeys(object, location, ['relativePath', 'sha256', 'bytes']);
  const relativePath = normalizeRepoPath(stringAt(object.relativePath, `${location}.relativePath`));
  return {
    relativePath,
    sha256: sha256At(object.sha256, `${location}.sha256`),
    bytes: integerAt(object.bytes, `${location}.bytes`),
  };
}

function commandAt(value: unknown, location: string): ReceiptCommand {
  const object = objectAt(value, location);
  exactKeys(object, location, [
    'stepId',
    'runner',
    'executable',
    'args',
    'processArgs',
    'cwd',
    'startedAt',
    'finishedAt',
    'durationMs',
    'timeoutMs',
    'exitCode',
    'signal',
    'timedOut',
    'spawnError',
    'verdict',
    'stdout',
    'stderr',
  ]);
  const verdict = stringAt(object.verdict, `${location}.verdict`);
  if (verdict !== 'PASS' && verdict !== 'REJECT' && verdict !== 'BLOCKED') {
    fail(`${location}.verdict`, 'expected PASS, REJECT, or BLOCKED');
  }
  const exitCode =
    object.exitCode === null ? null : integerAt(object.exitCode, `${location}.exitCode`);
  const startedAt = isoAt(object.startedAt, `${location}.startedAt`);
  const finishedAt = isoAt(object.finishedAt, `${location}.finishedAt`);
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    fail(location, 'finishedAt precedes startedAt');
  }
  return {
    stepId: stringAt(object.stepId, `${location}.stepId`, 100),
    runner: stringAt(object.runner, `${location}.runner`, 100),
    executable: stringAt(object.executable, `${location}.executable`, 2_000),
    args: stringArrayAt(object.args, `${location}.args`),
    processArgs: stringArrayAt(object.processArgs, `${location}.processArgs`),
    cwd: stringAt(object.cwd, `${location}.cwd`, 4_000),
    startedAt,
    finishedAt,
    durationMs: integerAt(object.durationMs, `${location}.durationMs`),
    timeoutMs: integerAt(object.timeoutMs, `${location}.timeoutMs`, 1),
    exitCode,
    signal: nullableStringAt(object.signal, `${location}.signal`),
    timedOut: booleanAt(object.timedOut, `${location}.timedOut`),
    spawnError: nullableStringAt(object.spawnError, `${location}.spawnError`),
    verdict,
    stdout: evidenceAt(object.stdout, `${location}.stdout`),
    stderr: evidenceAt(object.stderr, `${location}.stderr`),
  };
}

function touchedFileAt(value: unknown, location: string): TouchedFileEvidence {
  const object = objectAt(value, location);
  exactKeys(object, location, ['path', 'exists', 'sha256', 'bytes']);
  const exists = booleanAt(object.exists, `${location}.exists`);
  const digest = object.sha256 === null ? null : sha256At(object.sha256, `${location}.sha256`);
  const bytes = integerAt(object.bytes, `${location}.bytes`);
  if (exists && digest === null) {
    fail(location, 'an existing file requires a content digest');
  }
  if (!exists && (digest !== null || bytes !== 0)) {
    fail(location, 'a missing file must have null sha256 and zero bytes');
  }
  return {
    path: normalizeRepoPath(stringAt(object.path, `${location}.path`)),
    exists,
    sha256: digest,
    bytes,
  };
}

function withoutPayloadHash(receipt: VerificationReceipt): UnsignedVerificationReceipt {
  const { payloadSha256: _payloadSha256, ...unsigned } = receipt;
  return unsigned;
}

export function sealVerificationReceipt(
  receipt: UnsignedVerificationReceipt,
): VerificationReceipt {
  return {
    ...receipt,
    payloadSha256: sha256(canonicalJson(receipt)),
  };
}

export function newReceiptId(): string {
  return randomUUID();
}

export function parseVerificationReceipt(value: unknown): VerificationReceipt {
  const object = objectAt(value, '$');
  exactKeys(object, '$', [
    'schema',
    'version',
    'receiptId',
    'verifier',
    'binding',
    'timing',
    'touchedFiles',
    'commands',
    'artifacts',
    'outcome',
    'authority',
    'payloadSha256',
  ]);
  if (object.schema !== VERIFICATION_RECEIPT_SCHEMA) {
    fail('$.schema', `expected ${VERIFICATION_RECEIPT_SCHEMA}`);
  }
  if (object.version !== VERIFICATION_RECEIPT_VERSION) {
    fail('$.version', `expected ${VERIFICATION_RECEIPT_VERSION}`);
  }
  const receiptId = stringAt(object.receiptId, '$.receiptId', 100);
  if (!UUID_PATTERN.test(receiptId)) {
    fail('$.receiptId', 'expected a UUID');
  }

  const verifier = objectAt(object.verifier, '$.verifier');
  exactKeys(verifier, '$.verifier', [
    'name',
    'version',
    'implementation',
    'implementationSha256',
  ]);

  const binding = objectAt(object.binding, '$.binding');
  exactKeys(binding, '$.binding', [
    'repoRoot',
    'headSha',
    'baseSha',
    'branch',
    'worktreeStatusSha256',
    'sessionId',
    'taskId',
    'contractSha256',
  ]);
  const headSha = stringAt(binding.headSha, '$.binding.headSha', 64);
  const baseSha = stringAt(binding.baseSha, '$.binding.baseSha', 64);
  if (!GIT_SHA_PATTERN.test(headSha) || !GIT_SHA_PATTERN.test(baseSha)) {
    fail('$.binding', 'headSha and baseSha must be lowercase Git commit ids');
  }
  const contractSha256 =
    binding.contractSha256 === null
      ? null
      : sha256At(binding.contractSha256, '$.binding.contractSha256');

  const timing = objectAt(object.timing, '$.timing');
  exactKeys(timing, '$.timing', ['startedAt', 'finishedAt', 'durationMs']);
  const startedAt = isoAt(timing.startedAt, '$.timing.startedAt');
  const finishedAt = isoAt(timing.finishedAt, '$.timing.finishedAt');
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    fail('$.timing', 'finishedAt precedes startedAt');
  }

  const touched = objectAt(object.touchedFiles, '$.touchedFiles');
  exactKeys(touched, '$.touchedFiles', [
    'source',
    'files',
    'pathsSha256',
    'contentSha256',
  ]);
  if (touched.source !== 'session.json' && touched.source !== 'session+worktree') {
    fail('$.touchedFiles.source', 'expected session.json or session+worktree');
  }
  if (!Array.isArray(touched.files) || touched.files.length > 500) {
    fail('$.touchedFiles.files', 'expected at most 500 files');
  }
  const files = touched.files.map((item, index) =>
    touchedFileAt(item, `$.touchedFiles.files[${index}]`),
  );
  const sortedPaths = files.map((file) => file.path);
  if (
    new Set(sortedPaths).size !== sortedPaths.length ||
    [...sortedPaths].sort().some((item, index) => item !== sortedPaths[index])
  ) {
    fail('$.touchedFiles.files', 'paths must be unique and sorted');
  }
  const pathsSha256 = sha256At(touched.pathsSha256, '$.touchedFiles.pathsSha256');
  const contentSha256 = sha256At(touched.contentSha256, '$.touchedFiles.contentSha256');
  if (pathsSha256 !== sha256(canonicalJson(sortedPaths))) {
    fail('$.touchedFiles.pathsSha256', 'digest does not match file paths');
  }
  if (contentSha256 !== sha256(canonicalJson(files))) {
    fail('$.touchedFiles.contentSha256', 'digest does not match file evidence');
  }

  if (!Array.isArray(object.commands) || object.commands.length > 50) {
    fail('$.commands', 'expected at most 50 commands');
  }
  const commands = object.commands.map((item, index) => commandAt(item, `$.commands[${index}]`));
  if (!Array.isArray(object.artifacts) || object.artifacts.length > 200) {
    fail('$.artifacts', 'expected at most 200 artifacts');
  }
  const artifacts = object.artifacts.map((item, index) =>
    evidenceAt(item, `$.artifacts[${index}]`),
  );

  const outcome = objectAt(object.outcome, '$.outcome');
  exactKeys(outcome, '$.outcome', ['verdict', 'reasonCode', 'parseStatus']);
  const outcomeVerdict = stringAt(outcome.verdict, '$.outcome.verdict');
  if (
    outcomeVerdict !== 'PASS' &&
    outcomeVerdict !== 'REJECTED' &&
    outcomeVerdict !== 'BLOCKED'
  ) {
    fail('$.outcome.verdict', 'expected PASS, REJECTED, or BLOCKED');
  }
  if (outcome.parseStatus !== 'OK') {
    fail('$.outcome.parseStatus', 'expected OK');
  }
  if (outcomeVerdict === 'PASS' && commands.some((command) => command.verdict !== 'PASS')) {
    fail('$.outcome.verdict', 'PASS cannot contain a non-passing command');
  }

  const authority = objectAt(object.authority, '$.authority');
  exactKeys(authority, '$.authority', ['kind', 'signed', 'ledgerEventHash']);
  const kind = stringAt(authority.kind, '$.authority.kind');
  if (kind !== 'local-session' && kind !== 'signed-controller') {
    fail('$.authority.kind', 'expected local-session or signed-controller');
  }
  const signed = booleanAt(authority.signed, '$.authority.signed');
  const ledgerEventHash =
    authority.ledgerEventHash === null
      ? null
      : sha256At(authority.ledgerEventHash, '$.authority.ledgerEventHash');
  if (signed !== (ledgerEventHash !== null)) {
    fail('$.authority', 'signed must agree with ledgerEventHash presence');
  }

  const parsed: VerificationReceipt = {
    schema: VERIFICATION_RECEIPT_SCHEMA,
    version: VERIFICATION_RECEIPT_VERSION,
    receiptId,
    verifier: {
      name: stringAt(verifier.name, '$.verifier.name', 200),
      version: stringAt(verifier.version, '$.verifier.version', 100),
      implementation: normalizeRepoPath(
        stringAt(verifier.implementation, '$.verifier.implementation', 500),
      ),
      implementationSha256: sha256At(
        verifier.implementationSha256,
        '$.verifier.implementationSha256',
      ),
    },
    binding: {
      repoRoot: path.resolve(stringAt(binding.repoRoot, '$.binding.repoRoot', 4_000)),
      headSha,
      baseSha,
      branch: nullableStringAt(binding.branch, '$.binding.branch'),
      worktreeStatusSha256: sha256At(
        binding.worktreeStatusSha256,
        '$.binding.worktreeStatusSha256',
      ),
      sessionId: stringAt(binding.sessionId, '$.binding.sessionId', 100),
      taskId: stringAt(binding.taskId, '$.binding.taskId', 200),
      contractSha256,
    },
    timing: {
      startedAt,
      finishedAt,
      durationMs: integerAt(timing.durationMs, '$.timing.durationMs'),
    },
    touchedFiles: {
      source: touched.source,
      files,
      pathsSha256,
      contentSha256,
    },
    commands,
    artifacts,
    outcome: {
      verdict: outcomeVerdict,
      reasonCode: stringAt(outcome.reasonCode, '$.outcome.reasonCode', 200),
      parseStatus: 'OK',
    },
    authority: {
      kind,
      signed,
      ledgerEventHash,
    },
    payloadSha256: sha256At(object.payloadSha256, '$.payloadSha256'),
  };
  const expectedPayloadHash = sha256(canonicalJson(withoutPayloadHash(parsed)));
  if (parsed.payloadSha256 !== expectedPayloadHash) {
    fail('$.payloadSha256', 'payload hash mismatch');
  }
  return parsed;
}

async function rawGit(repository: string, args: string[]): Promise<string> {
  const result = await runProcess('git', args, {
    cwd: repository,
    timeoutMs: 120_000,
    env: verificationEnvironment(),
  });
  if (
    result.exitCode !== 0 ||
    result.spawnError !== null ||
    result.timedOut ||
    result.outputExceeded
  ) {
    throw new Error(
      `git ${args[0] ?? 'command'} failed: ${result.stderr.trim() || result.spawnError || 'unknown error'}`,
    );
  }
  return result.stdout;
}

export async function worktreeStatusSha256(repository: string): Promise<string> {
  const output = await rawGit(repository, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
  ]);
  return sha256(output);
}

export async function currentBranch(repository: string): Promise<string | null> {
  const branch = (await rawGit(repository, ['branch', '--show-current'])).trim();
  return branch.length === 0 ? null : branch;
}

export async function digestTouchedFiles(
  repository: string,
  values: string[],
): Promise<TouchedFileEvidence[]> {
  const normalized = [...new Set(values.map((value) => normalizeRepoPath(value)))].sort();
  const evidence: TouchedFileEvidence[] = [];
  const root = path.resolve(repository);
  for (const relativePath of normalized) {
    const absolute = path.resolve(root, ...relativePath.split('/'));
    const expectedPrefix = `${root}${path.sep}`;
    if (absolute !== root && !absolute.startsWith(expectedPrefix)) {
      throw new Error(`Touched path escapes repository: ${relativePath}`);
    }
    try {
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`Touched path is not a regular file: ${relativePath}`);
      }
      // Read once so bytes + sha256 come from the same snapshot (avoids size/hash TOCTOU).
      const contents = await readFile(absolute);
      evidence.push({
        path: relativePath,
        exists: true,
        sha256: sha256(contents),
        bytes: contents.byteLength,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      evidence.push({ path: relativePath, exists: false, sha256: null, bytes: 0 });
    }
  }
  return evidence;
}

export function diffTouchedFileEvidence(
  expected: TouchedFileEvidence[],
  actual: TouchedFileEvidence[],
): string[] {
  const diffs: string[] = [];
  const actualByPath = new Map(actual.map((file) => [file.path, file]));
  for (const file of expected) {
    const current = actualByPath.get(file.path);
    if (!current) {
      diffs.push(`${file.path}: missing on disk`);
      continue;
    }
    actualByPath.delete(file.path);
    if (
      current.exists !== file.exists ||
      current.sha256 !== file.sha256 ||
      current.bytes !== file.bytes
    ) {
      diffs.push(
        `${file.path}: expected ${file.exists ? `${file.bytes}b/${file.sha256}` : 'absent'} ` +
          `got ${current.exists ? `${current.bytes}b/${current.sha256}` : 'absent'}`,
      );
    }
  }
  for (const pathValue of actualByPath.keys()) {
    diffs.push(`${pathValue}: unexpected path in live digest`);
  }
  return diffs;
}

/**
 * Digest touched files, then re-digest until two consecutive snapshots match.
 * Concurrent editors can change already-dirty files without altering `git status
 * --porcelain`, so sealing must wait for a quiet content window.
 */
export async function digestTouchedFilesUntilStable(
  repository: string,
  values: string[],
  options: { maxAttempts?: number; settleDelayMs?: number } = {},
): Promise<TouchedFileEvidence[]> {
  const maxAttempts = options.maxAttempts ?? 8;
  const settleDelayMs = options.settleDelayMs ?? 150;
  let previous: TouchedFileEvidence[] | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await digestTouchedFiles(repository, values);
    if (previous !== null && canonicalJson(previous) === canonicalJson(current)) {
      return current;
    }
    previous = current;
    if (attempt < maxAttempts && settleDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
    }
  }
  throw new Error(
    'Touched-file evidence did not stabilize before receipt seal ' +
      `(concurrent writes still in flight after ${maxAttempts} attempts)`,
  );
}

export interface ReceiptValidationOptions {
  receiptDirectory?: string;
  repositoryPath?: string;
  sessionPath?: string;
  maxAgeMs?: number;
}

export async function readAndValidateVerificationReceipt(
  receiptPath: string,
  options: ReceiptValidationOptions = {},
): Promise<VerificationReceipt> {
  const absolute = path.resolve(receiptPath);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_RECEIPT_BYTES) {
    throw new Error('Verification receipt must be a small regular file');
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await readFile(absolute, 'utf8'));
  } catch (error) {
    throw new Error(
      `Verification receipt is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const receipt = parseVerificationReceipt(parsedJson);

  const receiptDirectory = path.resolve(options.receiptDirectory ?? path.dirname(absolute));
  for (const artifact of receipt.artifacts) {
    const artifactPath = path.resolve(receiptDirectory, ...artifact.relativePath.split('/'));
    const expectedPrefix = `${receiptDirectory}${path.sep}`;
    if (!artifactPath.startsWith(expectedPrefix)) {
      throw new Error(`Receipt artifact escapes receipt directory: ${artifact.relativePath}`);
    }
    const artifactMetadata = await stat(artifactPath);
    if (
      artifactMetadata.size !== artifact.bytes ||
      (await sha256File(artifactPath)) !== artifact.sha256
    ) {
      throw new Error(`Receipt artifact mismatch: ${artifact.relativePath}`);
    }
  }

  if (options.maxAgeMs !== undefined) {
    const age = Date.now() - Date.parse(receipt.timing.finishedAt);
    if (age < 0 || age > options.maxAgeMs) {
      throw new Error(`Verification receipt is stale (${age} ms old)`);
    }
  }

  if (options.repositoryPath !== undefined) {
    const root = await repositoryRoot(options.repositoryPath);
    if (path.resolve(receipt.binding.repoRoot) !== path.resolve(root)) {
      throw new Error('Verification receipt is bound to another repository root');
    }
    if (receipt.binding.headSha !== (await currentHead(root))) {
      throw new Error('Verification receipt is stale for the current Git HEAD');
    }
    if (receipt.binding.worktreeStatusSha256 !== (await worktreeStatusSha256(root))) {
      throw new Error('Verification receipt is stale for the current tracked worktree state');
    }
    const currentFiles = await digestTouchedFiles(
      root,
      receipt.touchedFiles.files.map((file) => file.path),
    );
    if (canonicalJson(currentFiles) !== canonicalJson(receipt.touchedFiles.files)) {
      const diffs = diffTouchedFileEvidence(receipt.touchedFiles.files, currentFiles);
      const detail = diffs.slice(0, 12).join('; ');
      throw new Error(
        `Verification receipt touched-file evidence is stale` +
          (detail.length > 0 ? ` (${detail})` : ''),
      );
    }
  }

  if (options.sessionPath !== undefined) {
    const session = objectAt(
      JSON.parse(await readFile(path.resolve(options.sessionPath), 'utf8')),
      '$session',
    );
    if (session.sessionId !== receipt.binding.sessionId) {
      throw new Error('Verification receipt belongs to another session');
    }
    if (!Array.isArray(session.files)) {
      throw new Error('Session files are invalid');
    }
    const sessionPaths = [...new Set(session.files.map((item) => normalizeRepoPath(String(item))))].sort();
    const coveredPaths = new Set(receipt.touchedFiles.files.map((file) => file.path));
    if (sessionPaths.some((sessionPath) => !coveredPaths.has(sessionPath))) {
      throw new Error('Verification receipt does not cover every current session file');
    }
  }

  return receipt;
}
