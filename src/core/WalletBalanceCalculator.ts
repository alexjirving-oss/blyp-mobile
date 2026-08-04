import { getTransactions } from './WalletLedgerStore'

export function calculateBalance(userId: string) {
    const tx = getTransactions(userId)
    return tx.reduce((sum, t) => sum + t.amount, 0)
}
