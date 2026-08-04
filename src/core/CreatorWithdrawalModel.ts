export type WithdrawalStatus =
    | 'pending'
    | 'pending_review'   // passed hard checks but flagged for manual review
    | 'processing'
    | 'completed'
    | 'rejected'

export interface CreatorWithdrawal {
    id: string
    hostId: string
    amount: number
    status: WithdrawalStatus
    createdAt: number
    processedAt?: number
    /** Risk reason codes attached when routed to review or rejected. */
    reasons?: string[]
}
