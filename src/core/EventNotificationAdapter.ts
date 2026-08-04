import { dispatchNotification } from './NotificationDispatcher'

export function notifyMessage(senderName: string, text: string) {
    dispatchNotification({
        id: Math.random().toString(),
        type: 'message',
        title: senderName,
        body: text,
        createdAt: Date.now(),
    })
}

export function notifyLiveStarted(host: string) {
    dispatchNotification({
        id: Math.random().toString(),
        type: 'live_start',
        title: 'Live Started',
        body: host + ' is live',
        createdAt: Date.now(),
    })
}
