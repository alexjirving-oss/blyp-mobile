import { addStreamEarnings } from './StreamEarningsStore'
import { addCreatorEarnings } from './CreatorEarningsStore'
import { getLiveSession } from './LiveSessionStore'

export function recordLiveGift(sessionId: string, amount: number) {
    const session = getLiveSession(sessionId)
    if (!session) return

    addStreamEarnings(sessionId, amount)
    addCreatorEarnings(session.hostId, amount)
}
