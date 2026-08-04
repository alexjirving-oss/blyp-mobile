import { transferGift } from './GiftTransferService'
import { getLiveSession } from './LiveSessionStore'

export function sendLiveGift(sessionId: string, senderId: string, amount: number) {
    const session = getLiveSession(sessionId)

    if (!session) {
        throw new Error('LIVE_SESSION_NOT_FOUND')
    }

    return transferGift(senderId, session.hostId, amount, 'live_session:' + sessionId)
}
