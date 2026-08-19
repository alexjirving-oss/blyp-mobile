import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, sha256, sha256File } from './canonical.js';
import { currentHead, repositoryRoot } from './git.js';
import { EvidenceStore } from './ledger.js';
import { isExcludedFromSessionReconciliation, normalizeRepoPath } from './policy.js';
import { runProcess, runVerificationStep, verificationEnvironment } from './process.js';
import {
  currentBranch,
  digestTouchedFilesUntilStable,
  newReceiptId,
  sealVerificationReceipt,
  VERIFICATION_RECEIPT_SCHEMA,
  VERIFICATION_RECEIPT_VERSION,
  worktreeStatusSha256,
  type ReceiptCommand,
  type VerificationReceipt,
} from './receipt.js';
import type { CommandExecution, VerificationStep } from './types.js';

const SESSION_VERSION = 1;
const MAX_SESSION_BYTES = 1024 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const IMPLEMENTATION_VERSION = '0.1.0';

export interface SessionState {
  version: 1;
  sessionId: string;
  startedAt: string;
  repoRoot: string;
  baseSha: string;
  files: string[];
  lastEditAt: string | null;
  editSequence: number;
}

export interface PlannedVerificationStep {
  step: VerificationStep;
  cwd: string;
}

export interface SessionVerificationOptions {
  repositoryPath: string;
  sessionPath: string;
  outputRoot?: string;
}

export interface SessionVerificationResult {
  receipt: VerificationReceipt;
  receiptPath: string;
}

export interface SessionVerifierDependencies {
  runStep: typeof runVerificationStep;
}

const DEFAULT_DEPENDENCIES: SessionVerifierDependencies = {
  runStep: runVerificationStep,
};

function fail(location: string, detail: string): never {
  throw new Error(`Invalid Cursor accountability session at ${location}: ${detail}`);
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

function isoAt(value: unknown, location: string): string {
  if (typeof value !== 'string' || !value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    fail(location, 'expected an ISO-8601 UTC timestamp');
  }
  return value;
}

export function parseSessionState(value: unknown): SessionState {
  const object = objectAt(value, '$');
  exactKeys(object, '$', [
    'version',
    'sessionId',
    'startedAt',
    'repoRoot',
    'baseSha',
    'files',
    'lastEditAt',
    'editSequence',
  ]);
  if (object.version !== SESSION_VERSION) {
    fail('$.version', `expected ${SESSION_VERSION}`);
  }
  if (typeof object.sessionId !== 'string' || !UUID_PATTERN.test(object.sessionId)) {
    fail('$.sessionId', 'expected a UUID');
  }
  const startedAt = isoAt(object.startedAt, '$.startedAt');
  const lastEditAt = object.lastEditAt === null ? null : isoAt(object.lastEditAt, '$.lastEditAt');
  if (lastEditAt !== null && Date.parse(lastEditAt) < Date.parse(startedAt)) {
    fail('$.lastEditAt', 'cannot precede session start');
  }
  if (typeof object.repoRoot !== 'string' || object.repoRoot.length === 0) {
    fail('$.repoRoot', 'expected a repository path');
  }
  if (typeof object.baseSha !== 'string' || !GIT_SHA_PATTERN.test(object.baseSha)) {
    fail('$.baseSha', 'expected a lowercase Git commit id');
  }
  if (!Array.isArray(object.files) || object.files.length > 500) {
    fail('$.files', 'expected at most 500 repository paths');
  }
  const files = object.files.map((item, index) => {
    if (typeof item !== 'string') {
      fail(`$.files[${index}]`, 'expected a string');
    }
    return normalizeRepoPath(item);
  });
  if (
    new Set(files).size !== files.length ||
    [...files].sort().some((item, index) => item !== files[index])
  ) {
    fail('$.files', 'paths must be unique and sorted');
  }
  if (
    typeof object.editSequence !== 'number' ||
    !Number.isInteger(object.editSequence) ||
    object.editSequence < 0
  ) {
    fail('$.editSequence', 'expected a non-negative integer');
  }
  return {
    version: 1,
    sessionId: object.sessionId,
    startedAt,
    repoRoot: path.resolve(object.repoRoot),
    baseSha: object.baseSha,
    files,
    lastEditAt,
    editSequence: object.editSequence,
  };
}

export async function loadSessionState(sessionPath: string): Promise<SessionState> {
  const absolute = path.resolve(sessionPath);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_SESSION_BYTES) {
    throw new Error('Cursor accountability session must be a small regular file');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolute, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cursor accountability session is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return parseSessionState(parsed);
}

async function gitFileList(repository: string, args: string[]): Promise<string[]> {
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
      `git ${args[0] ?? 'command'} failed while reconciling session edits: ${
        result.stderr.trim() || result.spawnError || 'unknown error'
      }`,
    );
  }
  return result.stdout
    .split('\0')
    .filter((item) => item.length > 0)
    .map((item) => normalizeRepoPath(item));
}

