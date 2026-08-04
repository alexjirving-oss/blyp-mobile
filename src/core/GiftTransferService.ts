import { debit, credit } from './WalletService'
import { dispatchNotification } from './NotificationDispatcher'
import { notifyGiftReceived } from './GiftNotificationHelper'
import { GiftTransfer } from './GiftModel'

export function transferGift(
    senderId: string,
    receiverId: string,
    amount: number,
    context?: string
): GiftTransfer {
    if (amount <= 0) {
        throw new Error('INVALID_GIFT_AMOUNT')
    }

    const gift: GiftTransfer = {
        id: Math.random().toString(),
        senderId,
        receiverId,
        amount,
        context,
        createdAt: Date.now(),
    }

    // debit sender
    debit(senderId, amount, 'gift_sent', gift.id)

    // credit receiver
    credit(receiverId, amount, 'gift_received', gift.id)

    try {
        // best-effort: do not break gift transfer flow
        notifyGiftReceived(receiverId, amount)
    } catch { }

    return gift
}
