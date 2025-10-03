import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  Alert,
  ScrollView,
  Switch,
  SafeAreaView,
  StatusBar,
  RefreshControl
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ChatRoomService from '../services/ChatRoomService';
import { auth } from '../config/firebase';

const ROOM_CATEGORIES = [
  { id: 'general', name: 'General', icon: 'chatbubbles-outline', color: '#3b82f6' },
  { id: 'gaming', name: 'Gaming', icon: 'game-controller-outline', color: '#8b5cf6' },
  { id: 'music', name: 'Music', icon: 'musical-notes-outline', color: '#ef4444' },
  { id: 'tech', name: 'Tech', icon: 'laptop-outline', color: '#06b6d4' },
  { id: 'sports', name: 'Sports', icon: 'basketball-outline', color: '#f59e0b' },
  { id: 'art', name: 'Art & Design', icon: 'brush-outline', color: '#ec4899' }
];

const ChatRoomsScreen = ({ navigation }) => {
  const [rooms, setRooms] = useState([]);
  const [userRooms, setUserRooms] = useState([]);
  const [activeRooms, setActiveRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  
  // Create room form state
  const [roomName, setRoomName] = useState('');
  const [roomDescription, setRoomDescription] = useState('');
  const [roomCategory, setRoomCategory] = useState('general');
  const [isPrivate, setIsPrivate] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState('50');
  const [roomPassword, setRoomPassword] = useState('');
  const [roomTags, setRoomTags] = useState('');
  const [creating, setCreating] = useState(false);

  const currentUser = auth.currentUser;

  useEffect(() => {
    if (currentUser) {
      loadRooms();
    }
  }, [currentUser, searchQuery, selectedCategory]);

  const loadRooms = () => {
    setLoading(true);

    // Subscribe to all available rooms
    const unsubscribeRooms = ChatRoomService.subscribeToAvailableRooms((availableRooms) => {
      let filteredRooms = availableRooms;

      // Apply search filter
      if (searchQuery.trim()) {
        filteredRooms = filteredRooms.filter(room => 
          room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          room.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          room.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
        );
      }

      // Apply category filter
      if (selectedCategory) {
        filteredRooms = filteredRooms.filter(room => room.category === selectedCategory);
      }

      setRooms(filteredRooms);
      setLoading(false);
    });

    // Subscribe to user's rooms
    const unsubscribeUserRooms = ChatRoomService.subscribeToUserRooms((myRooms) => {
      setUserRooms(myRooms);
      
      // Calculate active rooms (rooms with activity in last 24 hours)
      const activeRoomsFiltered = myRooms.filter(room => {
        const lastActivity = new Date(room.lastActivity);
        const hoursSinceActivity = (new Date() - lastActivity) / (1000 * 60 * 60);
        return hoursSinceActivity < 24;
      });
      setActiveRooms(activeRoomsFiltered);
    });

    return () => {
      unsubscribeRooms();
      unsubscribeUserRooms();
    };
  };

  const handleCreateRoom = async () => {
    if (!roomName.trim()) {
      Alert.alert('Error', 'Please enter a room name');
      return;
    }

    if (isPrivate && !roomPassword.trim()) {
      Alert.alert('Error', 'Private rooms require a password');
      return;
    }

    setCreating(true);
    try {
      const roomData = {
        name: roomName.trim(),
        description: roomDescription.trim(),
        category: roomCategory,
        isPrivate,
        maxParticipants: parseInt(maxParticipants) || 50,
        password: isPrivate ? roomPassword.trim() : null,
        tags: roomTags.split(',').map(tag => tag.trim()).filter(tag => tag)
      };

      const roomId = await ChatRoomService.createChatRoom(roomData);
      
      Alert.alert('Success', 'Room created successfully!', [
        { text: 'OK', onPress: () => {
          setShowCreateModal(false);
          resetForm();
          navigation.navigate('ChatRoom', { roomId });
        }}
      ]);
    } catch (error) {
      Alert.alert('Error', error.message);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinRoom = async (room) => {
    try {
      if (room.isPrivate && room.password) {
        Alert.prompt(
          'Private Room',
          `Enter password for "${room.name}"`,
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Join', 
              onPress: async (password) => {
                try {
                  await ChatRoomService.joinRoom(room.id, password);
                  navigation.navigate('ChatRoom', { roomId: room.id });
                } catch (error) {
                  Alert.alert('Error', error.message);
                }
              }
            }
          ],
          'secure-text'
        );
      } else {
        await ChatRoomService.joinRoom(room.id);
        navigation.navigate('ChatRoom', { roomId: room.id });
      }
    } catch (error) {
      Alert.alert('Error', error.message);
    }
  };

  const resetForm = () => {
    setRoomName('');
    setRoomDescription('');
    setRoomCategory('general');
    setIsPrivate(false);
    setMaxParticipants('50');
    setRoomPassword('');
    setRoomTags('');
  };

  const formatTimestamp = (timestamp) => {
    const now = new Date();
    const date = new Date(timestamp);
    const diffInHours = (now - date) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor((now - date) / (1000 * 60));
      return diffInMinutes < 1 ? 'now' : `${diffInMinutes}m ago`;
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)}h ago`;
    } else {
      const diffInDays = Math.floor(diffInHours / 24);
      return `${diffInDays}d ago`;
    }
  };

  const renderRoomItem = ({ item: room }) => {
    const category = ROOM_CATEGORIES.find(cat => cat.id === room.category) || ROOM_CATEGORIES[0];
    const isUserRoom = room.participants.includes(currentUser?.uid);
    const canJoin = !isUserRoom && room.participantCount < room.maxParticipants;

    return (
      <TouchableOpacity
        style={styles.roomCard}
        onPress={() => {
          if (isUserRoom) {
            navigation.navigate('ChatRoom', { roomId: room.id });
          } else if (canJoin) {
            handleJoinRoom(room);
          }
        }}
      >
        <LinearGradient
          colors={[category.color, `${category.color}90`]}
          style={styles.roomCardGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.roomHeader}>
            <View style={styles.roomInfo}>
              <View style={[styles.categoryIcon, { backgroundColor: category.color }]}>
                <Ionicons name={category.icon} size={20} color="#fff" />
              </View>
              <View style={styles.roomDetails}>
                <View style={styles.roomTitleRow}>
                  <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
                  {room.isPrivate && <Ionicons name="lock-closed" size={16} color="#f59e0b" />}
                </View>
                <Text style={styles.roomDescription} numberOfLines={2}>
                  {room.description || 'No description'}
                </Text>
                <View style={styles.roomMeta}>
                  <Text style={styles.categoryText}>{category.name}</Text>
                  <Text style={styles.participantCount}>
                    {room.participantCount}/{room.maxParticipants} members
                  </Text>
                </View>
              </View>
            </View>
            
            <View style={styles.roomActions}>
              {isUserRoom ? (
                <View style={[styles.statusBadge, styles.joinedBadge]}>
                  <Ionicons name="checkmark" size={16} color="#10b981" />
                  <Text style={styles.joinedText}>Joined</Text>
                </View>
              ) : canJoin ? (
                <TouchableOpacity style={[styles.statusBadge, styles.joinBadge]}>
                  <Ionicons name="add" size={16} color="#3b82f6" />
                  <Text style={styles.joinText}>Join</Text>
                </TouchableOpacity>
              ) : (
                <View style={[styles.statusBadge, styles.fullBadge]}>
                  <Text style={styles.fullText}>Full</Text>
                </View>
              )}
            </View>
          </View>

          {room.lastMessage && (
            <View style={styles.lastMessage}>
              <Text style={styles.lastMessageText} numberOfLines={1}>
                {room.lastMessage.senderName}: {room.lastMessage.text}
              </Text>
              <Text style={styles.lastMessageTime}>
                {formatTimestamp(room.lastActivity)}
              </Text>
            </View>
          )}

          {room.tags.length > 0 && (
            <View style={styles.tagsContainer}>
              {room.tags.slice(0, 3).map((tag, index) => (
                <View key={index} style={styles.tag}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
              {room.tags.length > 3 && (
                <Text style={styles.moreTags}>+{room.tags.length - 3}</Text>
              )}
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderCategoryFilter = () => (
    <ScrollView 
      horizontal 
      showsHorizontalScrollIndicator={false}
      style={styles.categoryFilter}
      contentContainerStyle={styles.categoryFilterContent}
    >
      <TouchableOpacity
        style={[
          styles.categoryChip,
          !selectedCategory && styles.categoryChipActive
        ]}
        onPress={() => setSelectedCategory(null)}
      >
        <Text style={[
          styles.categoryChipText,
          !selectedCategory && styles.categoryChipTextActive
        ]}>All</Text>
      </TouchableOpacity>
      
      {ROOM_CATEGORIES.map((category) => (
        <TouchableOpacity
          key={category.id}
          style={[
            styles.categoryChip,
            selectedCategory === category.id && styles.categoryChipActive
          ]}
          onPress={() => setSelectedCategory(
            selectedCategory === category.id ? null : category.id
          )}
        >
          <Ionicons 
            name={category.icon} 
            size={16} 
            color={selectedCategory === category.id ? '#fff' : category.color} 
          />
          <Text style={[
            styles.categoryChipText,
            selectedCategory === category.id && styles.categoryChipTextActive
          ]}>
            {category.name}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderSectionHeader = (title, icon, count = null) => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <Ionicons name={icon} size={24} color="#a855f7" />
        <Text style={styles.sectionTitle}>{title}</Text>
        {count !== null && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{count}</Text>
          </View>
        )}
      </View>
    </View>
  );

  const renderRoomSection = (data, emptyTitle, emptyText, emptyIcon) => {
    if (data.length === 0) {
      return (
        <View style={styles.emptySection}>
          <Ionicons name={emptyIcon} size={48} color="#374151" />
          <Text style={styles.emptySectionTitle}>{emptyTitle}</Text>
          <Text style={styles.emptySectionText}>{emptyText}</Text>
        </View>
      );
    }

    return data.map((room) => (
      <View key={room.id}>
        {renderRoomItem({ item: room })}
      </View>
    ));
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>💬 Chat Rooms</Text>
        <Text style={styles.headerSubtitle}>Connect and chat with people worldwide</Text>
        
        <TouchableOpacity 
          style={styles.createButton}
          onPress={() => setShowCreateModal(true)}
        >
          <LinearGradient colors={['#a855f7', '#d946ef']} style={styles.createButtonGradient}>
            <Ionicons name="add" size={24} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#6b7280" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search rooms..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Main Content - Vertical Scroll */}
      <ScrollView 
        style={styles.mainContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl 
            refreshing={loading}
            onRefresh={loadRooms}
            tintColor="#a855f7"
            colors={['#a855f7']}
          />
        }
      >
        {/* Category Filter */}
        {renderCategoryFilter()}

        {/* Active Rooms Section */}
        {renderSectionHeader('Active Rooms', 'pulse-outline', activeRooms.length)}
        {renderRoomSection(
          activeRooms,
          'No active rooms',
          'Rooms with recent activity will appear here',
          'pulse-outline'
        )}

        {/* My Rooms Section */}
        {renderSectionHeader('My Rooms', 'chatbubbles-outline', userRooms.length)}
        {renderRoomSection(
          userRooms,
          'No rooms yet',
          'Join some rooms or create your own to get started',
          'chatbubbles-outline'
        )}

        {/* Browse All Rooms Section */}
        {renderSectionHeader('Browse Rooms', 'search-outline', rooms.length)}
        {renderRoomSection(
          rooms,
          'No rooms found',
          'Try adjusting your search or create a new room',
          'search-outline'
        )}

        {/* Bottom padding for better scrolling */}
        <View style={styles.bottomPadding} />
      </ScrollView>

      {/* Create Room Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowCreateModal(false)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Create Room</Text>
            <TouchableOpacity 
              onPress={handleCreateRoom}
              disabled={creating}
            >
              <Text style={[styles.modalCreate, creating && styles.modalCreateDisabled]}>
                {creating ? 'Creating...' : 'Create'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Room Name *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Enter room name"
                value={roomName}
                onChangeText={setRoomName}
                maxLength={50}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Description</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea]}
                placeholder="Describe your room"
                value={roomDescription}
                onChangeText={setRoomDescription}
                maxLength={200}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {ROOM_CATEGORIES.map((category) => (
                  <TouchableOpacity
                    key={category.id}
                    style={[
                      styles.categoryOption,
                      roomCategory === category.id && styles.categoryOptionActive
                    ]}
                    onPress={() => setRoomCategory(category.id)}
                  >
                    <Ionicons 
                      name={category.icon} 
                      size={20} 
                      color={roomCategory === category.id ? '#fff' : category.color} 
                    />
                    <Text style={[
                      styles.categoryOptionText,
                      roomCategory === category.id && styles.categoryOptionTextActive
                    ]}>
                      {category.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.formGroup}>
              <View style={styles.switchRow}>
                <Text style={styles.formLabel}>Private Room</Text>
                <Switch
                  value={isPrivate}
                  onValueChange={setIsPrivate}
                  trackColor={{ false: '#374151', true: '#a855f7' }}
                  thumbColor="#fff"
                />
              </View>
              {isPrivate && (
                <TextInput
                  style={styles.formInput}
                  placeholder="Room password"
                  value={roomPassword}
                  onChangeText={setRoomPassword}
                  secureTextEntry
                />
              )}
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Max Participants</Text>
              <TextInput
                style={styles.formInput}
                placeholder="50"
                value={maxParticipants}
                onChangeText={setMaxParticipants}
                keyboardType="numeric"
                maxLength={3}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Tags (comma separated)</Text>
              <TextInput
                style={styles.formInput}
                placeholder="fun, casual, friendly"
                value={roomTags}
                onChangeText={setRoomTags}
                maxLength={100}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    padding: 20,
    paddingTop: StatusBar.currentHeight + 20,
    backgroundColor: '#000',
  },
  backButton: {
    position: 'absolute',
    top: StatusBar.currentHeight + 20,
    left: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 20,
  },
  createButton: {
    position: 'absolute',
    top: StatusBar.currentHeight + 20,
    right: 20,
    zIndex: 10,
    borderRadius: 20,
    overflow: 'hidden',
  },
  createButtonGradient: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: '#000',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
  },
  mainContent: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#000',
    marginTop: 20,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  countBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#a855f7',
  },
  countText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#a855f7',
  },
  emptySection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 40,
    marginHorizontal: 20,
    marginVertical: 8,
    backgroundColor: '#1f2937',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
  },
  emptySectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 12,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySectionText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
  },
  bottomPadding: {
    height: 100,
  },
  categoryFilter: {
    backgroundColor: '#000',
    paddingBottom: 8,
  },
  categoryFilterContent: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: '#374151',
  },
  categoryChipActive: {
    backgroundColor: 'transparent',
    borderColor: '#a855f7',
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
  },
  categoryChipTextActive: {
    color: '#a855f7',
  },
  roomsList: {
    paddingHorizontal: 10,
    paddingBottom: 20,
  },
  roomCard: {
    marginHorizontal: 10,
    marginVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  roomCardGradient: {
    padding: 20,
    backgroundColor: '#1f2937',
  },
  roomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  roomInfo: {
    flex: 1,
    flexDirection: 'row',
    gap: 16,
  },
  categoryIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roomDetails: {
    flex: 1,
  },
  roomTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  roomName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
  },
  roomDescription: {
    fontSize: 14,
    color: '#ffffff90',
    marginBottom: 12,
    lineHeight: 20,
  },
  roomMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  categoryText: {
    fontSize: 12,
    color: '#ffffff70',
    fontWeight: '600',
  },
  participantCount: {
    fontSize: 12,
    color: '#ffffff70',
    fontWeight: '600',
  },
  roomActions: {
    marginLeft: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  joinedBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10b981',
  },
  joinBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  fullBadge: {
    backgroundColor: 'rgba(156, 163, 175, 0.2)',
    borderWidth: 1,
    borderColor: '#9ca3af',
  },
  joinedText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#10b981',
  },
  joinText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#3b82f6',
  },
  fullText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#9ca3af',
  },
  lastMessage: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    marginTop: 12,
  },
  lastMessageText: {
    fontSize: 12,
    color: '#ffffff70',
    flex: 1,
    marginRight: 8,
  },
  lastMessageTime: {
    fontSize: 12,
    color: '#ffffff50',
  },
  tagsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 8,
  },
  tag: {
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  tagText: {
    fontSize: 10,
    color: '#a855f7',
    fontWeight: 'bold',
  },
  moreTags: {
    fontSize: 10,
    color: '#ffffff70',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 40,
  },
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 24,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: StatusBar.currentHeight + 16,
    backgroundColor: '#000',
  },
  modalCancel: {
    fontSize: 16,
    color: '#9ca3af',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  modalCreate: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#a855f7',
  },
  modalCreateDisabled: {
    opacity: 0.5,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  formGroup: {
    marginBottom: 28,
  },
  formLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  formInput: {
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    fontSize: 16,
    color: '#fff',
  },
  formTextArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
    marginRight: 12,
    gap: 8,
  },
  categoryOptionActive: {
    backgroundColor: 'transparent',
    borderColor: '#a855f7',
  },
  categoryOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  categoryOptionTextActive: {
    color: '#a855f7',
  },
});

export default ChatRoomsScreen;