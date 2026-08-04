export type NotificationType =
    | 'message'
    | 'gift'
    | 'live_start'
    | 'follow'
    | 'system'

export interface AppNotification {
    id: string
    type: NotificationType
    title: string
    body: string
    createdAt: number
    read?: boolean
}
