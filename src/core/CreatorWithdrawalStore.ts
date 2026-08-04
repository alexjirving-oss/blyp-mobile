import { CreatorWithdrawal, WithdrawalStatus } from './CreatorWithdrawalModel'

const withdrawals: CreatorWithdrawal[] = []

export function addWithdrawal(w: CreatorWithdrawal) {
    withdrawals.push(w)
}

export function getWithdrawals(hostId: string) {
    return withdrawals.filter((x) => x.hostId === hostId)
}

export function getPendingWithdrawals() {
    return withdrawals.filter((x) => x.status === 'pending')
}

export function updateWithdrawalStatus(id: string, status: WithdrawalStatus) {
    const w = withdrawals.find((x) => x.id === id)
    if (w) {
        w.status = status
        if (status === 'completed') {
            w.processedAt = Date.now()
        }
    }
}
