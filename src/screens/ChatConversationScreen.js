import React, { useState, useEffect, useRef, useMemo } from 'react';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { Alert, FlatList, Image, KeyboardAvoidingView, Platform, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { responsiveFont, responsiveSize, scaleIcon, scalePadding } from '../utils/scaleUtils';
import { firestore as db, db as compatDb } from '../config/firebase';
import BlypLogo from '../components/BlypLogo';
import { useAuth } from '../hooks/useCommon';
import { conversationsMessagingService } from '../services/messaging';
import { theme as blypTheme } from '../styles/blypTheme';
import ReportModal from '../components/ReportModal';
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
  const initialLoadRef = useRef(true);
  const soundRef = useRef(null);

  // Initialize sound
  useEffect(() => {
    const setupAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (error) {
        console.error('Error setting up audio:', error);
      }
    };

    setupAudio();

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const playMessageAlert = async () => {
    try {
      console.log('ðŸ”Š Attempting to play message notification...');

      // First trigger haptic feedback (vibration)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('ðŸ“³ Haptic feedback triggered');

      // Unload previous sound if exists
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Try to play a notification sound
      try {
        // Use a simple tone generator for notification sound
        const { sound } = await Audio.Sound.createAsync(
          {
            uri: 'https://www.soundjay.com/misc/sounds/bell-ringing-05.wav'
          },
          {
            shouldPlay: true,
            volume: 0.8,
            isLooping: false
          }
        );

        soundRef.current = sound;
        console.log('ðŸ”” Notification sound playing');

        // Clean up sound after playing
        setTimeout(async () => {
          try {
            if (soundRef.current) {
              await soundRef.current.unloadAsync();
              soundRef.current = null;
              console.log('ðŸ”‡ Sound cleaned up');
            }
          } catch (cleanupError) {
            console.error('Error cleaning up sound:', cleanupError);
          }
        }, 3000);

      } catch (soundError) {
        console.log('âš ï¸ Sound failed, using haptics only:', soundError.message);
        // Haptic feedback already triggered above as primary notification
      }

    } catch (error) {
      console.error('âŒ Complete notification alert failed:', error);
      // Last resort: try a different haptic pattern
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        console.log('ðŸ“³ Fallback haptic feedback used');
      } catch (hapticError) {
        console.error('âŒ Even haptic feedback failed:', hapticError);
      }
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

    console.log('ðŸ”„ Setting up messages listener for conversation:', conversationId);
    const unsubscribe = conversationsMessagingService.subscribeToMessages(
      db,
      conversationId,
      (messagesList) => {
        let hasNewIncomingMessage = false;
        messagesList.forEach((m) => {
          if (!initialLoadRef.current && uid && m.senderId !== uid && m.status === 'sent') {
            hasNewIncomingMessage = true;
          }
        });

        setMessages(messagesList);
        setLoading(false);

        if (hasNewIncomingMessage) {
          playMessageAlert();
        }
        if (initialLoadRef.current) {
          initialLoadRef.current = false;
        }
      },
      (e) => {
        console.error('âŒ Error subscribing to messages:', e);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [navigation, user.username, conversationId, uid]);

  useEffect(() => {
    // Auto scroll to bottom when messages change
    if (flatListRef.current && messages.length > 0) {
      setTimeout(() => {
        flatListRef.current.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages]);

  // Mark messages as read and reset unread count when entering chat
  useEffect(() => {
    if (!conversationId || !uid || messages.length === 0) return;

    const markMessagesAsRead = async () => {
      try {
        // Mark all unread messages from others as read
        const unreadMessages = messages.filter(msg =>
          msg.senderId !== uid && msg.status !== 'read'
        );

        if (unreadMessages.length > 0) {
          console.log('ðŸ‘€ Marking', unreadMessages.length, 'messages as read');

          await conversationsMessagingService.markMessagesRead(
            db,
            conversationId,
            uid,
            unreadMessages.map((m) => m.id),
          );

          await conversationsMessagingService.markThreadRead(db, conversationId, uid);
          console.log('âœ… Marked thread read for current user');
        }
      } catch (error) {
        console.error('âŒ Error marking messages as read:', error);
      }
    };

    // Debounce to prevent excessive calls
    const timeoutId = setTimeout(markMessagesAsRead, 500);
    return () => clearTimeout(timeoutId);
  }, [conversationId, uid, messages.length]); // Only depend on messages.length, not the entire messages array

  const sendMessage = async () => {
    if (!message.trim() || !conversationId) {
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

    try {
      const senderName = authUser?.displayName || authUser?.username || authUser?.email || 'Unknown';
      await conversationsMessagingService.sendMessage(db, conversationId, uid, senderName, clean);
      setMessage('');
    } catch (error) {
      console.error('âŒ Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const renderMessage = ({ item }) => {
    const isMe = item.senderId === uid;

    return (
      <View style={[styles.messageContainer, isMe ? styles.myMessage : styles.otherMessage]}>
        <View style={[styles.messageBubble, isMe ? styles.myBubble : styles.otherBubble]}>
          <Text style={[styles.messageText, isMe ? styles.myMessageText : styles.otherMessageText]}>
            {item.text}
          </Text>
          <View style={styles.messageFooter}>
            <Text style={[styles.messageTime, isMe ? styles.myMessageTime : styles.otherMessageTime]}>
              {formatTime(item.timestamp)}
            </Text>
            {isMe && (
              <View style={styles.messageStatus}>
                {item.status === 'sent' && (
                  <Icon name="checkmark" size={16} color="rgba(0,0,0,0.55)" />
                )}
                {item.status === 'delivered' && (
                  <View style={styles.doubleCheck}>
                    <Icon name="checkmark" size={16} color="rgba(0,0,0,0.55)" style={styles.check1} />
                    <Icon name="checkmark" size={16} color="rgba(0,0,0,0.55)" style={styles.check2} />
                  </View>
                )}
                {item.status === 'read' && (
                  <View style={styles.doubleCheck}>
                    <Icon name="checkmark" size={16} color="#003B30" style={styles.check1} />
                    <Icon name="checkmark" size={16} color="#003B30" style={styles.check2} />
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderBlypHeader = () => (
    <View style={styles.blypHeader}>
      <View style={styles.headerTop}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={T.textSecondary} />
        </TouchableOpacity>
        <BlypLogo useGradientBackground={true} />
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerActionButton}>
            <Icon name="videocam" size={24} color={T.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerActionButton}>
            <Icon name="call" size={24} color={T.textSecondary} />
          </TouchableOpacity>
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
          <Text style={styles.participantName}>{user.username || user.name || 'Unknown'}</Text>
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
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
          >
            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(item) => item.id}
              style={styles.messagesList}
              contentContainerStyle={styles.messagesContainer}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
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
                disabled={!message.trim()}
              >
                <LinearGradient
                  colors={message.trim() ? [T.gradientStart, T.gradientMiddle, T.gradientEnd] : [T.textDisabled, T.textMuted]}
                  style={styles.sendButtonGradient}
                >
                  <Icon
                    name={message.trim() ? "send" : "mic"}
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
    padding: 15,
    paddingBottom: 5,
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


