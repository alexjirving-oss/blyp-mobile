import { dispatchNotification } from '../NotificationDispatcher'
import type { AppNotification } from '../NotificationModel'

import { addMessage } from './MessageStore'
import type { Message } from './MessageModel'

export function sendMessage(
    conversationId: string,
    senderId: string,
    receiverId: string,
    text: string
) {
    const message: Message = {
        id: Math.random().toString(),
        conversationId,
        senderId,
        text,
        createdAt: Date.now(),
        readBy: [senderId],
    }

    addMessage(message)

    const notification: AppNotification = {
        id: Math.random().toString(),
        type: 'message',
        title: 'New Message',
        body: text,
        createdAt: Date.now(),
    }

    // receiverId is intentionally not persisted in the Message model;
    // keep it available for callers or future routing logic.
    void receiverId

    dispatchNotification(notification)

    return message
}
