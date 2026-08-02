import { randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import path from 'node:path';

import {
  assertSupportedNode,
  localSandboxEnabled,
  runAgent,
  validateModels,
} from './agent.js';
import { mapLimit } from './concurrency.js';
import { loadContract } from './contract.js';
import {
  candidatePatch,
  changedFilesFromBase,
  currentHead,
  diffStat,
  freezeCandidate,
  repositoryRoot,
  resolveCommit,
  WorktreeManager,
} from './git.js';
import { EvidenceStore, SignedLedger } from './ledger.js';
import { acquireTaskLease, LeaseConflictError, type TaskLease } from './lease.js';
import { evaluateChangedPaths, normalizeRepoPath, readOnlyViolations } from './policy.js';
import {
  analystPrompt,
  builderPrompt,
  parseReviewDecision,
  repairPrompt,
  reviewerPrompt,
} from './prompts.js';
import { runVerificationStep } from './process.js';
import { RunStateMachine } from './state-machine.js';
import type {
  AgentExecution,
  AgentRole,
  Candidate,
  CandidateEvaluation,
  EvidenceReference,
  LoadedContract,
  ReviewerExecution,
  RunState,
  RunSummary,
  TaskContract,
  Verdict,
} from './types.js';

interface AnalystOutcome {
  role: AgentRole;
  agent: AgentExecution;
  changedFiles: string[];
  policyViolations: string[];
  verdict: Verdict;
}

interface CandidateOutcome {
  role: AgentRole;
  candidate: Candidate | null;
  verdict: Verdict;
  reasons: string[];
  agent: AgentExecution;
}

interface RepairOutcome extends CandidateOutcome {
  previousCandidateId: string;
}

export interface OrchestratorOptions {
  repositoryPath: string;
  contractPath: string;
  apiKey: string;
  signingKey: KeyObject;
  outputRoot?: string;
}

export interface OrchestrationResult {
  summary: RunSummary;
  runDirectory: string;
  sealHash: string;
}

export interface OrchestratorDependencies {
  assertSupportedNode: typeof assertSupportedNode;
  validateModels: typeof validateModels;
  runAgent: typeof runAgent;
}

const DEFAULT_DEPENDENCIES: OrchestratorDependencies = {
  assertSupportedNode,
  validateModels,
  runAgent,
};

function runIdentifier(taskId: string): string {
  const timestamp = new Date()
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `${timestamp}-${taskId}-${randomUUID().slice(0, 8)}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function contractPathProtection(repository: string, contract: LoadedContract): string[] {
  const relative = path.relative(repository, contract.sourcePath);
  if (relative.length === 0 || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return [];
  }
  return [normalizeRepoPath(relative)];
}

function modelNames(contract: TaskContract): string[] {
  return [
    contract.swarm.defaultModel,
    ...contract.swarm.analysts.map((role) => role.model ?? contract.swarm.defaultModel),
    ...contract.swarm.builders.map((role) => role.model ?? contract.swarm.defaultModel),
    ...contract.swarm.reviewers.map((role) => role.model ?? contract.swarm.defaultModel),
  ];
}

class AccountabilityRun {
  private readonly state: RunStateMachine;
  private readonly worktrees: WorktreeManager;
  private readonly protectedPaths: string[];
  private readonly startedAt = new Date().toISOString();
  private baseSha = '';
  private selectedCandidate: string | null = null;
  private evaluations: CandidateEvaluation[] = [];
  private repairInfrastructureBlocked = false;
  private lease: TaskLease | null = null;

  constructor(
    private readonly options: OrchestratorOptions,
    private readonly repository: string,
    private readonly contract: LoadedContract,
    private readonly runId: string,
    private readonly evidence: EvidenceStore,
    private readonly ledger: SignedLedger,
    private readonly dependencies: OrchestratorDependencies,
  ) {
    this.state = new RunStateMachine(ledger);
    this.worktrees = new WorktreeManager(repository, runId);
    this.protectedPaths = contractPathProtection(repository, contract);
  }

  async execute(): Promise<OrchestrationResult> {
    try {
      await this.recordJson(
        'contract.json',
        this.contract.contract,
        'controller',
        'CONTRACT_CAPTURED',
        this.contract.contract.id,
      );
      try {
        this.lease = await acquireTaskLease({
          repository: this.repository,
          taskId: this.contract.contract.id,
          runId: this.runId,
          contractSha256: this.contract.sha256,
        });
      } catch (error) {
        if (error instanceof LeaseConflictError) {
          await this.ledger.append({
            actor: 'controller',
            action: 'LEASE_CONFLICT',
            subject: this.contract.contract.id,
            payload: {
              holder: error.current.holder,
              conflictingRunId: error.current.runId,
              expiresAt: error.current.expiresAt,
            },
          });
          return await this.finish(
            'BLOCKED',
            `another controller owns this task until ${error.current.expiresAt}`,
          );
        }
        throw error;
      }
      if (this.lease.reclaimedRecord !== null) {
        await this.ledger.append({
          actor: 'controller',
          action: 'LEASE_RECLAIMED',
          subject: this.contract.contract.id,
          payload: {
            reason: this.lease.reclaimReason,
            previousHolder: this.lease.reclaimedRecord.holder,
            previousRunId: this.lease.reclaimedRecord.runId,
            previousExpiresAt: this.lease.reclaimedRecord.expiresAt,
          },
        });
      }
      await this.ledger.append({
        actor: 'controller',
        action: 'LEASE_ACQUIRED',
        subject: this.contract.contract.id,
        payload: {
          holder: this.lease.record.holder,
          expiresAt: this.lease.record.expiresAt,
          contractSha256: this.contract.sha256,
        },
      });
      this.baseSha = await resolveCommit(this.repository, this.contract.contract.baseRef);
      await this.ledger.append({
        actor: 'controller',
        action: 'BASELINE_RESOLVED',
        subject: this.contract.contract.baseRef,
        payload: {
          baseRef: this.contract.contract.baseRef,
          baseSha: this.baseSha,
          repository: this.repository,
          contractSha256: this.contract.sha256,
        },
      });

      this.dependencies.assertSupportedNode();
      await this.dependencies.validateModels(
        this.options.apiKey,
        modelNames(this.contract.contract),
      );
      await this.ledger.append({
        actor: 'controller',
        action: 'PREFLIGHT_PASSED',
        subject: this.runId,
        payload: {
          node: process.versions.node,
          runtimePlatform: process.platform,
          localSandboxEnabled: localSandboxEnabled(),
          localAgentStore: 'jsonl',
          requestedModels: [...new Set(modelNames(this.contract.contract))],
          signedLedger: true,
        },
      });

      await this.state.transition('ANALYZING', 'starting independent read-only analysis');
      const analyses = await this.runAnalysts();
      const requiredAnalysisFailure = analyses.some(
        (outcome) => outcome.role.required && outcome.verdict !== 'PASS',
      );
      if (requiredAnalysisFailure) {
        return await this.finish(
          'BLOCKED',
          'one or more required analysis roles failed or exceeded read-only authority',
        );
      }

      await this.state.transition('BUILDING', 'analysis complete; starting isolated builders');
      const builderOutcomes = await this.runBuilders(analyses);
      const requiredBuilderBlocked = builderOutcomes.some(
        (outcome) => outcome.role.required && outcome.verdict === 'BLOCKED',
      );
      if (requiredBuilderBlocked) {
        return await this.finish('BLOCKED', 'one or more required builder runs were indeterminate');
      }
      const candidates = builderOutcomes.flatMap((outcome) =>
        outcome.candidate === null ? [] : [outcome.candidate],
      );
      if (candidates.length === 0) {
        const blocked = builderOutcomes.some((outcome) => outcome.verdict === 'BLOCKED');
        return await this.finish(
          blocked ? 'BLOCKED' : 'REJECTED',
          'no builder produced an admissible candidate',
        );
      }

      await this.state.transition(
        'VERIFYING',
        'builder candidates frozen; beginning independent evaluation',
        { candidateIds: candidates.map((candidate) => candidate.candidateId) },
      );
      this.evaluations = await this.evaluateCandidates(candidates);

      let repairAttempt = 0;
      while (
        !this.evaluations.some((evaluation) => evaluation.verdict === 'PASS') &&
        repairAttempt < this.contract.contract.swarm.maxRepairAttempts
      ) {
        const rejected = this.evaluations.filter((evaluation) => evaluation.verdict === 'REJECT');
        if (rejected.length === 0) {
          break;
        }
        repairAttempt += 1;
        await this.state.transition(
          'REPAIRING',
          `starting bounded repair attempt ${repairAttempt}`,
          {
            candidateIds: rejected.map((evaluation) => evaluation.candidate.candidateId),
          },
        );
        const repairs = await this.repairCandidates(rejected, repairAttempt);
        const repairedCandidates = repairs.flatMap((outcome) =>
          outcome.candidate === null ? [] : [outcome.candidate],
        );
        this.repairInfrastructureBlocked ||= repairs.some(
          (outcome) => outcome.verdict === 'BLOCKED',
        );
        if (repairedCandidates.length === 0) {
          break;
        }
        await this.state.transition(
          'VERIFYING',
          `repair attempt ${repairAttempt} frozen; rerunning all mandatory gates`,
          {
            candidateIds: repairedCandidates.map((candidate) => candidate.candidateId),
          },
        );
        const blockedFromPrevious = this.evaluations.filter(
          (evaluation) => evaluation.verdict === 'BLOCKED',
        );
        this.evaluations = [
          ...blockedFromPrevious,
          ...(await this.evaluateCandidates(repairedCandidates)),
        ];
      }

      return await this.selectAndFinish();
    } catch (error) {
      await this.recordFatalError(error).catch(() => undefined);
      return await this.finish('BLOCKED', `controller failure: ${this.redactedError(error)}`);
    }
  }

  private redactedError(error: unknown): string {
    const raw = message(error);
    return this.options.apiKey.length === 0
      ? raw
      : raw.replaceAll(this.options.apiKey, '[REDACTED]');
  }

  private async recordJson(
    relativePath: string,
    value: unknown,
    actor: string,
    action: string,
    subject: string,
  ): Promise<EvidenceReference> {
    const reference = await this.evidence.writeJson(relativePath, value);
    await this.ledger.append({
      actor,
      action,
      subject,
      payload: { evidence: reference },
    });
    return reference;
  }

  private async recordFatalError(error: unknown): Promise<void> {
    await this.recordJson(
      'controller-error.json',
      {
        message: this.redactedError(error),
        stack:
          error instanceof Error && error.stack !== undefined
            ? this.redactedError(error.stack)
            : null,
        state: this.state.state,
      },
      'controller',
      'CONTROLLER_ERROR',
      this.runId,
    );
  }

  private async removeWorktree(worktree: string, subject: string): Promise<void> {
    try {
      await this.worktrees.remove(worktree);
      await this.ledger.append({
        actor: 'controller',
        action: 'WORKTREE_REMOVED',
        subject,
        payload: { worktreeLabel: path.basename(worktree) },
      });
    } catch (error) {
      await this.ledger.append({
        actor: 'controller',
        action: 'WORKTREE_CLEANUP_FAILED',
        subject,
        payload: { error: message(error) },
      });
    }
  }

  private async runAnalysts(): Promise<AnalystOutcome[]> {
    const roles = this.contract.contract.swarm.analysts;
    const contexts: Array<{ role: AgentRole; worktree: string }> = [];
    for (const role of roles) {
      const worktree = await this.worktrees.create(`analysis-${role.id}`, this.baseSha);
      contexts.push({ role, worktree });
    }

    return await mapLimit(
      contexts,
      this.contract.contract.swarm.maxParallelAgents,
      async ({ role, worktree }) => {
        const agent = await this.dependencies.runAgent({
          apiKey: this.options.apiKey,
          role,
          defaultModel: this.contract.contract.swarm.defaultModel,
          prompt: analystPrompt(this.contract, role),
          cwd: worktree,
          timeoutMs: this.contract.contract.swarm.agentTimeoutMs,
          runLabel: `${this.runId}:analysis:${role.id}`,
        });
        let changedFiles: string[] = [];
        let violations: string[] = [];
        try {
          changedFiles = await changedFilesFromBase(worktree, this.baseSha, {
            includeIgnored: true,
          });
          violations = readOnlyViolations(changedFiles);
          const head = await currentHead(worktree);
          if (head !== this.baseSha) {
            violations.push(`read-only agent changed HEAD from ${this.baseSha} to ${head}`);
          }
        } catch (error) {
          violations = [`workspace inspection failed: ${message(error)}`];
        }
        const verdict: Verdict =
          agent.status !== 'finished' || violations.length > 0 ? 'BLOCKED' : 'PASS';
        const outcome: AnalystOutcome = {
          role,
          agent,
          changedFiles,
          policyViolations: violations,
          verdict,
        };
        await this.recordJson(
          `agents/analysis/${role.id}.json`,
          outcome,
          role.id,
          'ANALYSIS_COMPLETED',
          role.id,
        );
        await this.removeWorktree(worktree, `analysis:${role.id}`);
        return outcome;
      },
    );
  }

  private async runBuilders(analyses: AnalystOutcome[]): Promise<CandidateOutcome[]> {
    const advisoryReports = analyses
      .filter((analysis) => analysis.verdict === 'PASS')
      .map((analysis) => ({
        roleId: analysis.role.id,
        result: analysis.agent.result,
      }));
    const contexts: Array<{ role: AgentRole; worktree: string }> = [];
    for (const role of this.contract.contract.swarm.builders) {
      contexts.push({
        role,
        worktree: await this.worktrees.create(`builder-${role.id}-a0`, this.baseSha),
      });
    }

    return await mapLimit(
      contexts,
      this.contract.contract.swarm.maxParallelAgents,
      async ({ role, worktree }) => {
        const agent = await this.dependencies.runAgent({
          apiKey: this.options.apiKey,
          role,
          defaultModel: this.contract.contract.swarm.defaultModel,
          prompt: builderPrompt(this.contract, role, advisoryReports),
          cwd: worktree,
          timeoutMs: this.contract.contract.swarm.agentTimeoutMs,
          runLabel: `${this.runId}:builder:${role.id}:a0`,
        });
        const outcome = await this.freezeBuilderOutcome(
          role,
          agent,
          worktree,
          this.baseSha,
          this.baseSha,
          0,
        );
        await this.recordJson(
          `agents/builders/${role.id}-a0.json`,
          outcome,
          role.id,
          'BUILDER_COMPLETED',
          `${role.id}-a0`,
        );
        await this.removeWorktree(worktree, `builder:${role.id}:a0`);
        return outcome;
      },
    );
  }

  private async freezeBuilderOutcome(
    role: AgentRole,
    agent: AgentExecution,
    worktree: string,
    baseSha: string,
    parentSha: string,
    attempt: number,
  ): Promise<CandidateOutcome> {
    const candidateId = `${role.id}-a${attempt}`;
    const reasons: string[] = [];
    if (agent.status !== 'finished') {
      reasons.push(`agent did not finish: ${agent.status} (${agent.error ?? ''})`);
      return { role, candidate: null, verdict: 'BLOCKED', reasons, agent };
    }

    let head: string;
    let changedFiles: string[];
    try {
      head = await currentHead(worktree);
      changedFiles = await changedFilesFromBase(worktree, baseSha);
    } catch (error) {
      reasons.push(`could not inspect builder workspace: ${message(error)}`);
      return { role, candidate: null, verdict: 'BLOCKED', reasons, agent };
    }
    if (head !== parentSha) {
      reasons.push(`agent exceeded authority by creating or checking out commit ${head}`);
    }
    if (changedFiles.length === 0) {
      reasons.push('builder produced no repository changes');
    }
    const policy = evaluateChangedPaths(changedFiles, this.contract.contract, this.protectedPaths);
    reasons.push(...policy.violations);
    if (reasons.length > 0) {
      return { role, candidate: null, verdict: 'REJECT', reasons, agent };
    }

    try {
      const commitSha = await freezeCandidate(worktree, this.repository, {
        runId: this.runId,
        candidateId,
        parentSha,
      });
      const patchReference = await this.evidence.writeText(
        `candidates/${candidateId}/candidate.patch`,
        await candidatePatch(worktree, baseSha, commitSha),
      );
      const candidate: Candidate = {
        candidateId,
        builderRoleId: role.id,
        attempt,
        baseSha,
        parentSha,
        commitSha,
        changedFiles: policy.normalizedFiles,
        diffStat: await diffStat(worktree, baseSha, commitSha),
        patch: patchReference,
        builder: agent,
      };
      await this.recordJson(
        `candidates/${candidateId}/candidate.json`,
        candidate,
        'controller',
        'CANDIDATE_FROZEN',
        commitSha,
      );
      return { role, candidate, verdict: 'PASS', reasons: [], agent };
    } catch (error) {
      reasons.push(`candidate freeze failed: ${message(error)}`);
      return { role, candidate: null, verdict: 'BLOCKED', reasons, agent };
    }
  }

  private async evaluateCandidates(candidates: Candidate[]): Promise<CandidateEvaluation[]> {
    const evaluations: CandidateEvaluation[] = [];
    for (const candidate of candidates) {
      evaluations.push(await this.evaluateCandidate(candidate));
    }
    return evaluations;
  }

  private async evaluateCandidate(candidate: Candidate): Promise<CandidateEvaluation> {
    const verificationWorktree = await this.worktrees.create(
      `verify-${candidate.candidateId}`,
      candidate.commitSha,
    );
    const reviewerContexts: Array<{ role: AgentRole; worktree: string }> = [];
    for (const role of this.contract.contract.swarm.reviewers) {
      reviewerContexts.push({
        role,
        worktree: await this.worktrees.create(
          `review-${candidate.candidateId}-${role.id}`,
          candidate.commitSha,
        ),
      });
    }

    const commandPromise = (async () => {
      const commands = [];
      for (const step of this.contract.contract.verification) {
        const command = await runVerificationStep(
          step,
          verificationWorktree,
          this.evidence,
          `candidates/${candidate.candidateId}/commands`,
        );
        commands.push(command);
        await this.ledger.append({
          actor: 'verifier',
          action: 'VERIFICATION_STEP_COMPLETED',
          subject: `${candidate.candidateId}:${step.id}`,
          payload: command,
        });
      }
      return commands;
    })();

    const reviewerPromise = mapLimit(
      reviewerContexts,
      this.contract.contract.swarm.maxParallelAgents,
      async ({ role, worktree }): Promise<ReviewerExecution> => {
        const agent = await this.dependencies.runAgent({
          apiKey: this.options.apiKey,
          role,
          defaultModel: this.contract.contract.swarm.defaultModel,
          prompt: reviewerPrompt(this.contract, role, candidate.commitSha),
          cwd: worktree,
          timeoutMs: this.contract.contract.swarm.agentTimeoutMs,
          runLabel: `${this.runId}:review:${candidate.candidateId}:${role.id}`,
        });
        let violations: string[] = [];
        try {
          const changed = await changedFilesFromBase(worktree, candidate.commitSha, {
            includeIgnored: true,
          });
          violations = readOnlyViolations(changed);
          const head = await currentHead(worktree);
          if (head !== candidate.commitSha) {
            violations.push(
              `read-only reviewer changed HEAD from ${candidate.commitSha} to ${head}`,
            );
          }
        } catch (error) {
          violations = [`workspace inspection failed: ${message(error)}`];
        }

        let decision = null;
        if (agent.status === 'finished' && violations.length === 0) {
          try {
            decision = parseReviewDecision(agent.result);
          } catch (error) {
            violations.push(message(error));
          }
        }
        const verdict: Verdict =
          agent.status !== 'finished' || violations.length > 0
            ? 'BLOCKED'
            : (decision?.verdict ?? 'BLOCKED');
        const reviewer: ReviewerExecution = {
          roleId: role.id,
          agent,
          decision,
          policyViolations: violations,
          verdict,
        };
        await this.recordJson(
          `candidates/${candidate.candidateId}/reviewers/${role.id}.json`,
          reviewer,
          role.id,
          'REVIEW_COMPLETED',
          `${candidate.candidateId}:${role.id}`,
        );
        await this.removeWorktree(worktree, `review:${candidate.candidateId}:${role.id}`);
        return reviewer;
      },
    );

    const [commandResult, reviewerResult] = await Promise.allSettled([
      commandPromise,
      reviewerPromise,
    ]);
    await this.removeWorktree(verificationWorktree, `verify:${candidate.candidateId}`);
    const stageFailures = [commandResult, reviewerResult].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (commandResult.status === 'rejected' || reviewerResult.status === 'rejected') {
      throw new AggregateError(
        stageFailures,
        `candidate ${candidate.candidateId} evaluation infrastructure failed`,
      );
    }
    const commands = commandResult.value;
    const reviewers = reviewerResult.value;

    const requiredCommands = commands.filter((_, index) => {
      const step = this.contract.contract.verification[index];
      return step?.required ?? false;
    });
    const requiredReviewers = reviewers.filter((reviewer) => {
      const role = this.contract.contract.swarm.reviewers.find(
        (candidateRole) => candidateRole.id === reviewer.roleId,
      );
      return role?.required ?? false;
    });
    const reasons = [
      ...requiredCommands
        .filter((command) => command.verdict !== 'PASS')
        .map((command) => `${command.stepId}: required verification ${command.verdict}`),
      ...requiredReviewers
        .filter((reviewer) => reviewer.verdict !== 'PASS')
        .map((reviewer) => `${reviewer.roleId}: required review ${reviewer.verdict}`),
    ];
    const verdict: Verdict =
      requiredCommands.some((command) => command.verdict === 'BLOCKED') ||
      requiredReviewers.some((reviewer) => reviewer.verdict === 'BLOCKED')
        ? 'BLOCKED'
        : requiredCommands.some((command) => command.verdict === 'REJECT') ||
            requiredReviewers.some((reviewer) => reviewer.verdict === 'REJECT')
          ? 'REJECT'
          : 'PASS';
    const evaluation: CandidateEvaluation = {
      candidate,
      commands,
      reviewers,
      verdict,
      reasons,
    };
    await this.recordJson(
      `candidates/${candidate.candidateId}/evaluation.json`,
      evaluation,
      'controller',
      'CANDIDATE_EVALUATED',
      candidate.candidateId,
    );
    return evaluation;
  }

  private async repairCandidates(
    rejected: CandidateEvaluation[],
    attempt: number,
  ): Promise<RepairOutcome[]> {
    const contexts: Array<{
      evaluation: CandidateEvaluation;
      role: AgentRole;
      worktree: string;
    }> = [];
    for (const evaluation of rejected) {
      const role = this.contract.contract.swarm.builders.find(
        (builder) => builder.id === evaluation.candidate.builderRoleId,
      );
      if (role === undefined) {
        throw new Error(`Missing builder role ${evaluation.candidate.builderRoleId}`);
      }
      contexts.push({
        evaluation,
        role,
        worktree: await this.worktrees.create(
          `repair-${evaluation.candidate.builderRoleId}-a${attempt}`,
          evaluation.candidate.commitSha,
        ),
      });
    }

    return await mapLimit(
      contexts,
      this.contract.contract.swarm.maxParallelAgents,
      async ({ evaluation, role, worktree }) => {
        const agent = await this.dependencies.runAgent({
          apiKey: this.options.apiKey,
          role,
          defaultModel: this.contract.contract.swarm.defaultModel,
          prompt: repairPrompt(this.contract, role, evaluation),
          cwd: worktree,
          timeoutMs: this.contract.contract.swarm.agentTimeoutMs,
          runLabel: `${this.runId}:repair:${role.id}:a${attempt}`,
        });
        const outcome = await this.freezeBuilderOutcome(
          role,
          agent,
          worktree,
          this.baseSha,
          evaluation.candidate.commitSha,
          attempt,
        );
        const repairOutcome: RepairOutcome = {
          ...outcome,
          previousCandidateId: evaluation.candidate.candidateId,
        };
        await this.recordJson(
          `agents/repairs/${role.id}-a${attempt}.json`,
          repairOutcome,
          role.id,
          'REPAIR_COMPLETED',
          `${role.id}-a${attempt}`,
        );
        await this.removeWorktree(worktree, `repair:${role.id}:a${attempt}`);
        return repairOutcome;
      },
    );
  }

  private async selectAndFinish(): Promise<OrchestrationResult> {
    const blocked = this.evaluations.filter((evaluation) => evaluation.verdict === 'BLOCKED');
    if (blocked.length > 0 || this.repairInfrastructureBlocked) {
      return await this.finish(
        'BLOCKED',
        'at least one mandatory candidate evaluation or repair path was indeterminate',
      );
    }

    const passing = this.evaluations.filter((evaluation) => evaluation.verdict === 'PASS');
    if (passing.length === 0) {
      return await this.finish(
        'REJECTED',
        'all candidates failed mandatory verification or review',
      );
    }
    if (passing.length > 1 && this.contract.contract.selection === 'human-if-multiple') {
      return await this.finish(
        'NEEDS_DECISION',
        'multiple independently passing candidates require human selection',
      );
    }

    const ordered = [...passing].sort((left, right) => {
      const leftLines = left.candidate.diffStat.insertions + left.candidate.diffStat.deletions;
      const rightLines = right.candidate.diffStat.insertions + right.candidate.diffStat.deletions;
      return (
        leftLines - rightLines ||
        left.candidate.diffStat.files - right.candidate.diffStat.files ||
        left.candidate.candidateId.localeCompare(right.candidate.candidateId)
      );
    });
    this.selectedCandidate = ordered[0]?.candidate.candidateId ?? null;
    return await this.finish(
      'ACCEPTED',
      passing.length === 1
        ? 'exactly one candidate passed every mandatory gate'
        : 'contract-authorized smallest-diff selection chose among passing candidates',
    );
  }

  private async finish(
    desiredState: Exclude<
      RunState,
      'CREATED' | 'ANALYZING' | 'BUILDING' | 'VERIFYING' | 'REPAIRING'
    >,
    reason: string,
  ): Promise<OrchestrationResult> {
    const cleanupFailures = await this.worktrees.cleanup();
    let leaseFailure: string | null = null;
    if (this.lease !== null) {
      try {
        this.lease.assertHealthy();
        const holder = this.lease.record.holder;
        await this.lease.release();
        await this.ledger.append({
          actor: 'controller',
          action: 'LEASE_RELEASED',
          subject: this.contract.contract.id,
          payload: { holder },
        });
      } catch (error) {
        leaseFailure = message(error);
        await this.ledger.append({
          actor: 'controller',
          action: 'LEASE_RELEASE_FAILED',
          subject: this.contract.contract.id,
          payload: { error: leaseFailure },
        });
      } finally {
        this.lease = null;
      }
    }
    let terminalState = desiredState;
    let terminalReason = reason;
    if (cleanupFailures.length > 0 && desiredState === 'ACCEPTED') {
      terminalState = 'BLOCKED';
      terminalReason =
        'candidate passed, but controller could not prove complete workspace cleanup';
    }
    if (cleanupFailures.length > 0) {
      await this.ledger.append({
        actor: 'controller',
        action: 'CLEANUP_INCOMPLETE',
        subject: this.runId,
        payload: { failures: cleanupFailures },
      });
    }
    if (leaseFailure !== null && desiredState !== 'BLOCKED') {
      terminalState = 'BLOCKED';
      terminalReason = 'controller ownership could not be proven through the terminal seal';
    }

    if (this.state.canTransition(terminalState)) {
      await this.state.transition(terminalState, terminalReason, {
        selectedCandidate: this.selectedCandidate,
      });
    } else if (this.state.state !== terminalState) {
      throw new Error(`Cannot finish ${this.state.state} as ${terminalState}: ${terminalReason}`);
    }

    const passing = this.evaluations
      .filter((evaluation) => evaluation.verdict === 'PASS')
      .map((evaluation) => evaluation.candidate.candidateId);
    const rejected = this.evaluations
      .filter((evaluation) => evaluation.verdict === 'REJECT')
      .map((evaluation) => evaluation.candidate.candidateId);
    const blocked = this.evaluations
      .filter((evaluation) => evaluation.verdict === 'BLOCKED')
      .map((evaluation) => evaluation.candidate.candidateId);
    const terminalHash = this.ledger.lastHash;
    if (terminalHash === null) {
      throw new Error('Cannot seal an empty accountability ledger');
    }
    const summary: RunSummary = {
      runId: this.runId,
      taskId: this.contract.contract.id,
      contractSha256: this.contract.sha256,
      baseSha: this.baseSha || 'UNRESOLVED',
      state: terminalState,
      selectedCandidate: this.selectedCandidate,
      passingCandidates: passing,
      rejectedCandidates: rejected,
      blockedCandidates: blocked,
      ledgerLastHash: terminalHash,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
    };
    const summaryReference = await this.evidence.writeJson('summary.json', summary);
    const seal = await this.ledger.append({
      actor: 'controller',
      action: 'RUN_SEALED',
      subject: this.runId,
      payload: {
        terminalState,
        terminalReason,
        summary: summaryReference,
        terminalTransitionHash: terminalHash,
      },
    });
    await this.ledger.flush();
    return {
      summary,
      runDirectory: this.evidence.runDirectory,
      sealHash: seal.hash,
    };
  }
}

export async function runAccountabilitySwarm(
  options: OrchestratorOptions,
  dependencies: OrchestratorDependencies = DEFAULT_DEPENDENCIES,
): Promise<OrchestrationResult> {
  const contract = await loadContract(options.contractPath);
  const repository = await repositoryRoot(options.repositoryPath);
  const runId = runIdentifier(contract.contract.id);
  const outputRoot = options.outputRoot ?? path.join(repository, '.accountability', 'runs');
  const runDirectory = path.join(path.resolve(outputRoot), runId);
  const evidence = new EvidenceStore(runDirectory);
  await evidence.initialize();
  const ledger = new SignedLedger(runId, runDirectory, options.signingKey);
  await ledger.initialize();
  await ledger.append({
    actor: 'controller',
    action: 'RUN_CREATED',
    subject: runId,
    payload: {
      taskId: contract.contract.id,
      contractSha256: contract.sha256,
      baseRef: contract.contract.baseRef,
      controllerVersion: '0.1.0',
    },
  });

  const run = new AccountabilityRun(
    options,
    repository,
    contract,
    runId,
    evidence,
    ledger,
    dependencies,
  );
  return await run.execute();
}
