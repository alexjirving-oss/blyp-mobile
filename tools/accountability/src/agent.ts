import type { AgentExecution, AgentRole } from './types.js';

const MINIMUM_NODE = [22, 13, 0] as const;
const MAX_AGENT_RESULT_CHARACTERS = 1_000_000;
const MODEL_LOOKUP_TIMEOUT_MS = 60_000;
const TIMEOUT = Symbol('timeout');

export interface AgentRunInput {
  apiKey: string;
  role: AgentRole;
  defaultModel: string;
  prompt: string;
  cwd: string;
  timeoutMs: number;
  runLabel: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redact(value: string, secret: string): string {
  return secret.length === 0 ? value : value.replaceAll(secret, '[REDACTED]');
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), Math.max(1, timeoutMs));
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function assertSupportedNode(version = process.versions.node): void {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  const [major = 0, minor = 0, patch = 0] = parts;
  const [requiredMajor, requiredMinor, requiredPatch] = MINIMUM_NODE;
  const supported =
    major > requiredMajor ||
    (major === requiredMajor &&
      (minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch)));
  if (!supported) {
    throw new Error(
      `Cursor SDK requires Node >=${MINIMUM_NODE.join('.')}; current runtime is ${version}`,
    );
  }
}

export async function validateModels(apiKey: string, requestedModels: string[]): Promise<void> {
  const { Cursor } = await import('@cursor/sdk');
  const models = await withTimeout(Cursor.models.list({ apiKey }), MODEL_LOOKUP_TIMEOUT_MS);
  if (models === TIMEOUT) {
    throw new Error(`Cursor model lookup exceeded ${MODEL_LOOKUP_TIMEOUT_MS} ms`);
  }
  const available = new Set<string>();
  for (const model of models) {
    available.add(model.id);
    for (const alias of model.aliases ?? []) {
      available.add(alias);
    }
  }
  const unavailable = [...new Set(requestedModels)].filter(
    (model) => model !== 'auto' && !available.has(model),
  );
  if (unavailable.length > 0) {
    throw new Error(`Cursor account does not expose requested model(s): ${unavailable.join(', ')}`);
  }
}

export async function runAgent(input: AgentRunInput): Promise<AgentExecution> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const model = input.role.model ?? input.defaultModel;
  let agentId: string | null = null;
  let runId: string | null = null;
  let agent: Awaited<ReturnType<(typeof import('@cursor/sdk'))['Agent']['create']>> | undefined;
  const deadline = started + input.timeoutMs;
  const remaining = (): number => Math.max(1, deadline - Date.now());
  const timedOut = (stage: string): AgentExecution => ({
    roleId: input.role.id,
    agentId,
    runId,
    status: 'timeout',
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    model,
    usage: null,
    result: '',
    error: `agent exceeded ${input.timeoutMs} ms during ${stage}`,
  });

  try {
    const { Agent } = await import('@cursor/sdk');
    const createPromise = Agent.create({
      apiKey: input.apiKey,
      name: input.runLabel,
      model: { id: model },
      mode: 'agent',
      local: {
        cwd: input.cwd,
        settingSources: [],
        autoReview: true,
        sandboxOptions: { enabled: true },
      },
    });
    const created = await withTimeout(createPromise, remaining());
    if (created === TIMEOUT) {
      void createPromise
        .then((lateAgent) => lateAgent[Symbol.asyncDispose]())
        .catch(() => undefined);
      return timedOut('startup');
    }
    agent = created;
    agentId = agent.agentId;
    const sent = await withTimeout(agent.send(input.prompt), remaining());
    if (sent === TIMEOUT) {
      return timedOut('prompt submission');
    }
    const run = sent;
    runId = run.id;

    const outcome = await withTimeout(run.wait(), remaining());
    if (outcome === TIMEOUT) {
      if (run.supports('cancel')) {
        await withTimeout(
          run.cancel().catch(() => undefined),
          5_000,
        );
      }
      return {
        ...timedOut('execution'),
        usage: run.usage ?? null,
      };
    }

    const resultText = outcome.result ?? '';
    if (resultText.length > MAX_AGENT_RESULT_CHARACTERS) {
      return {
        roleId: input.role.id,
        agentId,
        runId,
        status: 'error',
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        model: outcome.model?.id ?? model,
        usage: outcome.usage ?? null,
        result: resultText.slice(0, MAX_AGENT_RESULT_CHARACTERS),
        error: `agent result exceeded ${MAX_AGENT_RESULT_CHARACTERS} characters`,
      };
    }

    return {
      roleId: input.role.id,
      agentId,
      runId,
      status: outcome.status,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      model: outcome.model?.id ?? model,
      usage: outcome.usage ?? null,
      result: resultText,
      error:
        outcome.error?.message === undefined ? null : redact(outcome.error.message, input.apiKey),
    };
  } catch (error) {
    return {
      roleId: input.role.id,
      agentId,
      runId,
      status: 'startup-error',
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      model,
      usage: null,
      result: '',
      error: redact(errorMessage(error), input.apiKey),
    };
  } finally {
    if (agent !== undefined) {
      await withTimeout(
        agent[Symbol.asyncDispose]().catch(() => undefined),
        5_000,
      );
    }
  }
}
