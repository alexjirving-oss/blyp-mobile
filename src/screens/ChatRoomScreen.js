import React, { useState, useEffect, useRef } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ChatRoomService from '../services/ChatRoomService';
import { auth } from '../config/firebase';

const MESSAGE_TYPES = {
  TEXT: 'text',
  SYSTEM: 'system',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio'
};

const ChatRoomScreen = ({ route, navigation }) => {
  const { roomId } = route.params;
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const flatListRef = useRef(null);
  const currentUser = auth.currentUser;

  useEffect(() => {
    if (roomId && currentUser) {
      loadRoomData();
      subscribeToMessages();
    }
  }, [roomId, currentUser]);

  const loadRoomData = async () => {
    try {
      const roomData = await ChatRoomService.getRoomDetails(roomId);
      setRoom(roomData);
      
      // Update navigation header
      navigation.setOptions({
        title: roomData.name,
        headerRight: () => (
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setShowParticipants(true)}
          >
            <Icon  name="people" size={24} color="#fff"  />
            <Text style={styles.participantCount}>{roomData.participantCount}</Text>
          </TouchableOpacity>
        ),
      });
    } catch (error) {
      console.error('Error loading room:', error);
      Alert.alert('Error', 'Failed to load room data');
      navigation.goBack();
    }
  };

  const subscribeToMessages = () => {
    const unsubscribe = ChatRoomService.subscribeToRoomMessages(roomId, (newMessages) => {
      setMessages(newMessages);
      setLoading(false);
      
      // Scroll to bottom when new messages arrive
      setTimeout(() => {
        if (flatListRef.current && newMessages.length > 0) {
          flatListRef.current.scrollToEnd({ animated: true });
        }
      }, 100);
    });

    return unsubscribe;
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || sending) return;

    const text = messageText.trim();
    setMessageText('');
    setSending(true);

    try {
      await ChatRoomService.sendMessage(roomId, {
        text,
        type: MESSAGE_TYPES.TEXT
      });
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message');
      setMessageText(text); // Restore message text
    } finally {
      setSending(false);
    }
  };

  const handleLeaveRoom = () => {
    Alert.alert(
      'Leave Room',
      'Are you sure you want to leave this room?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await ChatRoomService.leaveRoom(roomId);
              navigation.goBack();
            } catch (error) {
              Alert.alert('Error', error.message);
            }
          }
        }
      ]
    );
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const renderMessage = ({ item: message, index }) => {
    const isCurrentUser = message.senderId === currentUser?.uid;
    const isSystem = message.type === MESSAGE_TYPES.SYSTEM;
    const showTimestamp = index === 0 || 
      (new Date(messages[index - 1]?.timestamp) - new Date(message.timestamp)) > 300000; // 5 minutes

    if (isSystem) {
      return (
        <View style={styles.systemMessage}>
          <Text style={styles.systemMessageText}>{message.text}</Text>
        </View>
      );
    }

    return (
      <View style={[
        styles.messageContainer,
        isCurrentUser ? styles.currentUserMessage : styles.otherUserMessage
      ]}>
        {showTimestamp && (
          <Text style={styles.timestamp}>{formatTimestamp(message.timestamp)}</Text>
        )}
        
        <View style={[
          styles.messageBubble,
          isCurrentUser ? styles.currentUserBubble : styles.otherUserBubble
        ]}>
          {!isCurrentUser && (
            <Text style={styles.senderName}>{message.senderName}</Text>
          )}
          <Text style={[
            styles.messageText,
            isCurrentUser ? styles.currentUserText : styles.otherUserText
          ]}>
            {message.text}
          </Text>
        </View>
      </View>
    );
  };

  const renderParticipantsModal = () => (
    <Modal
      visible={showParticipants}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowParticipants(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowParticipants(false)}>
            <Text style={styles.modalCancel}>Done</Text>
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Participants ({room?.participantCount})</Text>
          <TouchableOpacity onPress={handleLeaveRoom}>
            <Text style={styles.leaveButton}>Leave</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modalContent}>
          <View style={styles.roomInfo}>
            <Text style={styles.roomName}>{room?.name}</Text>
            <Text style={styles.roomDescription}>{room?.description}</Text>
            <View style={styles.roomMeta}>
              <Text style={styles.roomMetaText}>
                Created {room?.createdAt ? formatTimestamp(room.createdAt) : ''}
              </Text>
              <Text style={styles.roomMetaText}>
                {room?.category.charAt(0).toUpperCase() + room?.category.slice(1)} • 
                {room?.isPrivate ? ' Private' : ' Public'}
              </Text>
            </View>
          </View>

          {/* Participants list would go here - for now showing placeholder */}
          <View style={styles.participantsSection}>
            <Text style={styles.sectionTitle}>Members</Text>
            <View style={styles.participantItem}>
              <View style={styles.participantAvatar}>
                <Icon  name="person" size={20} color="#fff"  />
              </View>
              <View style={styles.participantInfo}>
                <Text style={styles.participantName}>
                  {currentUser?.displayName || 'You'}
                </Text>
                <Text style={styles.participantStatus}>Online</Text>
              </View>
              {room?.createdBy === currentUser?.uid && (
                <View style={styles.hostBadge}>
                  <Text style={styles.hostBadgeText}>Host</Text>
                </View>
              )}
            </View>
            
            {/* Additional participants would be loaded from Firebase */}
            <View style={styles.participantPlaceholder}>
              <Text style={styles.participantPlaceholderText}>
                Other participants will appear here
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Icon  name="chatbubbles-outline" size={64} color="#374151"  />
        <Text style={styles.loadingText}>Loading room...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon  name="arrow-back" size={24} color="#fff"  />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{room?.name}</Text>
          <Text style={styles.headerSubtitle}>
            {room?.participantCount} member{room?.participantCount !== 1 ? 's' : ''}
          </Text>
        </View>
        
        <TouchableOpacity 
          style={styles.participantsButton}
          onPress={() => setShowParticipants(true)}
        >
          <Icon  name="people" size={24} color="#fff"  />
        </TouchableOpacity>
      </View>

      {/* Messages List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        style={styles.messagesList}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => {
          if (flatListRef.current) {
            flatListRef.current.scrollToEnd({ animated: false });
          }
        }}
        ListEmptyComponent={
          <View style={styles.emptyMessages}>
            <Icon  name="chatbubbles-outline" size={64} color="#374151"  />
            <Text style={styles.emptyTitle}>Start the conversation</Text>
            <Text style={styles.emptyText}>
              Be the first to send a message in this room
            </Text>
          </View>
        }
      />

      {/* Message Input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inputContainer}
      >
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.attachButton}>
            <Icon  name="add" size={24} color="#6b7280"  />
          </TouchableOpacity>
          
          <TextInput
            style={styles.messageInput}
            placeholder="Type a message..."
            placeholderTextColor="#6b7280"
            value={messageText}
            onChangeText={setMessageText}
            multiline
            maxLength={1000}
            editable={!sending}
          />
          
          <TouchableOpacity
            style={[
              styles.sendButton,
              (messageText.trim() && !sending) ? styles.sendButtonActive : styles.sendButtonInactive
            ]}
            onPress={handleSendMessage}
            disabled={!messageText.trim() || sending}
          >
            <LinearGradient
              colors={
                (messageText.trim() && !sending) 
                  ? ['#a855f7', '#d946ef'] 
                  : ['#374151', '#374151']
              }
              style={styles.sendButtonGradient}
            >
              <Icon  
                name={sending ? "hourglass-outline" : "send"} 
                size={20} 
                color="#fff" 
               />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Participants Modal */}
      {renderParticipantsModal()}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  loadingText: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: StatusBar.currentHeight + 12,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  participantsButton: {
    padding: 8,
    marginRight: -8,
  },
  messagesList: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  messagesContent: {
    padding: 16,
    paddingBottom: 8,
  },
  messageContainer: {
    marginBottom: 16,
  },
  currentUserMessage: {
    alignItems: 'flex-end',
  },
  otherUserMessage: {
    alignItems: 'flex-start',
  },
  timestamp: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 8,
  },
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  currentUserBubble: {
    backgroundColor: '#a855f7',
    borderBottomRightRadius: 4,
  },
  otherUserBubble: {
    backgroundColor: '#334155',
    borderBottomLeftRadius: 4,
  },
  senderName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    marginBottom: 4,
  },
  messageText: {
    fontSize: 16,
    lineHeight: 22,
  },
  currentUserText: {
    color: '#fff',
  },
  otherUserText: {
    color: '#fff',
  },
  systemMessage: {
    alignItems: 'center',
    marginBottom: 16,
  },
  systemMessageText: {
    fontSize: 12,
    color: '#6b7280',
    fontStyle: 'italic',
    textAlign: 'center',
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  emptyMessages: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  inputContainer: {
    backgroundColor: '#1e293b',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageInput: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
  },
  sendButtonActive: {
    opacity: 1,
  },
  sendButtonInactive: {
    opacity: 0.6,
  },
  sendButtonGradient: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: StatusBar.currentHeight + 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalCancel: {
    fontSize: 16,
    color: '#a855f7',
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  leaveButton: {
    fontSize: 16,
    color: '#ef4444',
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  roomInfo: {
    marginBottom: 32,
  },
  roomName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  roomDescription: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 12,
    lineHeight: 24,
  },
  roomMeta: {
    gap: 4,
  },
  roomMetaText: {
    fontSize: 14,
    color: '#6b7280',
  },
  participantsSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  participantItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  participantAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#a855f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  participantInfo: {
    flex: 1,
  },
  participantName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  participantStatus: {
    fontSize: 12,
    color: '#10b981',
    marginTop: 2,
  },
  hostBadge: {
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  hostBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  participantPlaceholder: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  participantPlaceholderText: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'italic',
  },
});

export default ChatRoomScreen;