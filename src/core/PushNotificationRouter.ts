import { addUserNotification } from './UserNotificationInbox'
import { getUserDevices } from './UserDeviceRegistry'
import { deliverPush } from './PushDeliveryAdapter'
import { AppNotification } from './NotificationModel'

export function routeNotificationToUser(userId: string, n: AppNotification) {
    addUserNotification(userId, n)

    const devices = getUserDevices(userId)

    devices.forEach((d) => {
        deliverPush(d, n.title, n.body)
    })
}
