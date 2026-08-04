// CreatorWithdrawalService.ts
//
// Creates a creator cash-out request after running the full anti-fraud policy.
//
// SECURITY: this must only ever run in a trusted server context. The `context`
// passed in has to be assembled from authoritative server data (ledger, KYC
// provider, account flags) — never from values the client sends. The actual
// balance debit must happen atomically with recording the request inside the
// server's ledger transaction; the in-memory debit/store here is a reference
// implementation for the rules, not a production money mover.

import { assessWithdrawal, WithdrawalContext } from './WithdrawalGuard'
import { debit } from './WalletService'
import { addWithdrawal } from './CreatorWithdrawalStore'
import { CreatorWithdrawal } from './CreatorWithdrawalModel'

export class WithdrawalRejectedError extends Error {
    reasons: string[]
    constructor(reasons: string[]) {
        super(`WITHDRAWAL_REJECTED: ${reasons.join(',')}`)
        this.name = 'WithdrawalRejectedError'
        this.reasons = reasons
    }
}

export interface RequestWithdrawalInput {
    hostId: string
    amountCoins: number
    /** Server-assembled risk context (see WithdrawalContext). */
    context: WithdrawalContext
    /**
     * Server-generated, unique idempotency key used as the request id so retries
     * never create duplicate payouts. Never derive this from the client.
     */
    idempotencyKey: string
}

export function requestWithdrawal(input: RequestWithdrawalInput): CreatorWithdrawal {
    const { hostId, amountCoins, context, idempotencyKey } = input

    if (!hostId || !idempotencyKey) {
        throw new WithdrawalRejectedError(['MISSING_REQUIRED_FIELDS'])
    }

    const assessment = assessWithdrawal(context)
    if (assessment.decision === 'deny') {
        throw new WithdrawalRejectedError(assessment.reasons)
    }

    // Reserve the funds (server must do this atomically in the ledger transaction
    // that also writes the request, so a crash can't double-spend).
    debit(hostId, amountCoins, 'withdrawal')

    const withdrawal: CreatorWithdrawal = {
        id: idempotencyKey,
        hostId,
        amount: amountCoins,
        status: assessment.requiresManualReview ? 'pending_review' : 'pending',
        createdAt: context.now,
        reasons: assessment.reasons.length ? assessment.reasons : undefined,
    }

    addWithdrawal(withdrawal)

    return withdrawal
}
