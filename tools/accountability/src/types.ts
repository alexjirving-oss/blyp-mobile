export const RUN_STATES = [
  'CREATED',
  'ANALYZING',
  'BUILDING',
  'VERIFYING',
  'REPAIRING',
  'ACCEPTED',
  'REJECTED',
  'BLOCKED',
  'NEEDS_DECISION',
] as const;

export type RunState = (typeof RUN_STATES)[number];
export type Verdict = 'PASS' | 'REJECT' | 'BLOCKED';
export type FailureDisposition = 'REJECT' | 'BLOCKED';
export type SelectionStrategy = 'human-if-multiple' | 'smallest-diff';
export type VerificationRunner = 'npm' | 'node';

export interface VerificationStep {
  id: string;
  runner: VerificationRunner;
  args: string[];
  timeoutMs: number;
  required: boolean;
  onFailure: FailureDisposition;
  envAllowlist: string[];
}

export interface AgentRole {
  id: string;
  responsibility: string;
  required: boolean;
  model?: string;
}

export interface SwarmConfig {
  defaultModel: string;
  maxParallelAgents: number;
  maxRepairAttempts: number;
  agentTimeoutMs: number;
  analysts: AgentRole[];
  builders: AgentRole[];
  reviewers: AgentRole[];
}

export interface TaskContract {
  version: 1;
  id: string;
  title: string;
  objective: string;
  baseRef: string;
  acceptanceCriteria: string[];
  allowedPaths: string[];
  forbiddenPaths: string[];
  verification: VerificationStep[];
  swarm: SwarmConfig;
  selection: SelectionStrategy;
}

export interface LoadedContract {
  contract: TaskContract;
  sourcePath: string;
  canonicalJson: string;
  sha256: string;
}

export interface LedgerEventInput {
  actor: string;
  action: string;
  subject: string;
  payload: unknown;
}

export interface LedgerEvent extends LedgerEventInput {
  version: 1;
  runId: string;
  sequence: number;
  timestamp: string;
  previousHash: string | null;
  signatureAlgorithm: 'Ed25519';
  signingKeyId: string;
  hash: string;
  signature: string;
}

export interface LedgerVerification {
  valid: boolean;
  eventCount: number;
  lastHash: string | null;
  errors: string[];
}

export interface EvidenceReference {
  relativePath: string;
  sha256: string;
  bytes: number;
}

export interface AgentTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

export interface AgentExecution {
  roleId: string;
  agentId: string | null;
  runId: string | null;
  status: 'finished' | 'error' | 'cancelled' | 'startup-error' | 'timeout';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  model: string;
  usage: AgentTokenUsage | null;
  result: string;
  error: string | null;
}

export interface CommandExecution {
  stepId: string;
  runner: VerificationRunner;
  executable: string;
  args: string[];
  processArgs: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  spawnError: string | null;
  stdout: EvidenceReference;
  stderr: EvidenceReference;
  verdict: Verdict;
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  evidence: string;
  file?: string;
  line?: number;
}

export interface ReviewDecision {
  verdict: Verdict;
  summary: string;
  findings: ReviewFinding[];
}

export interface ReviewerExecution {
  roleId: string;
  agent: AgentExecution;
  decision: ReviewDecision | null;
  policyViolations: string[];
  verdict: Verdict;
}

export interface DiffStat {
  files: number;
  insertions: number;
  deletions: number;
}

export interface Candidate {
  candidateId: string;
  builderRoleId: string;
  attempt: number;
  baseSha: string;
  parentSha: string;
  commitSha: string;
  changedFiles: string[];
  diffStat: DiffStat;
  patch: EvidenceReference;
  builder: AgentExecution;
}

export interface CandidateEvaluation {
  candidate: Candidate;
  commands: CommandExecution[];
  reviewers: ReviewerExecution[];
  verdict: Verdict;
  reasons: string[];
}

export interface RunSummary {
  runId: string;
  taskId: string;
  contractSha256: string;
  baseSha: string;
  state: RunState;
  selectedCandidate: string | null;
  passingCandidates: string[];
  rejectedCandidates: string[];
  blockedCandidates: string[];
  ledgerLastHash: string;
  startedAt: string;
  finishedAt: string;
}
