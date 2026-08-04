import { notifyUser } from './AutoPushNotificationService'

export function notifyMessageReceived(
    receiverId: string,
    senderName: string,
    text: string
) {
    notifyUser(receiverId, {
        id: Math.random().toString(),
        type: 'message',
        title: senderName,
        body: text,
        createdAt: Date.now(),
    })
}
