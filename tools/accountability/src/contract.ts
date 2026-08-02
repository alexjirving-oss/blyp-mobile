import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { canonicalJson, sha256 } from './canonical.js';
import type {
  AgentRole,
  LoadedContract,
  SwarmConfig,
  TaskContract,
  VerificationStep,
} from './types.js';

const MAX_CONTRACT_BYTES = 256 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const FORBIDDEN_VERIFICATION_ACTION = /\b(publish|deploy|submit|push|merge)\b/i;

function fail(location: string, message: string): never {
  throw new Error(`Invalid task contract at ${location}: ${message}`);
}

function objectAt(value: unknown, location: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(location, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  location: string,
  required: string[],
  optional: string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(location, `unknown property "${key}"`);
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      fail(location, `missing required property "${key}"`);
    }
  }
}

function stringAt(
  value: unknown,
  location: string,
  options: { min?: number; max?: number } = {},
): string {
  if (typeof value !== 'string') {
    fail(location, 'expected a string');
  }
  const trimmed = value.trim();
  if (trimmed.length < (options.min ?? 1)) {
    fail(location, 'value is too short');
  }
  if (trimmed.length > (options.max ?? 20_000)) {
    fail(location, 'value is too long');
  }
  return trimmed;
}

function booleanAt(value: unknown, location: string): boolean {
  if (typeof value !== 'boolean') {
    fail(location, 'expected a boolean');
  }
  return value;
}

