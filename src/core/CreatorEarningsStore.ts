import { CreatorEarnings } from './CreatorEarningsModel'

const creatorTotals: Record<string, CreatorEarnings> = {}

export function addCreatorEarnings(hostId: string, amount: number) {
    if (!creatorTotals[hostId]) {
        creatorTotals[hostId] = {
            hostId,
            lifetimeCoins: 0,
        }
    }
    creatorTotals[hostId].lifetimeCoins += amount
}

export function getCreatorEarnings(hostId: string) {
    return creatorTotals[hostId]
}
