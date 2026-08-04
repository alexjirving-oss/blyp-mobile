export interface Message {
    id: string
    conversationId: string
    senderId: string
    text: string
    createdAt: number
    readBy: string[]
}
