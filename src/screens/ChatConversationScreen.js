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
import useKeyboardBottomInset from '../hooks/useKeyboardBottomInset';
import {
  conversationsMessagingService,
  outboundReceiptStatus,
} from '../services/messaging';
import {
  formatLastSeenLabel,
  isPresenceOnline,
} from '../services/presenceService';
import { theme as blypTheme } from '../styles/blypTheme';
import ReportModal from '../components/ReportModal';
import GiftSystem from '../components/GiftSystem';
import { inspectText } from '../utils/contentFilter';

/** WhatsApp-style read blue on outbound teal bubbles. */
const TICK_READ = '#1A73E8';
const TICK_PENDING = 'rgba(0,0,0,0.55)';

const withAlpha = (hex, alpha) => {
  const s = String(hex || '').replace('#', '');
  if (s.length !== 6) return hex;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const T = blypTheme.colors;

// Online only if presence.state is online AND heartbeat is fresh (hard kills
// leave stale 'online'; sweep + 3m window cover that).
const ONLINE_FRESHNESS_MS = 3 * 60 * 1000;
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

const MessageRow = memo(({ item, isMe, datingContext, receiptStatus }) => {
  const isGift = item.type === 'gift';
  const status = receiptStatus || 'sent';
  const tickName = status === 'sent' ? 'checkmark' : 'checkmark-done';
  const tickColor = status === 'read' ? TICK_READ : TICK_PENDING;
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
            <View style={styles.messageStatus} accessibilityLabel={`Message ${status}`}>
              <Icon name={tickName} size={16} color={tickColor} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
});

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
  const [threadMeta, setThreadMeta] = useState(null);
  const [reportVisible, setReportVisible] = useState(false);
  // Re-evaluate freshness so hard-killed peers flip off "Online" without a new snapshot.
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const chatFocusedRef = useRef(false);

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

  useEffect(() => {
    const id = setInterval(() => setPresenceNow(Date.now()), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // Peer lastReadAt / lastDeliveredAt drive outbound ticks (rules block per-message status).
  useEffect(() => {
    if (!conversationId) {
      setThreadMeta(null);
      return undefined;
    }
    return conversationsMessagingService.subscribeToConversation(
      db,
      conversationId,
      (conv) => setThreadMeta(conv),
      () => {},
    );
  }, [conversationId]);

  const flatListRef = useRef(null);
  const composerRef = useRef(null);
  const oldestCursorRef = useRef(null);
  const loadingOlderRef = useRef(false);
  const initialLoadRef = useRef(true);
  const soundRef = useRef(null);
  /** Message ids we have already alerted for — prevents re-sting on every snapshot. */
  const alertedMessageIdsRef = useRef(new Set());
  const playingAlertRef = useRef(false);
  const { keyboardOpen, bottomInset } = useKeyboardBottomInset(composerRef);

  const scrollToLatest = useCallback((animated = true) => {
    const list = flatListRef.current;
    if (!list) return;
    try {
      // FlashList (inverted-from-bottom) — scrollToEnd keeps newest bubbles above composer.
      if (typeof list.scrollToEnd === 'function') {
        list.scrollToEnd({ animated });
        return;
      }
      if (typeof list.scrollToOffset === 'function') {
        list.scrollToOffset({ offset: 0, animated });
      }
    } catch {
      // ignore
    }
  }, []);

  // Keep the latest messages clear of the composer when the IME opens / grows (number row).
  useEffect(() => {
    if (!keyboardOpen) return undefined;
    const t1 = setTimeout(() => scrollToLatest(true), 40);
    const t2 = setTimeout(() => scrollToLatest(true), 220);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [keyboardOpen, bottomInset, scrollToLatest]);

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

        // Inbound: delivered while blurred; read (also stamps delivered) while focused
        // so blue ticks advance for messages that arrive with the thread open.
        if (uid) {
          const hasInbound = list.some((m) => m?.senderId && m.senderId !== uid);
          if (hasInbound) {
            const stamp = chatFocusedRef.current
              ? conversationsMessagingService.markThreadRead(db, conversationId, uid)
              : conversationsMessagingService.markThreadDelivered(db, conversationId, uid);
            stamp.catch(() => {});
          }
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

  // Focus-aware: suppress tray sound, stamp read/delivered, clear tray on open/re-focus.
  // Stack screens often stay mounted — mount-only markRead never re-ran on return.
  useFocusEffect(
    React.useCallback(() => {
      if (!conversationId) return undefined;
      chatFocusedRef.current = true;
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

      let cancelled = false;
      const markReadTimer = uid
        ? setTimeout(() => {
            if (cancelled) return;
            conversationsMessagingService
              .markThreadRead(db, conversationId, uid)
              .catch((error) => console.error('Error marking thread read:', error));
          }, 300)
        : null;

      return () => {
        cancelled = true;
        chatFocusedRef.current = false;
        if (markReadTimer) clearTimeout(markReadTimer);
        try {
          // eslint-disable-next-line global-require
          const { clearActiveConversationId } = require('../services/activeConversation');
          clearActiveConversationId(conversationId);
        } catch {
          // ignore
        }
      };
    }, [conversationId, uid]),
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

  const peerReceipt = useMemo(() => {
    if (!participantUid || !threadMeta) {
      return { deliveredAt: null, readAt: null };
    }
    return {
      deliveredAt: threadMeta?.lastDeliveredAt?.[participantUid] || null,
      readAt: threadMeta?.lastReadAt?.[participantUid] || null,
    };
  }, [participantUid, threadMeta]);

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
      requestAnimationFrame(() => scrollToLatest(true));
    } catch (error) {
      console.error('âŒ Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    } finally {
      setSendingMessage(false);
    }
  }, [authUser, chatId, conversationId, message, scrollToLatest, sendingMessage, uid]);

  const renderMessage = useCallback(
    ({ item }) => {
      const isMe = item.senderId === uid;
      const receiptStatus = isMe
        ? outboundReceiptStatus(item, peerReceipt.deliveredAt, peerReceipt.readAt)
        : undefined;
      return (
        <MessageRow
          item={item}
          isMe={isMe}
          datingContext={datingContext}
          receiptStatus={receiptStatus}
        />
      );
    },
    [datingContext, peerReceipt.deliveredAt, peerReceipt.readAt, uid],
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
            void presenceNow; // clock tick forces freshness re-check
            const isOnline = isPresenceOnline(presence, ONLINE_FRESHNESS_MS);
            if (isOnline) {
              return <Text style={[styles.participantStatus, styles.statusOnline]}>Online</Text>;
            }
            const seen = formatLastSeenLabel(presence?.lastSeenAt);
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
            style={[
              styles.keyboardContainer,
              // Android: single IME/safe pad on the container (hook owns the value).
              Platform.OS === 'android' ? { paddingBottom: bottomInset } : null,
            ]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={0}
            enabled={Platform.OS === 'ios'}
          >
            <FlashList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              style={styles.messagesList}
              contentContainerStyle={styles.messagesContainer}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
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

            <View
              ref={composerRef}
              style={[
                styles.inputContainer,
                // Android IME/safe pad is on the parent; iOS needs closed-keyboard safe area here.
                {
                  paddingBottom: Platform.OS === 'ios'
                    ? Math.max(10, keyboardOpen ? 10 : bottomInset || 10)
                    : 10,
                },
              ]}
            >
              <View style={styles.inputWrapper}>
                <TouchableOpacity style={styles.attachButton} hitSlop={8} accessibilityLabel="Attach">
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
                  maxFontSizeMultiplier={1.5}
                  textAlignVertical="center"
                  blurOnSubmit={false}
                  onFocus={() => {
                    requestAnimationFrame(() => scrollToLatest(true));
                  }}
                />

                <TouchableOpacity style={styles.emojiButton} hitSlop={8} accessibilityLabel="Emoji">
                  <Icon name="happy-outline" size={24} color={T.textMuted} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.cameraButton} hitSlop={8} accessibilityLabel="Camera">
                  <Icon name="camera" size={24} color={T.textMuted} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.sendButton, message.trim() ? styles.sendButtonActive : null]}
                onPress={sendMessage}
                disabled={!message.trim() || sendingMessage}
                accessibilityLabel={message.trim() ? 'Send message' : 'Voice message'}
                hitSlop={6}
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
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: T.headerBackground,
    borderTopWidth: 1,
    borderTopColor: withAlpha(T.textPrimary, 0.06),
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: withAlpha(T.surface, 0.5),
    borderRadius: 24,
    marginRight: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minHeight: 48,
    borderWidth: 1,
    borderColor: withAlpha(T.textPrimary, 0.1),
  },
  attachButton: {
    marginRight: 8,
    marginBottom: 4,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    color: T.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 120,
    minHeight: 36,
    paddingTop: Platform.OS === 'android' ? 8 : 7,
    paddingBottom: Platform.OS === 'android' ? 8 : 7,
    includeFontPadding: false,
    maxFontSizeMultiplier: 1.5,
  },
  emojiButton: {
    marginLeft: 6,
    marginBottom: 4,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButton: {
    marginLeft: 2,
    marginBottom: 4,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 0,
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


