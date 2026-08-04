export type WalletTransactionType =
    | 'purchase'
    | 'gift_sent'
    | 'gift_received'
    | 'withdrawal'
    | 'adjustment'

export interface WalletTransaction {
    id: string
    userId: string
    type: WalletTransactionType
    amount: number
    createdAt: number
    reference?: string
}
