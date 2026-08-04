import { safeFetch } from './NetworkLogger'
import { addMessage, setConversationMessages } from './MessageCache'
import { notifyMessageReceived } from './MessageNotificationHelper'
import type { Message } from './MessageModel'

export async function sendMessage(conversationId: string, text: string) {
    const res = await safeFetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, text }),
    })

    const msg = (await res.json()) as Message
    addMessage(msg)

    try {
        const maybeReceiverId =
            (msg as any).receiverId ??
            (msg as any).toUserId ??
            (msg as any).recipientId
        if (typeof maybeReceiverId === 'string' && maybeReceiverId.length) {
            const senderName =
                (msg as any).senderName ??
                (msg as any).senderDisplayName ??
                (msg as any).senderId ??
                'New message'
            notifyMessageReceived(maybeReceiverId, String(senderName), text)
        }
    } catch { }

    return msg
}

export async function fetchMessages(conversationId: string) {
    const res = await safeFetch('/api/messages/' + conversationId)
    const msgs = (await res.json()) as Message[]
    setConversationMessages(conversationId, msgs)
    return msgs
}
