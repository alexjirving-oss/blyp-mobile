import { addMessage } from './MessageCache'
import type { Message } from './MessageModel'

export function handleIncomingMessage(msg: Message) {
    addMessage(msg)
    console.log('[MESSAGE_RECEIVED]', msg.id)
}
