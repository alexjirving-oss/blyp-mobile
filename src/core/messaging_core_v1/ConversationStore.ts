import type { Conversation } from './ConversationModel'

const conversations: Record<string, Conversation> = {}

export function createConversation(participants: string[]) {
    const c: Conversation = {
        id: Math.random().toString(),
        participants,
        createdAt: Date.now(),
    }
    conversations[c.id] = c
    return c
}

export function getConversation(id: string) {
    return conversations[id]
}

export function getUserConversations(userId: string) {
    return Object.values(conversations).filter((c) => c.participants.includes(userId))
}
