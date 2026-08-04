import { LockedEarning } from './LockedEarningsModel'
import { WITHDRAWAL_POLICY } from './WithdrawalPolicy'

const locked: Record<string, LockedEarning[]> = {}

export function lockCreatorEarnings(hostId: string, amount: number) {
    if (!locked[hostId]) locked[hostId] = []

    locked[hostId].push({
        amount,
        unlockAt: Date.now() + WITHDRAWAL_POLICY.HOLD_DURATION_MS,
    })
}

export function getUnlockedAmount(hostId: string) {
    const now = Date.now()
    const list = locked[hostId] || []

    return list
        .filter((x) => x.unlockAt <= now)
        .reduce((sum, x) => sum + x.amount, 0)
}

export function getLockedAmount(hostId: string) {
    const now = Date.now()
    const list = locked[hostId] || []

    return list
        .filter((x) => x.unlockAt > now)
        .reduce((sum, x) => sum + x.amount, 0)
}
