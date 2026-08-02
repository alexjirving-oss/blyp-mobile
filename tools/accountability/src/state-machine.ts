import type { SignedLedger } from './ledger.js';
import type { RunState } from './types.js';

const TRANSITIONS: Readonly<Record<RunState, readonly RunState[]>> = {
  CREATED: ['ANALYZING', 'BLOCKED'],
  ANALYZING: ['BUILDING', 'BLOCKED'],
  BUILDING: ['VERIFYING', 'REJECTED', 'BLOCKED'],
  VERIFYING: ['REPAIRING', 'ACCEPTED', 'REJECTED', 'BLOCKED', 'NEEDS_DECISION'],
  REPAIRING: ['VERIFYING', 'REJECTED', 'BLOCKED'],
  ACCEPTED: [],
  REJECTED: [],
  BLOCKED: [],
  NEEDS_DECISION: [],
};

export class RunStateMachine {
  private currentState: RunState = 'CREATED';

  constructor(private readonly ledger: SignedLedger) {}

  get state(): RunState {
    return this.currentState;
  }

  canTransition(next: RunState): boolean {
    return TRANSITIONS[this.currentState].includes(next);
  }

  async transition(next: RunState, reason: string, evidence: unknown = {}): Promise<void> {
    if (!this.canTransition(next)) {
      throw new Error(`Illegal accountability state transition ${this.currentState} -> ${next}`);
    }
    const previous = this.currentState;
    await this.ledger.append({
      actor: 'controller',
      action: 'STATE_TRANSITION',
      subject: `${previous}->${next}`,
      payload: { previous, next, reason, evidence },
    });
    this.currentState = next;
  }
}
