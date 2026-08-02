import type { TaskContract } from '../src/types.js';

export function validContract(): TaskContract {
  return {
    version: 1,
    id: 'accountability-test',
    title: 'Accountability test contract',
    objective: 'Make a small, explicitly scoped test change.',
    baseRef: 'HEAD',
    acceptanceCriteria: ['The requested behavior is implemented and tested.'],
    allowedPaths: ['src/**', 'tests/**'],
    forbiddenPaths: ['package.json', '.github/**'],
    verification: [
      {
        id: 'unit-tests',
        runner: 'node',
        args: ['--version'],
        timeoutMs: 60_000,
        required: true,
        onFailure: 'REJECT',
        envAllowlist: [],
      },
    ],
    swarm: {
      defaultModel: 'auto',
      maxParallelAgents: 4,
      maxRepairAttempts: 1,
      agentTimeoutMs: 300_000,
      analysts: [
        {
          id: 'requirements',
          responsibility: 'Extract observable requirements and edge cases.',
          required: true,
        },
      ],
      builders: [
        {
          id: 'builder-a',
          responsibility: 'Produce an independent minimal implementation.',
          required: true,
        },
        {
          id: 'builder-b',
          responsibility: 'Produce an independent defensive implementation.',
          required: true,
        },
      ],
      reviewers: [
        {
          id: 'correctness',
          responsibility: 'Falsify behavior against the task contract.',
          required: true,
        },
        {
          id: 'regression',
          responsibility: 'Find regressions and weakened tests.',
          required: true,
        },
      ],
    },
    selection: 'human-if-multiple',
  };
}
