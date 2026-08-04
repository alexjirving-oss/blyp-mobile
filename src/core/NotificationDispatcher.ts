import { addNotification } from './NotificationStore'
import { AppNotification } from './NotificationModel'

export function dispatchNotification(n: AppNotification) {
    addNotification(n)
}
