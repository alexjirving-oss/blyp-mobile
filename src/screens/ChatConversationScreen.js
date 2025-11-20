import React, { useState, useEffect, useRef, useMemo } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Image,
  StatusBar,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, updateDoc, where, getDocs, setDoc, getDoc } from 'firebase/firestore';
import { responsiveFont, responsiveSize, scaleIcon, scalePadding } from '../utils/scaleUtils';
import { auth, firestore as db } from '../config/firebase';
import BlypLogo from '../components/BlypLogo';

const ChatScreen = ({ route, navigation }) => {
  const { participant, otherUser, chatId } = route.params || {};
  
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
  const currentUser = auth.currentUser;
  
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
      console.log('🔊 Attempting to play message notification...');
      
      // First trigger haptic feedback (vibration)
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('📳 Haptic feedback triggered');
      
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
        console.log('🔔 Notification sound playing');
        
        // Clean up sound after playing
        setTimeout(async () => {
          try {
            if (soundRef.current) {
              await soundRef.current.unloadAsync();
              soundRef.current = null;
              console.log('🔇 Sound cleaned up');
            }
          } catch (cleanupError) {
            console.error('Error cleaning up sound:', cleanupError);
          }
        }, 3000);
        
      } catch (soundError) {
        console.log('⚠️ Sound failed, using haptics only:', soundError.message);
        // Haptic feedback already triggered above as primary notification
      }
      
    } catch (error) {
      console.error('❌ Complete notification alert failed:', error);
      // Last resort: try a different haptic pattern
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        console.log('📳 Fallback haptic feedback used');
      } catch (hapticError) {
        console.error('❌ Even haptic feedback failed:', hapticError);
      }
    }
  };

  useEffect(() => {
    console.log('🏗️ ChatConversation screen loaded with params:', { participant, otherUser, chatId });
    console.log('👤 Chat with user:', user.username, 'ChatID:', chatId);
    
    // Set up header
    navigation.setOptions({
      headerTitle: user.username || user.name || 'Chat',
      headerStyle: {
        backgroundColor: '#1e293b',
      },
      headerTintColor: '#fff',
    });

    // Set up real-time messaging if we have a chat ID
    if (chatId) {
      console.log('🔄 Setting up Firebase listener for chat:', chatId);
      const messagesRef = collection(db, 'chats', chatId, 'messages');
      const q = query(messagesRef, orderBy('timestamp', 'asc'));
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        console.log('📨 Firebase snapshot received, message count:', snapshot.size);
        const messagesList = [];
        let hasNewIncomingMessage = false;
        
        snapshot.forEach((doc) => {
          const messageData = { id: doc.id, ...doc.data() };
          messagesList.push(messageData);
          console.log('💬 Message:', messageData.text, 'from:', messageData.senderName, 'status:', messageData.status);
          
          // Check if this is a new message from another user
          if (!initialLoadRef.current && 
              messageData.senderId !== currentUser?.uid && 
              messageData.status === 'sent') {
            hasNewIncomingMessage = true;
            console.log('🔔 New incoming message detected:', messageData.text, 'from:', messageData.senderName);
          }
        });
        
        setMessages(messagesList);
        setLoading(false);
        
        // Play alert sound for new incoming messages (not on initial load)
        if (hasNewIncomingMessage) {
          console.log('🔊 Playing message alert sound');
          playMessageAlert();
        }
        
        // Set initial load flag to false after first snapshot
        if (initialLoadRef.current) {
          initialLoadRef.current = false;
        }
        
        // Mark messages as delivered (but not read yet - that happens when user enters chat)
        snapshot.forEach((doc) => {
          const message = doc.data();
          if (message.senderId !== currentUser?.uid && message.status === 'sent') {
            console.log('✅ Marking message as delivered:', message.text);
            updateDoc(doc.ref, { status: 'delivered', deliveredAt: serverTimestamp() });
          }
        });
      });
      
      return unsubscribe;
    } else {
      setMessages([]);
      setLoading(false);
    }
  }, [navigation, user.username, chatId, currentUser?.uid]);

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
    if (!chatId || !currentUser?.uid || messages.length === 0) return;
    
    const markMessagesAsRead = async () => {
      try {
        // Mark all unread messages from others as read
        const unreadMessages = messages.filter(msg => 
          msg.senderId !== currentUser.uid && msg.status !== 'read'
        );
        
        if (unreadMessages.length > 0) {
          console.log('👀 Marking', unreadMessages.length, 'messages as read');
          
          // Update message status to read
          const updatePromises = unreadMessages.map(msg => {
            const messageRef = doc(db, 'chats', chatId, 'messages', msg.id);
            return updateDoc(messageRef, { 
              status: 'read', 
              readAt: serverTimestamp() 
            });
          });
          
          await Promise.all(updatePromises);
          
          // Reset unread count for current user in chat document
          const chatRef = doc(db, 'chats', chatId);
          const chatDocSnap = await getDoc(chatRef);
          const chatData = chatDocSnap.data();
          const currentUnreadCount = chatData?.unreadCount || {};
          
          if (currentUnreadCount[currentUser.uid] > 0) {
            const updatedUnreadCount = { 
              ...currentUnreadCount,
              [currentUser.uid]: 0 
            };
            
            await updateDoc(chatRef, { unreadCount: updatedUnreadCount });
            console.log('✅ Reset unread count for current user');
          }
        }
      } catch (error) {
        console.error('❌ Error marking messages as read:', error);
      }
    };
    
    // Debounce to prevent excessive calls
    const timeoutId = setTimeout(markMessagesAsRead, 500);
    return () => clearTimeout(timeoutId);
  }, [chatId, currentUser?.uid, messages.length]); // Only depend on messages.length, not the entire messages array

  const sendMessage = async () => {
    if (!message.trim() || !chatId) {
      console.log('❌ Cannot send message - missing text or chatId:', { message: message.trim(), chatId });
      return;
    }

    const messageData = {
      text: message.trim(),
      senderId: currentUser?.uid,
      senderName: currentUser?.displayName || currentUser?.email || 'Unknown',
      timestamp: serverTimestamp(),
      status: 'sent', // sent -> delivered -> read
    };
    
    console.log('📤 Sending message to Firebase:', { messageData, chatId });
    
    try {
      // Add message to subcollection
      const messagesRef = collection(db, 'chats', chatId, 'messages');
      const docRef = await addDoc(messagesRef, messageData);
      console.log('✅ Message added to Firebase with ID:', docRef.id);
      
      // Update parent chat document with last message info and unread count
      const chatRef = doc(db, 'chats', chatId);
      
      // Get current chat to find other participants
      const chatDocRef = doc(db, 'chats', chatId);
      const chatDocSnap = await getDoc(chatDocRef);
      const chatData = chatDocSnap.data();
      const participants = chatData?.participants || [];
      
      // Increment unread count for all other participants
      const currentUnreadCount = chatData?.unreadCount || {};
      const updatedUnreadCount = { ...currentUnreadCount };
      
      participants.forEach(participantId => {
        if (participantId !== currentUser?.uid) {
          updatedUnreadCount[participantId] = (currentUnreadCount[participantId] || 0) + 1;
        }
      });
      
      await updateDoc(chatRef, {
        lastMessage: messageData.text,
        lastMessageTime: serverTimestamp(),
        unreadCount: updatedUnreadCount,
      });
      console.log('✅ Chat document updated with last message and unread count:', updatedUnreadCount);
      
      setMessage('');
      console.log('📤 Message sent successfully to Firebase:', messageData.text);
    } catch (error) {
      console.error('❌ Error sending message:', error);
      Alert.alert('Error', 'Failed to send message. Please try again.');
    }
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const renderMessage = ({ item }) => {
    const isMe = item.senderId === currentUser?.uid;
    
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
                  <Icon  name="checkmark" size={16} color="#8E9297"  />
                )}
                {item.status === 'delivered' && (
                  <View style={styles.doubleCheck}>
                    <Icon  name="checkmark" size={16} color="#8E9297" style={styles.check1}  />
                    <Icon  name="checkmark" size={16} color="#8E9297" style={styles.check2}  />
                  </View>
                )}
                {item.status === 'read' && (
                  <View style={styles.doubleCheck}>
                    <Icon  name="checkmark" size={16} color="#00D4AA" style={styles.check1}  />
                    <Icon  name="checkmark" size={16} color="#00D4AA" style={styles.check2}  />
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
          <Icon  name="arrow-back" size={24} color="#d1d5db"  />
        </TouchableOpacity>
        <BlypLogo useGradientBackground={true} />
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerActionButton}>
            <Icon  name="videocam" size={24} color="#d1d5db"  />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerActionButton}>
            <Icon  name="call" size={24} color="#d1d5db"  />
          </TouchableOpacity>
        </View>
      </View>
      
      <View style={styles.chatInfo}>
        <Image 
          source={{ uri: user.avatar || 'https://via.placeholder.com/50' }} 
          style={styles.participantAvatar} 
        />
        <View style={styles.participantInfo}>
          <Text style={styles.participantName}>{user.username || user.name || 'Unknown'}</Text>
          <Text style={styles.participantStatus}>Online • Last seen recently</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent={true} />
      <LinearGradient
        colors={['#0f172a', '#1e293b', '#334155']}
        style={styles.gradient}
      >
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
                <Icon  name="add" size={24} color="#8E9297"  />
              </TouchableOpacity>
              
              <TextInput
                style={styles.textInput}
                value={message}
                onChangeText={setMessage}
                placeholder="Type a message..."
                placeholderTextColor="#8E9297"
                multiline
                maxLength={1000}
                maxFontSizeMultiplier={1.5} // Control scaling globally
              />
              
              <TouchableOpacity style={styles.emojiButton}>
                <Icon  name="happy-outline" size={24} color="#8E9297"  />
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.cameraButton}>
                <Icon  name="camera" size={24} color="#8E9297"  />
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity 
              style={[styles.sendButton, message.trim() ? styles.sendButtonActive : null]}
              onPress={sendMessage}
              disabled={!message.trim()}
            >
              <LinearGradient
                colors={message.trim() ? ['#a855f7', '#d946ef', '#ec4899'] : ['#64748b', '#475569']}
                style={styles.sendButtonGradient}
              >
                <Icon  
                  name={message.trim() ? "send" : "mic"} 
                  size={20} 
                  color="#fff" 
                 />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  gradient: {
    flex: 1,
  },
  // Blyp Header Styles
  blypHeader: {
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    paddingTop: 50,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
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
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 2,
  },
  participantStatus: {
    color: '#10b981',
    fontSize: 14,
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
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  headerStatus: {
    color: '#8E9297',
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
    backgroundColor: '#a855f7',
    borderBottomRightRadius: 5,
  },
  otherBubble: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: '#334155',
  },
  messageText: {
    fontSize: 16,
    lineHeight: 20,
  },
  myMessageText: {
    color: '#fff',
  },
  otherMessageText: {
    color: '#fff',
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
    color: 'rgba(255, 255, 255, 0.7)',
  },
  otherMessageTime: {
    color: '#8E9297',
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
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 25,
    marginRight: 10,
    paddingHorizontal: 15,
    paddingVertical: 8,
    minHeight: 45,
    borderWidth: 1,
    borderColor: '#334155',
  },
  attachButton: {
    marginRight: 10,
    marginBottom: 2,
  },
  textInput: {
    flex: 1,
    color: '#fff',
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