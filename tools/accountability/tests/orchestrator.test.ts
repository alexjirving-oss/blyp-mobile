import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import type { AgentRunInput } from '../src/agent.js';
import { loadContract } from '../src/contract.js';
import { acquireTaskLease } from '../src/lease.js';
import {
  generateSigningKeyPair,
  parsePrivateSigningKey,
  parsePublicSigningKey,
  verifyLedger,
} from '../src/ledger.js';
import { runAccountabilitySwarm, type OrchestratorDependencies } from '../src/orchestrator.js';
import { runProcess, verificationEnvironment } from '../src/process.js';
import type { AgentExecution, TaskContract } from '../src/types.js';
import { validContract } from './fixtures.js';

const SIGNING_KEYS = generateSigningKeyPair();
const PRIVATE_KEY = parsePrivateSigningKey(SIGNING_KEYS.privateKey);
const PUBLIC_KEY = parsePublicSigningKey(SIGNING_KEYS.publicKey);

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runProcess('git', args, {
    cwd,
    timeoutMs: 30_000,
    env: verificationEnvironment(),
  });
  assert.equal(result.exitCode, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
}

async function fixture(t: TestContext): Promise<{
  repository: string;
  contractPath: string;
  outputRoot: string;
  contract: TaskContract;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'blyp-orchestrator-test-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const repository = path.join(root, 'repository');
  await mkdir(path.join(repository, 'src'), { recursive: true });
  await git(repository, ['init']);
  await writeFile(path.join(repository, 'src', 'baseline.ts'), 'export const baseline = true;\n');
  await git(repository, ['add', '-A']);
  await git(repository, [
    '-c',
    'user.name=Accountability Test',
    '-c',
    'user.email=accountability-test@invalid.local',
    'commit',
    '-m',
    'baseline',
  ]);

  const contract = validContract();
  contract.selection = 'smallest-diff';
  contract.swarm.maxRepairAttempts = 0;
  contract.verification = [
    {
      id: 'deterministic-pass',
      runner: 'node',
      args: ['--version'],
      timeoutMs: 30_000,
      required: true,
      onFailure: 'REJECT',
      envAllowlist: [],
    },
  ];
  const contractPath = path.join(repository, 'task.json');
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  return {
    repository,
    contractPath,
    outputRoot: path.join(root, 'evidence'),
    contract,
  };
}

function fakeDependencies(invalidReview = false): OrchestratorDependencies {
  return {
    assertSupportedNode: () => undefined,
    validateModels: async () => undefined,
    runAgent: async (input: AgentRunInput): Promise<AgentExecution> => {
      const startedAt = new Date().toISOString();
      let result = 'Independent analysis completed.';
      if (input.role.id.startsWith('builder-')) {
        await writeFile(
          path.join(input.cwd, 'src', `${input.role.id}.ts`),
          `export const implementation = ${JSON.stringify(input.role.id)};\n`,
        );
        result = 'Implemented the scoped candidate without certifying it.';
      } else if (input.role.id === 'correctness' || input.role.id === 'regression') {
        result = invalidReview
          ? 'Looks fine.'
          : JSON.stringify({
              verdict: 'PASS',
              summary: 'No contract violation found in the frozen candidate.',
              findings: [],
            });
      }
      return {
        roleId: input.role.id,
        agentId: `fake-agent-${input.runLabel}`,
        runId: `fake-run-${input.runLabel}`,
        status: 'finished',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 1,
        model: input.role.model ?? input.defaultModel,
        usage: null,
        result,
        error: null,
      };
    },
  };
}

