import { WalletTransaction } from './WalletTransactionModel'

const ledger: Record<string, WalletTransaction[]> = {}

export function addTransaction(t: WalletTransaction) {
    if (!ledger[t.userId]) {
        ledger[t.userId] = []
    }
    ledger[t.userId].push(t)
    console.log('[LEDGER]', t.type, t.amount)
}

export function getTransactions(userId: string) {
    return ledger[userId] || []
}
