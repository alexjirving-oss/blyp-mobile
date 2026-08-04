export interface Conversation {
    id: string
    participantIds: string[]
    lastMessage?: string
    updatedAt: number
}