test('end-to-end controller accepts only after independent gates pass', async (t) => {
  const setup = await fixture(t);
  const result = await runAccountabilitySwarm(
    {
      repositoryPath: setup.repository,
      contractPath: setup.contractPath,
      apiKey: 'not-used-by-fake-runner',
      signingKey: PRIVATE_KEY,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies(),
  );

  assert.equal(result.summary.state, 'ACCEPTED');
  assert.equal(result.summary.passingCandidates.length, 2);
  assert.equal(result.summary.selectedCandidate, 'builder-a-a0');
  const ledger = await verifyLedger(path.join(result.runDirectory, 'ledger.ndjson'), PUBLIC_KEY);
  assert.equal(ledger.valid, true);
  const patch = await readFile(
    path.join(
      result.runDirectory,
      'candidates',
      result.summary.selectedCandidate!,
      'candidate.patch',
    ),
    'utf8',
  );
  assert.match(patch, /builder-a/);
});

test('unparseable reviewer claims block acceptance', async (t) => {
  const setup = await fixture(t);
  const result = await runAccountabilitySwarm(
    {
      repositoryPath: setup.repository,
      contractPath: setup.contractPath,
      apiKey: 'not-used-by-fake-runner',
      signingKey: PRIVATE_KEY,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies(true),
  );

  assert.equal(result.summary.state, 'BLOCKED');
  assert.equal(result.summary.selectedCandidate, null);
  assert.equal(result.summary.blockedCandidates.length, 2);
});

test('an indeterminate required builder blocks the whole run', async (t) => {
  const setup = await fixture(t);
  const dependencies = fakeDependencies();
  const normalRunner = dependencies.runAgent;
  dependencies.runAgent = async (input) => {
    if (input.role.id !== 'builder-b') {
      return await normalRunner(input);
    }
    const timestamp = new Date().toISOString();
    return {
      roleId: input.role.id,
      agentId: 'fake-agent-builder-b',
      runId: 'fake-run-builder-b',
      status: 'timeout',
      startedAt: timestamp,
      finishedAt: timestamp,
      durationMs: input.timeoutMs,
      model: input.defaultModel,
      usage: null,
      result: '',
      error: 'simulated timeout',
    };
  };
  const result = await runAccountabilitySwarm(
    {
      repositoryPath: setup.repository,
      contractPath: setup.contractPath,
      apiKey: 'not-used-by-fake-runner',
      signingKey: PRIVATE_KEY,
      outputRoot: setup.outputRoot,
    },
    dependencies,
  );

  assert.equal(result.summary.state, 'BLOCKED');
  assert.equal(result.summary.passingCandidates.length, 0);
});

test('an unresolved base reference produces a signed BLOCKED receipt', async (t) => {
  const setup = await fixture(t);
  setup.contract.baseRef = 'refs/heads/does-not-exist';
  await writeFile(setup.contractPath, `${JSON.stringify(setup.contract, null, 2)}\n`);
  const result = await runAccountabilitySwarm(
    {
      repositoryPath: setup.repository,
      contractPath: setup.contractPath,
      apiKey: 'not-used-by-fake-runner',
      signingKey: PRIVATE_KEY,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies(),
  );

  assert.equal(result.summary.state, 'BLOCKED');
  assert.equal(result.summary.baseSha, 'UNRESOLVED');
  const ledger = await verifyLedger(path.join(result.runDirectory, 'ledger.ndjson'), PUBLIC_KEY);
  assert.equal(ledger.valid, true);
});

test('a concurrent controller lease conflict produces a signed BLOCKED result', async (t) => {
  const setup = await fixture(t);
  const loaded = await loadContract(setup.contractPath);
  const lease = await acquireTaskLease({
    repository: setup.repository,
    taskId: loaded.contract.id,
    runId: 'competing-controller',
    contractSha256: loaded.sha256,
    ttlMs: 30_000,
    heartbeatMs: 5_000,
  });
  t.after(async () => {
    await lease.release().catch(() => undefined);
  });

  const result = await runAccountabilitySwarm(
    {
      repositoryPath: setup.repository,
      contractPath: setup.contractPath,
      apiKey: 'not-used-by-conflicting-run',
      signingKey: PRIVATE_KEY,
      outputRoot: setup.outputRoot,
    },
    fakeDependencies(),
  );

  assert.equal(result.summary.state, 'BLOCKED');
  assert.equal(result.summary.selectedCandidate, null);
  const ledger = await verifyLedger(path.join(result.runDirectory, 'ledger.ndjson'), PUBLIC_KEY);
  assert.equal(ledger.valid, true);
  const ledgerText = await readFile(path.join(result.runDirectory, 'ledger.ndjson'), 'utf8');
  assert.match(ledgerText, /LEASE_CONFLICT/);
});
