import { StreamEarnings } from './StreamEarningsModel'

const streamMap: Record<string, StreamEarnings> = {}

export function initStreamEarnings(sessionId: string, hostId: string) {
    streamMap[sessionId] = {
        sessionId,
        hostId,
        totalCoins: 0,
        createdAt: Date.now(),
    }
}

export function addStreamEarnings(sessionId: string, amount: number) {
    const s = streamMap[sessionId]
    if (s) {
        s.totalCoins += amount
    }
}

export function getStreamEarnings(sessionId: string) {
    return streamMap[sessionId]
}