function integerAt(value: unknown, location: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    fail(location, `expected an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function stringArrayAt(
  value: unknown,
  location: string,
  options: { minItems?: number; maxItems?: number; maxLength?: number } = {},
): string[] {
  if (!Array.isArray(value)) {
    fail(location, 'expected an array');
  }
  const minimum = options.minItems ?? 0;
  const maximum = options.maxItems ?? 100;
  if (value.length < minimum || value.length > maximum) {
    fail(location, `expected ${minimum} to ${maximum} items`);
  }
  return value.map((item, index) =>
    stringAt(item, `${location}[${index}]`, { max: options.maxLength ?? 2_000 }),
  );
}

function idAt(value: unknown, location: string): string {
  const id = stringAt(value, location, { min: 2, max: 64 });
  if (!ID_PATTERN.test(id)) {
    fail(location, 'use lowercase letters, numbers, and hyphens');
  }
  return id;
}

function pathPatternAt(value: unknown, location: string): string {
  const pattern = stringAt(value, location, { max: 300 }).replaceAll('\\', '/');
  if (
    path.isAbsolute(pattern) ||
    /^[a-zA-Z]:/.test(pattern) ||
    pattern.split('/').includes('..') ||
    pattern.startsWith('/')
  ) {
    fail(location, 'path patterns must be repository-relative');
  }
  return pattern.replace(/^\.\//, '');
}

function verificationAt(value: unknown, location: string): VerificationStep {
  const object = objectAt(value, location);
  exactKeys(object, location, [
    'id',
    'runner',
    'args',
    'timeoutMs',
    'required',
    'onFailure',
    'envAllowlist',
  ]);

  const runner = stringAt(object.runner, `${location}.runner`);
  if (runner !== 'npm' && runner !== 'node') {
    fail(`${location}.runner`, 'expected "npm" or "node"');
  }
  const args = stringArrayAt(object.args, `${location}.args`, {
    maxItems: 50,
    maxLength: 1_000,
  });
  if (FORBIDDEN_VERIFICATION_ACTION.test([runner, ...args].join(' '))) {
    fail(`${location}.args`, 'verification may not publish, deploy, merge, submit, or push');
  }

  const onFailure = stringAt(object.onFailure, `${location}.onFailure`);
  if (onFailure !== 'REJECT' && onFailure !== 'BLOCKED') {
    fail(`${location}.onFailure`, 'expected "REJECT" or "BLOCKED"');
  }
  const envAllowlist = stringArrayAt(object.envAllowlist, `${location}.envAllowlist`, {
    maxItems: 50,
    maxLength: 100,
  });
  for (const [index, name] of envAllowlist.entries()) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      fail(`${location}.envAllowlist[${index}]`, 'expected a portable environment-variable name');
    }
  }
  assertUnique(
    envAllowlist.map((name) => name.toUpperCase()),
    `${location}.envAllowlist`,
  );

  return {
    id: idAt(object.id, `${location}.id`),
    runner,
    args,
    timeoutMs: integerAt(object.timeoutMs, `${location}.timeoutMs`, 1_000, 7_200_000),
    required: booleanAt(object.required, `${location}.required`),
    onFailure,
    envAllowlist,
  };
}

function roleAt(value: unknown, location: string): AgentRole {
  const object = objectAt(value, location);
  exactKeys(object, location, ['id', 'responsibility', 'required'], ['model']);
  const role: AgentRole = {
    id: idAt(object.id, `${location}.id`),
    responsibility: stringAt(object.responsibility, `${location}.responsibility`, { max: 4_000 }),
    required: booleanAt(object.required, `${location}.required`),
  };
  if (object.model !== undefined) {
    role.model = stringAt(object.model, `${location}.model`, { max: 200 });
  }
  return role;
}

function rolesAt(value: unknown, location: string, minimum: number, maximum: number): AgentRole[] {
  if (!Array.isArray(value)) {
    fail(location, 'expected an array');
  }
  if (value.length < minimum || value.length > maximum) {
    fail(location, `expected ${minimum} to ${maximum} roles`);
  }
  return value.map((item, index) => roleAt(item, `${location}[${index}]`));
}

function swarmAt(value: unknown, location: string): SwarmConfig {
  const object = objectAt(value, location);
  exactKeys(object, location, [
    'defaultModel',
    'maxParallelAgents',
    'maxRepairAttempts',
    'agentTimeoutMs',
    'analysts',
    'builders',
    'reviewers',
  ]);
  return {
    defaultModel: stringAt(object.defaultModel, `${location}.defaultModel`, {
      max: 200,
    }),
    maxParallelAgents: integerAt(object.maxParallelAgents, `${location}.maxParallelAgents`, 2, 8),
    maxRepairAttempts: integerAt(object.maxRepairAttempts, `${location}.maxRepairAttempts`, 0, 3),
    agentTimeoutMs: integerAt(
      object.agentTimeoutMs,
      `${location}.agentTimeoutMs`,
      60_000,
      7_200_000,
    ),
    analysts: rolesAt(object.analysts, `${location}.analysts`, 1, 4),
    builders: rolesAt(object.builders, `${location}.builders`, 2, 4),
    reviewers: rolesAt(object.reviewers, `${location}.reviewers`, 2, 6),
  };
}

function assertUnique(values: string[], location: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      fail(location, `duplicate identifier "${value}"`);
    }
    seen.add(value);
  }
}

export function parseContract(value: unknown): TaskContract {
  const object = objectAt(value, '$');
  exactKeys(object, '$', [
    'version',
    'id',
    'title',
    'objective',
    'baseRef',
    'acceptanceCriteria',
    'allowedPaths',
    'forbiddenPaths',
    'verification',
    'swarm',
    'selection',
  ]);

  if (object.version !== 1) {
    fail('$.version', 'only version 1 is supported');
  }

  const acceptanceCriteria = stringArrayAt(object.acceptanceCriteria, '$.acceptanceCriteria', {
    minItems: 1,
    maxItems: 50,
    maxLength: 4_000,
  });
  const allowedPaths = stringArrayAt(object.allowedPaths, '$.allowedPaths', {
    minItems: 1,
    maxItems: 100,
    maxLength: 300,
  }).map((item, index) => pathPatternAt(item, `$.allowedPaths[${index}]`));
  const forbiddenPaths = stringArrayAt(object.forbiddenPaths, '$.forbiddenPaths', {
    maxItems: 100,
    maxLength: 300,
  }).map((item, index) => pathPatternAt(item, `$.forbiddenPaths[${index}]`));

  if (!Array.isArray(object.verification)) {
    fail('$.verification', 'expected an array');
  }
  if (object.verification.length < 1 || object.verification.length > 30) {
    fail('$.verification', 'expected 1 to 30 steps');
  }
  const verification = object.verification.map((item, index) =>
    verificationAt(item, `$.verification[${index}]`),
  );
  assertUnique(
    verification.map((step) => step.id),
    '$.verification',
  );

  const swarm = swarmAt(object.swarm, '$.swarm');
  assertUnique(
    [...swarm.analysts, ...swarm.builders, ...swarm.reviewers].map((role) => role.id),
    '$.swarm',
  );
  if (swarm.analysts.filter((role) => role.required).length < 1) {
    fail('$.swarm.analysts', 'at least one analyst must be required');
  }
  if (swarm.builders.filter((role) => role.required).length < 2) {
    fail('$.swarm.builders', 'at least two builders must be required');
  }
  if (swarm.reviewers.filter((role) => role.required).length < 2) {
    fail('$.swarm.reviewers', 'at least two reviewers must be required');
  }

  const selection = stringAt(object.selection, '$.selection');
  if (selection !== 'human-if-multiple' && selection !== 'smallest-diff') {
    fail('$.selection', 'expected "human-if-multiple" or "smallest-diff"');
  }

  return {
    version: 1,
    id: idAt(object.id, '$.id'),
    title: stringAt(object.title, '$.title', { max: 300 }),
    objective: stringAt(object.objective, '$.objective', { max: 20_000 }),
    baseRef: stringAt(object.baseRef, '$.baseRef', { max: 500 }),
    acceptanceCriteria,
    allowedPaths,
    forbiddenPaths,
    verification,
    swarm,
    selection,
  };
}

export async function loadContract(sourcePath: string): Promise<LoadedContract> {
  const absolute = path.resolve(sourcePath);
  const metadata = await lstat(absolute);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Task contract must be a regular, non-symlinked file');
  }
  if (metadata.size > MAX_CONTRACT_BYTES) {
    throw new Error(`Task contract exceeds ${MAX_CONTRACT_BYTES} bytes`);
  }
  const resolved = await realpath(absolute);
  const text = await readFile(resolved, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Task contract is not valid JSON: ${message}`);
  }
  const contract = parseContract(parsed);
  const canonical = canonicalJson(contract);
  return {
    contract,
    sourcePath: resolved,
    canonicalJson: canonical,
    sha256: sha256(canonical),
  };
}
