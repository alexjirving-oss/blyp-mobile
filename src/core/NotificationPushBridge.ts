import { routeNotificationToUser } from './PushNotificationRouter'
import { AppNotification } from './NotificationModel'

export function routeNotification(
    targetUserId: string,
    notification: AppNotification
) {
    routeNotificationToUser(targetUserId, notification)
}
