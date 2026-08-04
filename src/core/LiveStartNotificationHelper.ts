import { notifyUser } from './AutoPushNotificationService'

export function notifyLiveStarted(followerId: string, hostName: string) {
    notifyUser(followerId, {
        id: Math.random().toString(),
        type: 'live_start',
        title: 'Live started',
        body: hostName + ' is live now',
        createdAt: Date.now(),
    })
}
