import { addTransaction } from './WalletLedgerStore'

export function credit(userId: string, amount: number, type: string, ref?: string) {
    addTransaction({
        id: Math.random().toString(),
        userId,
        type: type as any,
        amount,
        createdAt: Date.now(),
        reference: ref,
    })
}

export function debit(userId: string, amount: number, type: string, ref?: string) {
    addTransaction({
        id: Math.random().toString(),
        userId,
        type: type as any,
        amount: -Math.abs(amount),
        createdAt: Date.now(),
        reference: ref,
    })
}
