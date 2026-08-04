import { AppNotification } from './NotificationModel'

const inbox: Record<string, AppNotification[]> = {}

export function addUserNotification(userId: string, n: AppNotification) {
    if (!inbox[userId]) inbox[userId] = []
    inbox[userId].unshift(n)
}

export function getUserNotifications(userId: string): AppNotification[] {
    return inbox[userId] || []
}
