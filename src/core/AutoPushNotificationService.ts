import { dispatchNotification } from './NotificationDispatcher'
import { routeNotification } from './NotificationPushBridge'
import { AppNotification } from './NotificationModel'

export function notifyUser(
    targetUserId: string,
    notification: AppNotification
) {
    // store notification
    dispatchNotification(notification)

    // push notification
    routeNotification(targetUserId, notification)
}
