import { spawn } from 'node:child_process';
import path from 'node:path';

import type { EvidenceStore } from './ledger.js';
import type { CommandExecution, FailureDisposition, VerificationStep } from './types.js';

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const ESSENTIAL_ENVIRONMENT = new Set([
  'ALLUSERSPROFILE',
  'APPDATA',
  'COMSPEC',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'WINDIR',
]);

export interface ProcessResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputExceeded: boolean;
  spawnError: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export function verificationEnvironment(additionalNames: string[] = []): NodeJS.ProcessEnv {
  const allowed = new Set([
    ...ESSENTIAL_ENVIRONMENT,
    ...additionalNames.map((name) => name.toUpperCase()),
  ]);
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upperName = name.toUpperCase();
    if (
      value !== undefined &&
      allowed.has(upperName) &&
      upperName !== 'CURSOR_API_KEY' &&
      upperName !== 'ACCOUNTABILITY_SIGNING_PRIVATE_KEY' &&
      upperName !== 'ACCOUNTABILITY_SIGNING_PUBLIC_KEY'
    ) {
      environment[name] = value;
    }
  }
  environment.CI = 'true';
  environment.NO_COLOR = '1';
  environment.FORCE_COLOR = '0';
  return environment;
}

export async function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    shell?: boolean;
    env?: NodeJS.ProcessEnv;
    maxOutputBytes?: number;
  },
): Promise<ProcessResult> {
  const started = Date.now();
  const maximum = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let timedOut = false;
  let outputExceeded = false;
  let spawnError: string | null = null;

  return await new Promise<ProcessResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        shell: options.shell ?? false,
        env: options.env ?? verificationEnvironment(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        exitCode: null,
        signal: null,
        timedOut: false,
        outputExceeded: false,
        spawnError: error instanceof Error ? error.message : String(error),
        stdout: '',
        stderr: '',
        durationMs: Date.now() - started,
      });
      return;
    }

    const append = (target: Buffer[], currentBytes: number, chunk: Buffer): number => {
      if (currentBytes + chunk.byteLength > maximum) {
        outputExceeded = true;
        child.kill('SIGKILL');
        return currentBytes;
      }
      target.push(chunk);
      return currentBytes + chunk.byteLength;
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes = append(stdout, stdoutBytes, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes = append(stderr, stderrBytes, chunk);
    });

    child.on('error', (error) => {
      spawnError = error.message;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    timer.unref();

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        signal,
        timedOut,
        outputExceeded,
        spawnError,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        durationMs: Date.now() - started,
      });
    });
  });
}

function failedVerdict(disposition: FailureDisposition): 'REJECT' | 'BLOCKED' {
  return disposition;
}

function verificationInvocation(step: VerificationStep): {
  executable: string;
  processArgs: string[];
} {
  if (step.runner === 'node') {
    return { executable: process.execPath, processArgs: step.args };
  }
  const npmCli = process.env.npm_execpath;
  if (
    npmCli === undefined ||
    !path.isAbsolute(npmCli) ||
    path.basename(npmCli).toLowerCase() !== 'npm-cli.js'
  ) {
    throw new Error('npm verification requires an absolute npm_execpath ending in npm-cli.js');
  }
  return {
    executable: process.execPath,
    processArgs: [npmCli, ...step.args],
  };
}

export async function runVerificationStep(
  step: VerificationStep,
  cwd: string,
  evidence: EvidenceStore,
  evidencePrefix: string,
): Promise<CommandExecution> {
  const startedAt = new Date().toISOString();
  let invocation: { executable: string; processArgs: string[] };
  try {
    invocation = verificationInvocation(step);
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const detail = error instanceof Error ? error.message : String(error);
    const stdout = await evidence.writeText(`${evidencePrefix}/${step.id}.stdout.log`, '');
    const stderr = await evidence.writeText(`${evidencePrefix}/${step.id}.stderr.log`, detail);
    return {
      stepId: step.id,
      runner: step.runner,
      executable: '',
      args: step.args,
      processArgs: [],
      startedAt,
      finishedAt,
      durationMs: 0,
      exitCode: null,
      signal: null,
      timedOut: false,
      spawnError: detail,
      stdout,
      stderr,
      verdict: 'BLOCKED',
    };
  }
  const result = await runProcess(invocation.executable, invocation.processArgs, {
    cwd,
    timeoutMs: step.timeoutMs,
    env: verificationEnvironment(step.envAllowlist),
  });
  const finishedAt = new Date().toISOString();
  const stdout = await evidence.writeText(`${evidencePrefix}/${step.id}.stdout.log`, result.stdout);
  const stderr = await evidence.writeText(`${evidencePrefix}/${step.id}.stderr.log`, result.stderr);
  const verdict =
    result.timedOut || result.outputExceeded || result.spawnError !== null
      ? 'BLOCKED'
      : result.exitCode === 0
        ? 'PASS'
        : failedVerdict(step.onFailure);

  return {
    stepId: step.id,
    runner: step.runner,
    executable: invocation.executable,
    args: step.args,
    processArgs: invocation.processArgs,
    startedAt,
    finishedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut || result.outputExceeded,
    spawnError:
      result.spawnError ??
      (result.outputExceeded ? `command output exceeded ${DEFAULT_MAX_OUTPUT_BYTES} bytes` : null),
    stdout,
    stderr,
    verdict,
  };
}
