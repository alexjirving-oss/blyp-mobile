/**
 * Full-screen cinema playback for DM / chat gifts.
 * Reuses LiveGiftOverlay so message gifts share live motion + film audio.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import LiveGiftOverlay from './LiveGiftOverlay';
import { GIFT_MOTION, resolveMotion } from './giftMotion/giftMotionSystem';

function resolveGiftIdFromMessage(message) {
  const direct = String(message?.giftId || '').trim().toLowerCase();
  if (direct && (GIFT_MOTION[direct] || resolveMotion(direct))) return direct;

  const name = String(message?.giftName || '').trim().toLowerCase();
  if (name) {
    const byName = Object.values(GIFT_MOTION || {}).find(
      (g) => String(g?.name || '').trim().toLowerCase() === name,
    );
    if (byName?.giftId) return String(byName.giftId).toLowerCase();
  }

  const emoji = String(message?.giftEmoji || '').trim();
  if (emoji) {
    const byEmoji = Object.values(GIFT_MOTION || {}).find((g) => g?.emoji === emoji);
    if (byEmoji?.giftId) return String(byEmoji.giftId).toLowerCase();
  }

  return direct || 'heart';
}

/**
 * Build a LiveGiftOverlay-compatible event from a chat gift message / send receipt.
 */
export function giftEventFromChatMessage(message, { sender, receiver } = {}) {
  if (!message) return null;
  const giftId = resolveGiftIdFromMessage(message);
  const coinSpent = Math.max(0, Number(message.coinCost || message.coinSpent || 0));
  return {
    giftEventId: String(message.id || message.giftEventId || `chat-gift-${giftId}-${Date.now()}`),
    giftId,
    quantity: Math.max(1, Number(message.quantity) || 1),
    coinSpent,
    sequenceNo: Number(message.sequenceNo) || Date.now(),
    sender: {
      userId: String(sender?.userId || message.senderId || ''),
      handle: sender?.handle || message.senderName || null,
      avatarUrl: sender?.avatarUrl || null,
    },
    receiver: {
      userId: String(receiver?.userId || ''),
      handle: receiver?.handle || null,
      avatarUrl: receiver?.avatarUrl || null,
    },
  };
}

export default function MessageGiftCinemaOverlay({ giftEvent, onComplete, style }) {
  const event = useMemo(() => giftEvent || null, [giftEvent]);
  const handleHeroComplete = useCallback(() => {
    try {
      onComplete?.(event);
    } catch {
      // ignore
    }
  }, [event, onComplete]);

  if (!event) return null;
  return (
    <View style={[styles.root, style]} pointerEvents="box-none">
      <LiveGiftOverlay giftEvent={event} onHeroComplete={handleHeroComplete} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    elevation: 80,
  },
});
