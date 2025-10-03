import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  getDocs, 
  getDoc,
  query, 
  where, 
  orderBy, 
  limit,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  increment
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';

class ChatRoomService {
  constructor() {
    this.currentUser = null;
    
    // Listen to auth state changes
    auth.onAuthStateChanged((user) => {
      this.currentUser = user;
    });
  }

  // Create a new chat room
  async createChatRoom(roomData) {
    if (!this.currentUser) throw new Error('User not authenticated');

    try {
      const roomDoc = {
        name: roomData.name,
        description: roomData.description || '',
        category: roomData.category || 'general',
        isPrivate: roomData.isPrivate || false,
        maxParticipants: roomData.maxParticipants || 50,
        password: roomData.password || null,
        createdBy: this.currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        participants: [this.currentUser.uid],
        participantCount: 1,
        lastMessage: null,
        lastActivity: serverTimestamp(),
        isActive: true,
        tags: roomData.tags || [],
        rules: roomData.rules || [],
        hostInfo: {
          uid: this.currentUser.uid,
          displayName: this.currentUser.displayName || 'Anonymous',
          photoURL: this.currentUser.photoURL || null
        }
      };

      const docRef = await addDoc(collection(db, 'chatRooms'), roomDoc);
      
      // Create initial system message
      await this.sendMessage(docRef.id, {
        text: `Welcome to ${roomData.name}! 🎉`,
        type: 'system'
      });

      return docRef.id;
    } catch (error) {
      console.error('Error creating chat room:', error);
      throw error;
    }
  }

