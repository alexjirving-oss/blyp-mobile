/**
 * Tracks which conversation the user is actively viewing so push / tray
 * notifications can stay silent for that thread (WhatsApp-style).
 */
let activeConversationId = '';

export function setActiveConversationId(conversationId) {
  activeConversationId = conversationId ? String(conversationId) : '';
  try {
    // eslint-disable-next-line global-require
    const { syncActiveConversationNative } = require('./messagePushNative');
    syncActiveConversationNative(activeConversationId);
  } catch {
    // Native bridge optional.
  }
}

export function clearActiveConversationId(conversationId) {
  if (conversationId && String(conversationId) !== activeConversationId) return;
  activeConversationId = '';
  try {
    // eslint-disable-next-line global-require
    const { syncActiveConversationNative } = require('./messagePushNative');
    syncActiveConversationNative('');
  } catch {
    // ignore
  }
}

export function getActiveConversationId() {
  return activeConversationId;
}

export function isActiveConversation(conversationId) {
  if (!conversationId || !activeConversationId) return false;
  return String(conversationId) === activeConversationId;
}

export default {
  setActiveConversationId,
  clearActiveConversationId,
  getActiveConversationId,
  isActiveConversation,
};
