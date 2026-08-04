import { notifyUser } from './AutoPushNotificationService'

export function notifyGiftReceived(receiverId: string, amount: number) {
    notifyUser(receiverId, {
        id: Math.random().toString(),
        type: 'gift',
        title: 'Gift received',
        body: 'You received ' + amount + ' coins',
        createdAt: Date.now(),
    })
}