  // Get available chat rooms (public + rooms user is member of)
  subscribeToAvailableRooms(callback) {
    if (!this.currentUser) {
      callback([]);
      return () => {};
    }

    // Get all public rooms and private rooms user is part of
    const q = query(
      collection(db, 'chatRooms'),
      where('isActive', '==', true)
    );

    return onSnapshot(q, (snapshot) => {
      const rooms = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        // Include public rooms or rooms user is a participant in
        if (!data.isPrivate || data.participants.includes(this.currentUser.uid)) {
          rooms.push({
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
            lastActivity: data.lastActivity?.toDate?.() || new Date()
          });
        }
      });

      // Sort by last activity (most recent first)
      rooms.sort((a, b) => b.lastActivity - a.lastActivity);
      callback(rooms);
    }, (error) => {
      console.error('Error subscribing to rooms:', error);
      callback([]);
    });
  }

  // Get rooms user has joined
  subscribeToUserRooms(callback) {
    if (!this.currentUser) {
      callback([]);
      return () => {};
    }

    const q = query(
      collection(db, 'chatRooms'),
      where('participants', 'array-contains', this.currentUser.uid),
      where('isActive', '==', true)
    );

    return onSnapshot(q, (snapshot) => {
      const rooms = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        rooms.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || new Date(),
          updatedAt: data.updatedAt?.toDate?.() || new Date(),
          lastActivity: data.lastActivity?.toDate?.() || new Date()
        });
      });

      // Sort by last activity
      rooms.sort((a, b) => b.lastActivity - a.lastActivity);
      callback(rooms);
    }, (error) => {
      console.error('Error subscribing to user rooms:', error);
      callback([]);
    });
  }

  // Join a chat room
  async joinRoom(roomId, password = null) {
    if (!this.currentUser) throw new Error('User not authenticated');

    try {
      const roomRef = doc(db, 'chatRooms', roomId);
      const roomDoc = await getDoc(roomRef);
      
      if (!roomDoc.exists()) {
        throw new Error('Room not found');
      }

      const roomData = roomDoc.data();

      // Check if room is private and requires password
      if (roomData.isPrivate && roomData.password && roomData.password !== password) {
        throw new Error('Incorrect password');
      }

      // Check if room is full
      if (roomData.participantCount >= roomData.maxParticipants) {
        throw new Error('Room is full');
      }

      // Check if user is already a participant
      if (roomData.participants.includes(this.currentUser.uid)) {
        return; // Already joined
      }

      // Add user to participants
      await updateDoc(roomRef, {
        participants: arrayUnion(this.currentUser.uid),
        participantCount: increment(1),
        lastActivity: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Send join message
      await this.sendMessage(roomId, {
        text: `${this.currentUser.displayName || 'Someone'} joined the room`,
        type: 'system'
      });

      return true;
    } catch (error) {
      console.error('Error joining room:', error);
      throw error;
    }
  }

  // Leave a chat room
  async leaveRoom(roomId) {
    if (!this.currentUser) throw new Error('User not authenticated');

    try {
      const roomRef = doc(db, 'chatRooms', roomId);
      const roomDoc = await getDoc(roomRef);
      
      if (!roomDoc.exists()) {
        throw new Error('Room not found');
      }

      const roomData = roomDoc.data();

      // Remove user from participants
      await updateDoc(roomRef, {
        participants: arrayRemove(this.currentUser.uid),
        participantCount: increment(-1),
        lastActivity: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Send leave message
      await this.sendMessage(roomId, {
        text: `${this.currentUser.displayName || 'Someone'} left the room`,
        type: 'system'
      });

      // If room is empty and not the host, deactivate it
      if (roomData.participantCount <= 1 && roomData.createdBy === this.currentUser.uid) {
        await updateDoc(roomRef, {
          isActive: false
        });
      }

      return true;
    } catch (error) {
      console.error('Error leaving room:', error);
      throw error;
    }
  }

  // Send a message to a chat room
  async sendMessage(roomId, messageData) {
    if (!this.currentUser) throw new Error('User not authenticated');

    try {
      const message = {
        text: messageData.text,
        type: messageData.type || 'text',
        senderId: this.currentUser.uid,
        senderName: this.currentUser.displayName || 'Anonymous',
        senderPhoto: this.currentUser.photoURL || null,
        roomId: roomId,
        timestamp: serverTimestamp(),
        edited: false,
        reactions: {},
        replyTo: messageData.replyTo || null
      };

      // Add media fields if present
      if (messageData.imageUrl) message.imageUrl = messageData.imageUrl;
      if (messageData.videoUrl) message.videoUrl = messageData.videoUrl;
      if (messageData.audioUrl) message.audioUrl = messageData.audioUrl;

      const messageRef = await addDoc(collection(db, 'chatMessages'), message);

      // Update room's last message and activity
      const roomRef = doc(db, 'chatRooms', roomId);
      await updateDoc(roomRef, {
        lastMessage: {
          id: messageRef.id,
          text: messageData.text,
          senderId: this.currentUser.uid,
          senderName: this.currentUser.displayName || 'Anonymous',
          timestamp: serverTimestamp(),
          type: messageData.type || 'text'
        },
        lastActivity: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return messageRef.id;
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  }

  // Subscribe to messages in a chat room
  subscribeToRoomMessages(roomId, callback) {
    const q = query(
      collection(db, 'chatMessages'),
      where('roomId', '==', roomId),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    return onSnapshot(q, (snapshot) => {
      const messages = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        messages.push({
          id: doc.id,
          ...data,
          timestamp: data.timestamp?.toDate?.() || new Date()
        });
      });

      // Reverse to get chronological order (oldest first)
      messages.reverse();
      callback(messages);
    }, (error) => {
      console.error('Error subscribing to messages:', error);
      callback([]);
    });
  }

  // Get room details
  async getRoomDetails(roomId) {
    try {
      const roomDoc = await getDoc(doc(db, 'chatRooms', roomId));
      if (!roomDoc.exists()) {
        throw new Error('Room not found');
      }

      const data = roomDoc.data();
      return {
        id: roomDoc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || new Date(),
        updatedAt: data.updatedAt?.toDate?.() || new Date(),
        lastActivity: data.lastActivity?.toDate?.() || new Date()
      };
    } catch (error) {
      console.error('Error getting room details:', error);
      throw error;
    }
  }

  // Delete a chat room (only for room creator)
  async deleteRoom(roomId) {
    if (!this.currentUser) throw new Error('User not authenticated');

    try {
      const roomDoc = await getDoc(doc(db, 'chatRooms', roomId));
      if (!roomDoc.exists()) {
        throw new Error('Room not found');
      }

      const roomData = roomDoc.data();
      if (roomData.createdBy !== this.currentUser.uid) {
        throw new Error('Only room creator can delete the room');
      }

      // Mark room as inactive instead of deleting
      await updateDoc(doc(db, 'chatRooms', roomId), {
        isActive: false,
        updatedAt: serverTimestamp()
      });

      return true;
    } catch (error) {
      console.error('Error deleting room:', error);
      throw error;
    }
  }

  // Search chat rooms
  async searchRooms(searchTerm, category = null) {
    try {
      let q = query(
        collection(db, 'chatRooms'),
        where('isActive', '==', true),
        where('isPrivate', '==', false)
      );

      const snapshot = await getDocs(q);
      const rooms = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data();
        const room = {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.() || new Date(),
          updatedAt: data.updatedAt?.toDate?.() || new Date(),
          lastActivity: data.lastActivity?.toDate?.() || new Date()
        };

        // Filter by search term
        const matchesSearch = !searchTerm || 
          room.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          room.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
          room.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));

        // Filter by category
        const matchesCategory = !category || room.category === category;

        if (matchesSearch && matchesCategory) {
          rooms.push(room);
        }
      });

      // Sort by participant count and last activity
      rooms.sort((a, b) => {
        if (a.participantCount !== b.participantCount) {
          return b.participantCount - a.participantCount;
        }
        return b.lastActivity - a.lastActivity;
      });

      return rooms;
    } catch (error) {
      console.error('Error searching rooms:', error);
      return [];
    }
  }
}

export default new ChatRoomService();