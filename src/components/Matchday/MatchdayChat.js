// MatchdayChat
//
// Live banter for a match room. Subscribes to the match-scoped Firestore
// collection via matchdayChatService and posts short messages.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import matchdayChatService from '../../services/matchdayChatService';
import { matchdayChatRoomId } from '../../services/matchdayService';
import { logMatchdayEvent } from '../../services/matchdayAnalytics';

const ACCENT = '#19D27C';

export default function MatchdayChat({ eventId, uid }) {
  const roomId = matchdayChatRoomId(eventId);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    const unsub = matchdayChatService.subscribeToRoom(roomId, (msgs) => {
      setMessages(msgs);
      setLoading(false);
    });
    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, [roomId]);

  const send = async () => {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    setText('');
    try {
      await matchdayChatService.sendMessage(roomId, clean);
      logMatchdayEvent('chat_send', { eventId });
    } catch (e) {
      setText(clean); // restore so the user doesn't lose their message
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }) => {
    const mine = item.senderId === uid;
    return (
      <View style={[styles.msgRow, mine && styles.msgRowMine]}>
        <View style={[styles.bubble, mine && styles.bubbleMine]}>
          {!mine && <Text style={styles.sender} numberOfLines={1}>{item.senderName || 'Fan'}</Text>}
          <Text style={[styles.msgText, mine && styles.msgTextMine]}>{item.text}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={responsiveSize(90)}
    >
      {loading ? (
        <ActivityIndicator color={ACCENT} style={{ marginTop: responsiveSize(24) }} />
      ) : messages.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="chatbubbles-outline" size={responsiveFont(34)} color={COLORS.textMuted} />
          <Text style={styles.emptyText}>Be the first to kick off the banter.</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: true })}
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={uid ? 'Say something…' : 'Sign in to chat'}
          placeholderTextColor={COLORS.textMuted}
          style={styles.input}
          editable={!!uid}
          maxLength={280}
          returnKeyType="send"
          onSubmitEditing={send}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || !uid) && styles.sendBtnOff]}
          onPress={send}
          disabled={!text.trim() || !uid || sending}
        >
          <Icon name="send" size={responsiveFont(18)} color={COLORS.background} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: { padding: responsiveSize(14), paddingBottom: responsiveSize(6) },
  msgRow: { flexDirection: 'row', marginBottom: responsiveSize(8) },
  msgRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(14),
    paddingHorizontal: responsiveSize(12),
    paddingVertical: responsiveSize(8),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  bubbleMine: { backgroundColor: ACCENT, borderColor: ACCENT },
  sender: { color: ACCENT, fontSize: responsiveFont(11), fontWeight: '800', marginBottom: 2 },
  msgText: { color: COLORS.textPrimary, fontSize: responsiveFont(14) },
  msgTextMine: { color: COLORS.background, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: responsiveSize(8) },
  emptyText: { color: COLORS.textMuted, fontSize: responsiveFont(13) },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: responsiveSize(8),
    paddingHorizontal: responsiveSize(12),
    paddingVertical: responsiveSize(10),
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    backgroundColor: COLORS.background,
  },
  input: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: responsiveFont(15),
    backgroundColor: COLORS.backgroundCard,
    borderRadius: responsiveSize(12),
    paddingHorizontal: responsiveSize(14),
    height: responsiveSize(44),
  },
  sendBtn: {
    width: responsiveSize(44),
    height: responsiveSize(44),
    borderRadius: responsiveSize(12),
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.4 },
});
