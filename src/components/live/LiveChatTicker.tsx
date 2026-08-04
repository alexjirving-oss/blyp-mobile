import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type TickerMessage = {
  id: string;
  username: string;
  text: string;
  createdAt: number;
};

function normalizeMessage(m: any): TickerMessage | null {
  if (!m) return null;
  const id = m?.id != null ? String(m.id) : String(Date.now());
  const username = String(m?.username || 'User');
  const text = String(m?.text || '');
  const createdAt = typeof m?.createdAt === 'number' ? m.createdAt : Date.now();
  return { id, username, text, createdAt };
}

export function LiveChatTicker({
  latestMessage,
  maxItems = 6,
}: {
  latestMessage: any;
  maxItems?: number;
  typewriterMsPerChar?: number;
  typewriterStartDelayMs?: number;
}) {
  const [items, setItems] = React.useState<TickerMessage[]>([]);
  const lastIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const next = normalizeMessage(latestMessage);
    if (!next?.id) return;
    if (lastIdRef.current === next.id) return;
    lastIdRef.current = next.id;

    setItems((prev) => {
      const merged = [next, ...prev.filter((p) => p.id !== next.id)];
      return merged.slice(0, Math.max(1, maxItems));
    });
  }, [latestMessage, maxItems]);

  if (!items.length) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {items.map((m) => (
        <View key={m.id} style={styles.pill}>
          <Text style={styles.username} numberOfLines={1} allowFontScaling={false}>
            {m.username}
          </Text>
          <Text style={styles.text} numberOfLines={1} allowFontScaling={false}>
            {m.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 86,
    gap: 8,
  },
  pill: {
    alignSelf: 'flex-start',
    maxWidth: '90%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  username: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 110,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 1,
  },
});
