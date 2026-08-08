import React, { memo, useCallback, useState, useEffect, useRef, useMemo } from 'react';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import { responsiveFont, responsiveSize, scaleIcon, scalePadding } from '../utils/scaleUtils';
import { firestore as db, db as compatDb } from '../config/firebase';
import BlypLogo from '../components/BlypLogo';
import { useAuth } from '../hooks/useCommon';
import { conversationsMessagingService } from '../services/messaging';
import { theme as blypTheme } from '../styles/blypTheme';
import ReportModal from '../components/ReportModal';
import GiftSystem from '../components/GiftSystem';
import { inspectText } from '../utils/contentFilter';

const withAlpha = (hex, alpha) => {
  const s = String(hex || '').replace('#', '');
  if (s.length !== 6) return hex;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const T = blypTheme.colors;

// A user is considered genuinely "online" only if presence says so AND the
// heartbeat is fresh (presence is written on AppState changes, and a hard kill
// can leave a stale 'online'); 2 minutes is a safe freshness window.
const ONLINE_FRESHNESS_MS = 2 * 60 * 1000;
const MESSAGE_PAGE_SIZE = 50;
const DATING_ACCENT = '#E83E5A';

const formatTime = (timestamp) => {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

const MessageRow = memo(({ item, isMe, datingContext }) => {
  const isGift = item.type === 'gift';
  return (
    <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
      <View
        style={[
          styles.messageBubble,
          isMe ? styles.myBubble : styles.otherBubble,
          datingContext && isMe ? styles.datingBubble : null,
          isGift ? styles.giftBubble : null,
        ]}
      >
        {isGift ? (
          <View style={styles.giftMessageHeader}>
            <Text style={styles.giftMessageEmoji}>{item.giftEmoji || '🎁'}</Text>
            <View style={styles.giftMessageCopy}>
              <Text style={[styles.giftMessageTitle, isMe && styles.myMessageText]}>
                {isMe ? 'Gift sent' : 'Gift received'}
              </Text>
              <Text style={[styles.giftMessageName, isMe && styles.myMessageText]}>
                {item.giftName || 'Blyp gift'}
                {Number(item.coinCost) > 0 ? ` · ${Number(item.coinCost).toLocaleString()} coins` : ''}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.otherMessageText]}>
            {item.text}
          </Text>
        )}
        <View style={styles.messageFooter}>
          <Text style={[styles.messageTime, isMe ? styles.myMessageTime : styles.otherMessageTime]}>
            {formatTime(item.timestamp)}
          </Text>
          {isMe ? (
            <View style={styles.messageStatus}>
              <Icon
                name={item.status === 'sent' ? 'checkmark' : 'checkmark-done'}
                size={16}
                color={item.status === 'read' ? '#003B30' : 'rgba(0,0,0,0.55)'}
              />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const formatLastSeen = (ms) => {
  const ts = Number(ms);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return `${days}d ago`;
  }
};

const ChatScreen = ({ route, navigation }) => {
  const { participant, otherUser, chatId } = route.params || {};
  const conversationId = route?.params?.conversationId || chatId;
  const datingContext = route?.params?.chatContext === 'dating';

  const user = useMemo(() =>
    otherUser || participant || {
      username: 'Unknown',
      name: 'Unknown',
      avatar: 'https://via.placeholder.com/50'
    }, [otherUser, participant]
  );
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [giftOpenSignal, setGiftOpenSignal] = useState(0);
  const { user: authUser, uid } = useAuth();

  // Resolve the other participant's uid so we can show GENUINE presence
  // (users/{uid}.presence = { state, lastSeenAt }) instead of a hardcoded
  // "Online • Last seen recently" string.
  const participantUid = useMemo(() => {
    const candidate = user?.uid || user?.userId || user?.id || participant?.id || otherUser?.id;
    return candidate ? String(candidate) : '';
  }, [user, participant, otherUser]);
  const [presence, setPresence] = useState(null);
  const [reportVisible, setReportVisible] = useState(false);

  useEffect(() => {
    if (!participantUid || !compatDb?.collection) {
      setPresence(null);
      return undefined;
    }
    let unsub = () => {};
    try {
      unsub = compatDb
        .collection('users')
        .doc(participantUid)
        .onSnapshot(
          (snap) => {
            const data = snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists)
              ? snap.data()
              : null;
            setPresence(data?.presence || null);
          },
          () => setPresence(null),
        );
    } catch {
      setPresence(null);
    }
    return () => {
      try { unsub(); } catch { /* ignore */ }
    };
  }, [participantUid]);

  const flatListRef = useRef(null);
  const oldestCursorRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const initialLoadRef = useRef(true);
  const soundRef = useRef(null);
  /** Message ids we have already alerted for — prevents re-sting on every snapshot. */
  const alertedMessageIdsRef = useRef(new Set());
  const playingAlertRef = useRef(false);

  // Media / loudspeaker routing for message stings (not voice-call / earpiece).
  useEffect(() => {
    const setupAudio = async () => {
      try {
        // eslint-disable-next-line global-require
        const { ensureMediaPlaybackAudioMode } = require('../services/notifySound');
        await ensureMediaPlaybackAudioMode({ background: false });
      } catch (error) {
        console.error('Error setting up audio:', error);
      }
    };

    setupAudio();

    return () => {
      if (soundRef.current) {
        try {
          // eslint-disable-next-line global-require
          const { stopBlypNotify } = require('../services/notifySound');
          stopBlypNotify(soundRef.current);
        } catch {
          try {
            soundRef.current.unloadAsync();
          } catch {
            // ignore
          }
        }
        soundRef.current = null;
      }
    };
  }, []);

  const playMessageAlert = async () => {
    if (playingAlertRef.current) return;
    playingAlertRef.current = true;
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (soundRef.current) {
        try {
          // eslint-disable-next-line global-require
          const { stopBlypNotify } = require('../services/notifySound');
          await stopBlypNotify(soundRef.current);
        } catch {
          try {
            await soundRef.current.unloadAsync();
          } catch {
            // ignore
          }
        }
        soundRef.current = null;
      }

      try {
        // eslint-disable-next-line global-require
        const { playBlypNotify } = require('../services/notifySound');
        const sound = await playBlypNotify({ looping: false, volume: 0.8 });
        soundRef.current = sound;

        setTimeout(async () => {
          try {
            if (soundRef.current === sound) {
              // eslint-disable-next-line global-require
              const { stopBlypNotify } = require('../services/notifySound');
              await stopBlypNotify(sound);
              soundRef.current = null;
            }
          } catch {
            // ignore
          }
        }, 2500);
      } catch (soundError) {
        console.log('Sound failed, using haptics only:', soundError?.message || soundError);
      }
    } catch (error) {
      console.error('Complete notification alert failed:', error);
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        // ignore
      }
    } finally {
      playingAlertRef.current = false;
    }
  };

  useEffect(() => {
    console.log('ðŸ—ï¸ ChatConversation screen loaded with params:', { participant, otherUser, chatId });
    console.log('ðŸ‘¤ Chat with user:', user.username, 'ChatID:', chatId);

    navigation.setOptions({
      headerTitle: user.username || user.name || 'Chat',
      headerStyle: { backgroundColor: T.headerBackground },
      headerTintColor: T.textPrimary,
    });

    if (!conversationId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    console.log('Setting up messages listener for conversation:', conversationId);
    // Reset per-thread alert memory when switching chats.
    alertedMessageIdsRef.current = new Set();
    initialLoadRef.current = true;
    oldestCursorRef.current = null;
    loadingOlderRef.current = false;
    setHasOlder(true);

    const unsubscribe = conversationsMessagingService.subscribeToMessages(
      db,
      conversationId,
      (messagesList, pageInfo) => {
        const list = Array.isArray(messagesList) ? messagesList : [];
        oldestCursorRef.current = pageInfo?.oldestCursor || null;
        setHasOlder(pageInfo?.hasMore !== false);

        if (initialLoadRef.current) {
          // Seed seen ids so historical "sent" messages never re-trigger the sting.
          list.forEach((m) => {
            if (m?.id) alertedMessageIdsRef.current.add(String(m.id));
          });
          initialLoadRef.current = false;
          setMessages(list);
          setLoading(false);
          return;
        }

        let shouldAlert = false;
        list.forEach((m) => {
          if (!m?.id || !uid) return;
          const mid = String(m.id);
          if (m.senderId === uid) {
            alertedMessageIdsRef.current.add(mid);
            return;
          }
          if (!alertedMessageIdsRef.current.has(mid)) {
            alertedMessageIdsRef.current.add(mid);
            shouldAlert = true;
          }
        });

        // Keep paged historical rows while replacing the live newest page.
        setMessages((previous) => {
          const liveIds = new Set(list.map((item) => item.id));
          return [...previous.filter((item) => !liveIds.has(item.id)), ...list];
        });
        setLoading(false);

        if (shouldAlert) {
          playMessageAlert();
        }
      },
      (e) => {
        console.error('Error subscribing to messages:', e);
        setLoading(false);
      },
      MESSAGE_PAGE_SIZE,
    );

    return () => {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    };
  }, [navigation, user.username, conversationId, uid]);

  // Focus-aware: suppress tray sound while this chat is visible; clear tray on open.
  useFocusEffect(
    React.useCallback(() => {
      if (!conversationId) return undefined;
      try {
        // eslint-disable-next-line global-require
        const { setActiveConversationId, clearActiveConversationId } = require('../services/activeConversation');
        setActiveConversationId(conversationId);
      } catch {
        // ignore
      }
      try {
        // eslint-disable-next-line global-require
        const { clearConversationNotifications } = require('../services/messagePushNative');
        clearConversationNotifications(conversationId);
      } catch {
        // ignore
      }
      return () => {
        try {
          // eslint-disable-next-line global-require
          const { clearActiveConversationId } = require('../services/activeConversation');
          clearActiveConversationId(conversationId);
        } catch {
          // ignore
        }
      };
    }, [conversationId]),
  );

  const loadOlderMessages = useCallback(async () => {
    if (
      !conversationId ||
      !oldestCursorRef.current ||
      !hasOlder ||
      loadingOlderRef.current
    ) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await conversationsMessagingService.loadOlderMessages(
        db,
        conversationId,
        oldestCursorRef.current,
        MESSAGE_PAGE_SIZE,
      );
      oldestCursorRef.current = page.oldestCursor;
      setHasOlder(page.hasMore);
      setMessages((previous) => {
        const seen = new Set(previous.map((item) => item.id));
        return [...page.messages.filter((item) => !seen.has(item.id)), ...previous];
      });
    } catch (error) {
      console.warn('[CHAT] Could not load older messages', error?.message || error);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, hasOlder]);

  // Clear Phone-tab badge as soon as the chat is opened/read — not only after a reply.
  // Per-message status updates are blocked by Firestore rules; conversation.unreadCount
  // is what drives the badge and is writable by participants.
  useEffect(() => {
    if (!conversationId || !uid) return undefined;

    const markRead = async () => {
      try {
        await conversationsMessagingService.markThreadRead(db, conversationId, uid);
      } catch (error) {
        console.error('Error marking thread read:', error);
      }
      try {
        // eslint-disable-next-line global-require
        const { clearConversationNotifications } = require('../services/messagePushNative');
        await clearConversationNotifications(conversationId);
      } catch {
        // ignore
      }
    };

    const timeoutId = setTimeout(markRead, 300);
    return () => clearTimeout(timeoutId);
  }, [conversationId, uid]);

  const sendMessage = useCallback(async () => {
    if (!message.trim() || !conversationId || sendingMessage) {
      console.log('âŒ Cannot send message - missing text or chatId:', { message: message.trim(), chatId });
      return;
    }

    if (!uid) {
      Alert.alert('Error', 'Please log in to send messages');
      return;
    }

    // Client-side first line of defence (server re-inspects authoritatively).
    const { blocked, clean } = inspectText(message.trim());
    if (blocked) {
      Alert.alert('Message not allowed', "That message contains content that isn't allowed on Blyp.");
      return;
    }

    setSendingMessage(true);
    try {
      const senderName = authUser?.displayName || authUser?.username || authUser?.email || 'Unknown';
      await conversationsMessagingService.sendMessage(db, conversationId, uid, senderName, clean);
      setMessage('');
    } catch (error) {
      console.error('âŒ Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setSendingMessage(false);
    }
  }, [authUser, chatId, conversationId, message, sendingMessage, uid]);

  const renderMessage = useCallback(
    ({ item }) => (
      <MessageRow item={item} isMe={item.senderId === uid} datingContext={datingContext} />
    ),
    [datingContext, uid],
  );

  const handleGiftSent = useCallback(async (gift) => {
    if (!conversationId || !uid) return;
    try {
      const senderName = authUser?.displayName || authUser?.username || authUser?.email || 'Unknown';
      await conversationsMessagingService.sendGiftMessage(
        db,
        conversationId,
        uid,
        senderName,
        gift,
      );
    } catch (error) {
      // The economy transfer already succeeded; do not imply that it failed.
      console.warn('[CHAT] Gift sent but receipt message failed', error?.message || error);
    }
  }, [authUser, conversationId, uid]);

  const renderBlypHeader = () => (
    <View style={styles.blypHeader}>
      <View style={styles.headerTop}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={T.textSecondary} />
        </TouchableOpacity>
        <BlypLogo useGradientBackground={true} />
        <View style={styles.headerActions}>
          {participantUid && participantUid !== uid ? (
            <TouchableOpacity
              style={[styles.headerActionButton, styles.giftHeaderButton]}
              onPress={() => setGiftOpenSignal((value) => value + 1)}
              accessibilityLabel={`Send a gift to ${user.username || user.name || 'this person'}`}
            >
              <Icon name="gift" size={21} color={datingContext ? DATING_ACCENT : T.primary} />
            </TouchableOpacity>
          ) : null}
          {participantUid && participantUid !== uid ? (
            <TouchableOpacity
              style={styles.headerActionButton}
              onPress={() => setReportVisible(true)}
              accessibilityLabel="Report or block this person"
            >
              <Icon name="ellipsis-vertical" size={24} color={T.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.chatInfo}>
        <Image
          source={{ uri: user.photoURL || user.avatar || user.userPhotoURL || user.photo || 'https://via.placeholder.com/50' }}
          style={styles.participantAvatar}
        />
        <View style={styles.participantInfo}>
          <View style={styles.participantNameRow}>
            <Text style={styles.participantName}>{user.username || user.name || 'Unknown'}</Text>
            {datingContext ? (
              <View style={styles.datingPill}>
                <Icon name="heart" size={10} color="#FFD8DF" />
                <Text style={styles.datingPillText}>Dating</Text>
              </View>
            ) : null}
          </View>
          {(() => {
            const isOnline =
              presence?.state === 'online' &&
              Number(presence?.lastSeenAt) > 0 &&
              Date.now() - Number(presence.lastSeenAt) < ONLINE_FRESHNESS_MS;
            if (isOnline) {
              return <Text style={[styles.participantStatus, styles.statusOnline]}>Online</Text>;
            }
            const seen = formatLastSeen(presence?.lastSeenAt);
            if (seen) {
              return <Text style={styles.participantStatus}>{`Last seen ${seen}`}</Text>;
            }
            // No genuine presence data — show the handle instead of a fake status.
            const handle = user.username || user.name;
            return (
              <Text style={styles.participantStatus}>
                {handle ? `@${String(handle).replace(/^@+/, '')}` : ''}
              </Text>
            );
          })()}
        </View>
      </View>
    </View>
  );

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
        <View style={styles.gradient}>
          {renderBlypHeader()}
          <KeyboardAvoidingView
            style={styles.keyboardContainer}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            <FlashList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              style={styles.messagesList}
              contentContainerStyle={styles.messagesContainer}
              showsVerticalScrollIndicator={false}
              onStartReached={loadOlderMessages}
              onStartReachedThreshold={0.35}
              maintainVisibleContentPosition={{
                autoscrollToBottomThreshold: 0.2,
                startRenderingFromBottom: true,
              }}
              ListHeaderComponent={
                loadingOlder ? (
                  <View style={styles.olderLoader}>
                    <ActivityIndicator size="small" color={datingContext ? DATING_ACCENT : T.primary} />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                loading ? (
                  <View style={styles.emptyMessages}>
                    <ActivityIndicator color={datingContext ? DATING_ACCENT : T.primary} />
                    <Text style={styles.emptyMessagesText}>Loading messages…</Text>
                  </View>
                ) : (
                  <View style={styles.emptyMessages}>
                    <Icon name="chatbubble-ellipses-outline" size={38} color={T.textDisabled} />
                    <Text style={styles.emptyMessagesText}>Start the conversation</Text>
                  </View>
                )
              }
            />

            <View style={styles.inputContainer}>
              <View style={styles.inputWrapper}>
                <TouchableOpacity style={styles.attachButton}>
                  <Icon name="add" size={24} color={T.textMuted} />
                </TouchableOpacity>

                <TextInput
                  style={styles.textInput}
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Type a message..."
                  placeholderTextColor={T.textMuted}
                  multiline
                  maxLength={1000}
                  maxFontSizeMultiplier={1.5} // Control scaling globally
                />

                <TouchableOpacity style={styles.emojiButton}>
                  <Icon name="happy-outline" size={24} color={T.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.cameraButton}>
                  <Icon name="camera" size={24} color={T.textMuted} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.sendButton, message.trim() ? styles.sendButtonActive : null]}
                onPress={sendMessage}
                disabled={!message.trim() || sendingMessage}
              >
                <LinearGradient
                  colors={message.trim() ? [T.gradientStart, T.gradientMiddle, T.gradientEnd] : [T.textDisabled, T.textMuted]}
                  style={styles.sendButtonGradient}
                >
                  <Icon
                    name={sendingMessage ? 'hourglass-outline' : message.trim() ? 'send' : 'mic'}
                    size={20}
                    color={T.textPrimary}
                  />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
      <ReportModal
        visible={reportVisible}
        onClose={() => setReportVisible(false)}
        targetType="user"
        targetId={participantUid}
        reportedUserId={participantUid}
        targetLabel={user?.username || user?.name || 'this person'}
      />
      {participantUid && participantUid !== uid ? (
        <GiftSystem
          postId={`chat:${conversationId}`}
          creatorId={participantUid}
          creatorName={user?.username || user?.name || user?.displayName || 'Blyp member'}
          hideTrigger
          openSignal={giftOpenSignal}
          navigation={navigation}
          onGiftSent={handleGiftSent}
        />
      ) : null}
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  // Blyp Header Styles
  blypHeader: {
    backgroundColor: withAlpha(T.headerBackground, 0.85),
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(T.textPrimary, 0.06),
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  backButton: {
    padding: 8,
  },
  headerActions: {
    flexDirection: 'row',
  },
  headerActionButton: {
    padding: 8,
    marginLeft: 8,
  },
  giftHeaderButton: {
    borderRadius: 18,
    backgroundColor: withAlpha(T.surface, 0.72),
    borderWidth: 1,
    borderColor: withAlpha(T.textPrimary, 0.1),
  },
  chatInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  participantAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  participantInfo: {
    flex: 1,
  },
  participantNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  participantName: {
    color: T.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 2,
  },
  participantStatus: {
    color: T.primary,
    fontSize: 14,
  },
  datingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: withAlpha(DATING_ACCENT, 0.2),
    borderWidth: 1,
    borderColor: withAlpha(DATING_ACCENT, 0.38),
  },
  datingPillText: {
    color: '#FFD8DF',
    fontSize: 10,
    fontWeight: '800',
  },
  statusOnline: {
    color: T.primary,
    fontWeight: '600',
  },
  keyboardContainer: {
    flex: 1,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAvatar: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    marginRight: 10,
  },
  headerName: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerStatus: {
    color: T.textMuted,
    fontSize: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: {
    marginLeft: 15,
    padding: 5,
  },
  messagesList: {
    flex: 1,
  },
  messagesContainer: {
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  olderLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  emptyMessages: {
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyMessagesText: {
    color: T.textMuted,
    fontSize: 14,
  },
  messageContainer: {
    marginVertical: 2,
    maxWidth: '85%',
  },
  myMessage: {
    alignSelf: 'flex-end',
  },
  otherMessage: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    minWidth: 60,
  },
  myBubble: {
    backgroundColor: T.primary,
    borderBottomRightRadius: 5,
  },
  datingBubble: {
    backgroundColor: DATING_ACCENT,
  },
  giftBubble: {
    minWidth: 190,
    borderWidth: 1,
    borderColor: withAlpha('#FBBF24', 0.38),
  },
  giftMessageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  giftMessageEmoji: {
    fontSize: 30,
    marginRight: 9,
  },
  giftMessageCopy: {
    flex: 1,
  },
  giftMessageTitle: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  giftMessageName: {
    color: T.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  otherBubble: {
    backgroundColor: withAlpha(T.surface, 0.9),
    borderBottomLeftRadius: 5,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  myMessageText: {
    // Teal/brand bubble background needs dark text to stay readable.
    color: '#000000',
  },
  otherMessageText: {
    color: T.textPrimary,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  messageTime: {
    fontSize: 11,
    marginTop: 2,
  },
  myMessageTime: {
    color: 'rgba(0, 0, 0, 0.55)',
  },
  otherMessageTime: {
    color: T.textMuted,
  },
  readReceipt: {
    marginLeft: 4,
    marginTop: 1,
  },
  messageStatus: {
    marginLeft: 4,
    marginTop: 1,
  },
  doubleCheck: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  check1: {
    marginLeft: -2,
  },
  check2: {
    marginLeft: -8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: T.headerBackground,
    borderTopWidth: 1,
    borderTopColor: withAlpha(T.textPrimary, 0.06),
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: withAlpha(T.surface, 0.5),
    borderRadius: 25,
    marginRight: 10,
    paddingHorizontal: 15,
    paddingVertical: 8,
    minHeight: 45,
    borderWidth: 1,
    borderColor: withAlpha(T.textPrimary, 0.1),
  },
  attachButton: {
    marginRight: 10,
    marginBottom: 2,
  },
  textInput: {
    flex: 1,
    color: T.textPrimary,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 5,
    maxFontSizeMultiplier: 1.5, // Control scaling globally
  },
  emojiButton: {
    marginLeft: 10,
    marginBottom: 2,
  },
  cameraButton: {
    marginLeft: 10,
    marginBottom: 2,
  },
  sendButton: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    overflow: 'hidden',
  },
  sendButtonGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    transform: [{ scale: 1.05 }],
  },
});

export default ChatScreen;