export async function discoverSessionFiles(
  repository: string,
  session: SessionState,
): Promise<{ files: string[]; source: 'session.json' | 'session+worktree' }> {
  const recorded = new Set(
    session.files.filter((file) => !isExcludedFromSessionReconciliation(file)),
  );
  const tracked = await gitFileList(repository, [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    'HEAD',
    '--',
  ]);
  const untracked = await gitFileList(repository, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '-z',
  ]);
  const trackedSet = new Set(tracked);
  const threshold = Date.parse(session.startedAt) - 2_000;
  for (const file of [...tracked, ...untracked]) {
    if (recorded.has(file) || isExcludedFromSessionReconciliation(file)) {
      continue;
    }
    const absolute = path.join(repository, ...file.split('/'));
    try {
      const metadata = await lstat(absolute);
      if (metadata.isFile() && !metadata.isSymbolicLink() && metadata.mtimeMs >= threshold) {
        recorded.add(file);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && trackedSet.has(file)) {
        recorded.add(file);
      } else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  const files = [...recorded].sort();
  if (files.length > 500) {
    throw new Error(`session reconciliation found ${files.length} files; maximum is 500`);
  }
  return {
    files,
    source:
      files.length === session.files.length &&
      files.every((file, index) => file === session.files[index])
        ? 'session.json'
        : 'session+worktree',
  };
}

function npmStep(
  id: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
): PlannedVerificationStep {
  return {
    step: {
      id,
      runner: 'npm',
      args,
      timeoutMs,
      required: true,
      onFailure: 'REJECT',
      envAllowlist: [],
    },
    cwd,
  };
}

export function buildSessionVerificationPlan(
  repository: string,
  files: string[],
): PlannedVerificationStep[] {
  const normalized = [...new Set(files.map((file) => normalizeRepoPath(file)))].sort();
  const plan: PlannedVerificationStep[] = [];
  const controlPlane = normalized.some((file) =>
    /^(?:\.cursor\/|tools\/accountability\/|\.github\/workflows\/accountability\.yml$|package(?:-lock)?\.json$|\.gitignore$|\.eslintignore$)/.test(
      file,
    ),
  );
  const hookCode = normalized.some((file) => /^\.cursor\/hooks\/.*\.py$/.test(file));
  const clientCode = normalized.some((file) =>
    /^(?:src\/|__tests__\/|App\.(?:js|jsx|ts|tsx)$|index\.js$|app\.json$|app\.config\.(?:js|ts)$|babel\.config\.js$|jest\.(?:config|setup)\.js$|tsconfig\.json$|package(?:-lock)?\.json$)/.test(
      file,
    ),
  );
  const functionsCode = normalized.some((file) => file.startsWith('functions/'));
  const backendCode = normalized.some((file) => file.startsWith('backend/blyp-live-service/'));

  if (controlPlane) {
    plan.push(
      npmStep(
        'accountability-controller',
        ['test', '--prefix', 'tools/accountability'],
        300_000,
        repository,
      ),
    );
  }
  if (hookCode) {
    plan.push(
      npmStep('accountability-hooks', ['run', 'accountability:test-hooks'], 120_000, repository),
    );
  }
  if (clientCode) {
    const lintable = normalized.filter(
      (file) =>
        /\.(?:js|jsx|ts|tsx)$/.test(file) &&
        !file.startsWith('tools/accountability/') &&
        !file.startsWith('functions/') &&
        !file.startsWith('backend/'),
    );
    if (lintable.length > 0) {
      plan.push(
        npmStep(
          'client-lint',
          ['exec', '--', 'eslint', ...lintable],
          300_000,
          repository,
        ),
      );
    }
    plan.push(npmStep('client-typecheck', ['run', 'typecheck'], 600_000, repository));
    plan.push(
      npmStep(
        'client-tests',
        ['test', '--', '--ci', '--runInBand', '--passWithNoTests'],
        1_200_000,
        repository,
      ),
    );
  }
  if (functionsCode) {
    plan.push(
      npmStep('functions-build', ['run', 'build'], 600_000, path.join(repository, 'functions')),
    );
  }
  if (backendCode) {
    plan.push(
      npmStep(
        'backend-typecheck',
        ['run', 'typecheck'],
        600_000,
        path.join(repository, 'backend', 'blyp-live-service'),
      ),
    );
  }
  return plan;
}

function commandReceipt(
  execution: CommandExecution,
  planned: PlannedVerificationStep,
): ReceiptCommand {
  return {
    stepId: execution.stepId,
    runner: execution.runner,
    executable: execution.executable,
    args: execution.args,
    processArgs: execution.processArgs,
    cwd: path.resolve(planned.cwd),
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    durationMs: execution.durationMs,
    timeoutMs: planned.step.timeoutMs,
    exitCode: execution.exitCode,
    signal: execution.signal,
    timedOut: execution.timedOut,
    spawnError: execution.spawnError,
    verdict: execution.verdict,
    stdout: execution.stdout,
    stderr: execution.stderr,
  };
}

function aggregateVerdict(commands: ReceiptCommand[]): {
  verdict: 'PASS' | 'REJECTED' | 'BLOCKED';
  reasonCode: string;
} {
  if (commands.some((command) => command.verdict === 'BLOCKED')) {
    return { verdict: 'BLOCKED', reasonCode: 'VERIFICATION_BLOCKED' };
  }
  if (commands.some((command) => command.verdict === 'REJECT')) {
    return { verdict: 'REJECTED', reasonCode: 'VERIFICATION_REJECTED' };
  }
  return {
    verdict: 'PASS',
    reasonCode: commands.length === 0 ? 'NO_RECORDED_CODE_CHANGES' : 'VERIFIED',
  };
}

export async function runSessionVerification(
  options: SessionVerificationOptions,
  dependencies: SessionVerifierDependencies = DEFAULT_DEPENDENCIES,
): Promise<SessionVerificationResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const repository = await repositoryRoot(options.repositoryPath);
  const session = await loadSessionState(options.sessionPath);
  if (path.resolve(session.repoRoot) !== repository) {
    throw new Error('Cursor accountability session belongs to another repository');
  }

  const receiptId = newReceiptId();
  const outputRoot = path.resolve(
    options.outputRoot ?? path.join(repository, '.accountability', 'sessions'),
  );
  const receiptDirectory = path.join(outputRoot, session.sessionId, receiptId);
  const evidence = new EvidenceStore(receiptDirectory);
  await evidence.initialize();

  const discovered = await discoverSessionFiles(repository, session);
  const plan = buildSessionVerificationPlan(repository, discovered.files);
  const commands: ReceiptCommand[] = [];
  for (const planned of plan) {
    const execution = await dependencies.runStep(
      planned.step,
      planned.cwd,
      evidence,
      'commands',
    );
    commands.push(commandReceipt(execution, planned));
  }

  // Seal only after touched-file content is quiet. git status --porcelain does not
  // change when an already-dirty file is rewritten, so content digests must settle
  // independently before we bind worktreeStatusSha256.
  const touchedFiles = await digestTouchedFilesUntilStable(repository, discovered.files);
  const headSha = await currentHead(repository);
  const branch = await currentBranch(repository);
  const worktreeDigest = await worktreeStatusSha256(repository);
  const confirmTouched = await digestTouchedFilesUntilStable(repository, discovered.files, {
    maxAttempts: 4,
    settleDelayMs: 50,
  });
  if (canonicalJson(confirmTouched) !== canonicalJson(touchedFiles)) {
    throw new Error(
      'Touched-file evidence drifted while binding the verification receipt; re-run after editors are idle',
    );
  }
  const outcome = aggregateVerdict(commands);
  const finishedAt = new Date().toISOString();
  const runningImplementation = fileURLToPath(import.meta.url);
  const implementationSha256 = await sha256File(runningImplementation);
  const artifacts = commands.flatMap((command) => [command.stdout, command.stderr]);
  const receipt = sealVerificationReceipt({
    schema: VERIFICATION_RECEIPT_SCHEMA,
    version: VERIFICATION_RECEIPT_VERSION,
    receiptId,
    verifier: {
      name: 'cursor-stop-accountability-gate',
      version: IMPLEMENTATION_VERSION,
      implementation: 'tools/accountability/src/session-verifier.ts',
      implementationSha256,
    },
    binding: {
      repoRoot: repository,
      headSha,
      baseSha: session.baseSha,
      branch,
      worktreeStatusSha256: worktreeDigest,
      sessionId: session.sessionId,
      taskId: `cursor-session:${session.sessionId}`,
      contractSha256: null,
    },
    timing: {
      startedAt,
      finishedAt,
      durationMs: Date.now() - started,
    },
    touchedFiles: {
      source: discovered.source,
      files: touchedFiles,
      pathsSha256: sha256(canonicalJson(touchedFiles.map((file) => file.path))),
      contentSha256: sha256(canonicalJson(touchedFiles)),
    },
    commands,
    artifacts,
    outcome: {
      verdict: outcome.verdict,
      reasonCode: outcome.reasonCode,
      parseStatus: 'OK',
    },
    authority: {
      kind: 'local-session',
      signed: false,
      ledgerEventHash: null,
    },
  });
  await evidence.writeJson('receipt.json', receipt);
  return {
    receipt,
    receiptPath: path.join(receiptDirectory, 'receipt.json'),
  };
}
