export interface GiftTransfer {
    id: string
    senderId: string
    receiverId: string
    amount: number
    createdAt: number
    context?: string
}
