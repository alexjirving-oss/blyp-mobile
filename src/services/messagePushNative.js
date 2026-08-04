/**
 * Android bridge for message push UX: active-chat suppression + tray clear.
 */
import { NativeModules, Platform } from 'react-native';

const Native = NativeModules?.IncomingCallModule;

export function syncActiveConversationNative(conversationId) {
  if (Platform.OS !== 'android' || !Native?.setActiveConversation) return;
  try {
    Native.setActiveConversation(String(conversationId || ''));
  } catch {
    // ignore
  }
}

export async function clearConversationNotificationsNative(conversationId) {
  if (Platform.OS !== 'android' || !Native?.clearConversationNotifications) return false;
  try {
    await Native.clearConversationNotifications(String(conversationId || ''));
    return true;
  } catch (e) {
    console.warn('[messagePush] clear tray failed', e?.message || String(e));
    return false;
  }
}

/** Best-effort: dismiss presented expo / OS notifications for this conversation. */
export async function clearConversationNotifications(conversationId) {
  const id = String(conversationId || '');
  if (!id) return;
  await clearConversationNotificationsNative(id);
  try {
    // eslint-disable-next-line global-require
    const Notifications = require('expo-notifications');
    const presented = await Notifications.getPresentedNotificationsAsync?.();
    if (!Array.isArray(presented)) return;
    await Promise.all(
      presented.map((n) => {
        const data = n?.request?.content?.data || {};
        const match = String(data.conversationId || '') === id;
        if (!match) return null;
        return Notifications.dismissNotificationAsync?.(n.request.identifier).catch(() => null);
      }),
    );
  } catch {
    // ignore
  }
}

export default {
  syncActiveConversationNative,
  clearConversationNotificationsNative,
  clearConversationNotifications,
};
