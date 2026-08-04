import type { Message } from './MessageModel'

const messageMap: Record<string, Message[]> = {}

export function setConversationMessages(id: string, messages: Message[]) {
    messageMap[id] = messages
}

export function getConversationMessages(id: string) {
    return messageMap[id] || []
}

export function addMessage(msg: Message) {
    if (!messageMap[msg.conversationId]) {
        messageMap[msg.conversationId] = []
    }
    messageMap[msg.conversationId].push(msg)
}
