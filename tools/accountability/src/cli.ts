#!/usr/bin/env node

import path from 'node:path';

import { loadContract } from './contract.js';
import {
  generateSigningKeyPair,
  parsePrivateSigningKey,
  parsePublicSigningKey,
  verifyLedger,
} from './ledger.js';
import { runAccountabilitySwarm } from './orchestrator.js';
import { readAndValidateVerificationReceipt } from './receipt.js';
import { runSessionVerification } from './session-verifier.js';

const CALLER_CWD = path.resolve(process.env.INIT_CWD ?? process.cwd());

function usage(): string {
  return [
    'Blyp accountability controller',
    '',
    'Commands:',
    '  accountability validate <contract.json>',
    '  accountability run <contract.json> [--repo <path>] [--output <path>]',
    '  accountability verify-ledger <ledger.ndjson>',
    '  accountability verify-session [--repo <path>] [--session <path>] [--output <path>]',
    '  accountability validate-receipt <receipt.json> [--repo <path>] [--session <path>]',
    '  accountability keygen',
    '',
    'Required environment for run:',
    '  CURSOR_API_KEY',
    '  ACCOUNTABILITY_SIGNING_PRIVATE_KEY (Ed25519 PKCS8 base64 or PEM)',
    '',
    'Required environment for verify-ledger:',
    '  ACCOUNTABILITY_SIGNING_PUBLIC_KEY (Ed25519 SPKI base64 or PEM)',
  ].join('\n');
}

function requiredArgument(args: string[], index: number, description: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing ${description}`);
  }
  return value;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return requiredArgument(args, index + 1, `value for ${name}`);
}

function integerOption(args: string[], name: string): number | undefined {
  const value = option(args, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function takeSecret(name: string): string {
  const value = process.env[name];
  delete process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === undefined || command === '--help' || command === '-h') {
    console.log(usage());
    return;
  }

  if (command === 'keygen') {
    console.log(JSON.stringify(generateSigningKeyPair(), null, 2));
    return;
  }

  if (command === 'validate') {
    const contractPath = path.resolve(CALLER_CWD, requiredArgument(args, 1, 'task contract path'));
    const contract = await loadContract(contractPath);
    console.log(
      JSON.stringify(
        {
          valid: true,
          taskId: contract.contract.id,
          sha256: contract.sha256,
          sourcePath: contract.sourcePath,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'verify-ledger') {
    const ledgerPath = path.resolve(CALLER_CWD, requiredArgument(args, 1, 'ledger path'));
    const publicKey = parsePublicSigningKey(takeSecret('ACCOUNTABILITY_SIGNING_PUBLIC_KEY'));
    const verification = await verifyLedger(ledgerPath, publicKey);
    console.log(JSON.stringify(verification, null, 2));
    process.exitCode = verification.valid ? 0 : 1;
    return;
  }

  if (command === 'verify-session') {
    const repositoryPath = path.resolve(CALLER_CWD, option(args, '--repo') ?? '.');
    const sessionPath = path.resolve(
      CALLER_CWD,
      option(args, '--session') ?? '.cursor/agent/session.json',
    );
    const output = option(args, '--output');
    const result = await runSessionVerification({
      repositoryPath,
      sessionPath,
      ...(output === undefined ? {} : { outputRoot: path.resolve(CALLER_CWD, output) }),
    });
    console.log(JSON.stringify(result.receipt));
    process.exitCode =
      result.receipt.outcome.verdict === 'PASS'
        ? 0
        : result.receipt.outcome.verdict === 'REJECTED'
          ? 2
          : 4;
    return;
  }

  if (command === 'validate-receipt') {
    const receiptPath = path.resolve(
      CALLER_CWD,
      requiredArgument(args, 1, 'verification receipt path'),
    );
    const repository = option(args, '--repo');
    const session = option(args, '--session');
    const maxAgeMs = integerOption(args, '--max-age-ms');
    const receipt = await readAndValidateVerificationReceipt(receiptPath, {
      receiptDirectory: path.dirname(receiptPath),
      ...(repository === undefined
        ? {}
        : { repositoryPath: path.resolve(CALLER_CWD, repository) }),
      ...(session === undefined ? {} : { sessionPath: path.resolve(CALLER_CWD, session) }),
      ...(maxAgeMs === undefined ? {} : { maxAgeMs }),
    });
    console.log(
      JSON.stringify({
        valid: true,
        receiptId: receipt.receiptId,
        verdict: receipt.outcome.verdict,
        payloadSha256: receipt.payloadSha256,
      }),
    );
    return;
  }

  if (command === 'run') {
    const contractPath = path.resolve(CALLER_CWD, requiredArgument(args, 1, 'task contract path'));
    const repositoryPath = path.resolve(CALLER_CWD, option(args, '--repo') ?? '.');
    const output = option(args, '--output');
    const apiKey = takeSecret('CURSOR_API_KEY');
    const signingKey = parsePrivateSigningKey(takeSecret('ACCOUNTABILITY_SIGNING_PRIVATE_KEY'));
    const result = await runAccountabilitySwarm({
      repositoryPath,
      contractPath,
      apiKey,
      signingKey,
      ...(output === undefined ? {} : { outputRoot: path.resolve(CALLER_CWD, output) }),
    });
    console.log(
      JSON.stringify(
        {
          ...result.summary,
          runDirectory: result.runDirectory,
          sealHash: result.sealHash,
        },
        null,
        2,
      ),
    );
    process.exitCode =
      result.summary.state === 'ACCEPTED'
        ? 0
        : result.summary.state === 'REJECTED'
          ? 2
          : result.summary.state === 'NEEDS_DECISION'
            ? 3
            : 4;
    return;
  }

  throw new Error(`Unknown command "${command}"\n\n${usage()}`);
}

main().catch((error: unknown) => {
  // Always emit machine-readable JSON on stdout so stop-hook parsers never see empty body.
  const payload = JSON.stringify(
    {
      valid: false,
      status: 'BLOCKED',
      error: error instanceof Error ? error.message : String(error),
    },
    null,
    2,
  );
  console.log(payload);
  console.error(payload);
  process.exitCode = 4;
});
