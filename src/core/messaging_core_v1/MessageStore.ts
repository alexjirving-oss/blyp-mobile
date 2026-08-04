import type { Message } from './MessageModel'

const messages: Record<string, Message[]> = {}

export function addMessage(m: Message) {
    if (!messages[m.conversationId]) {
        messages[m.conversationId] = []
    }
    messages[m.conversationId].push(m)
}

export function getMessages(conversationId: string) {
    return messages[conversationId] || []
}

export function markConversationRead(conversationId: string, userId: string) {
    const list = messages[conversationId] || []
    list.forEach((m) => {
        if (!m.readBy.includes(userId)) {
            m.readBy.push(userId)
        }
    })
}
