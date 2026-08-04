import { AppNotification } from './NotificationModel'

let notifications: AppNotification[] = []

export function addNotification(n: AppNotification) {
    const id = (n as any)?.id
    if (typeof id === 'string' && id.length) {
        const existingIndex = notifications.findIndex((x) => x.id === id)
        if (existingIndex !== -1) {
            const existing = { ...notifications[existingIndex], ...n }
            notifications.splice(existingIndex, 1)
            notifications.unshift(existing)
            console.log('[NOTIFICATION][DEDUP]', n.type)
            return
        }
    }

    notifications.unshift(n)
    console.log('[NOTIFICATION]', n.type)
}

export function getNotifications() {
    return notifications
}

export function markNotificationRead(id: string) {
    const n = notifications.find((x) => x.id === id)
    if (n) n.read = true
}
