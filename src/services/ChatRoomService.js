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
import { auth, firestore as db } from '../config/firebase';

async function sha256Hex(input) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  try {
    // Optional fallback when SubtleCrypto is unavailable.
    // eslint-disable-next-line global-require
    const ExpoCrypto = require('expo-crypto');
    return ExpoCrypto.digestStringAsync(
      ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      input
    );
  } catch {
    throw new Error('Password hashing unavailable on this runtime');
  }
}

async function hashRoomPassword({ createdBy, name, password }) {
  return sha256Hex(`blyp-room-v1:${createdBy}:${String(name || '').trim()}:${password}`);
}

function publicRoomView(id, data) {
  const { password, passwordHash, ...rest } = data || {};
  return {
    id,
    ...rest,
    isPasswordProtected: !!(passwordHash || password),
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
    lastActivity: data.lastActivity?.toDate?.() || new Date(),
  };
}

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
      const isPrivate = !!roomData.isPrivate;
      const plainPassword = isPrivate ? String(roomData.password || '').trim() : '';
      if (isPrivate && !plainPassword) {
        throw new Error('Private rooms require a password');
      }

      const roomDoc = {
        name: roomData.name,
        description: roomData.description || '',
        category: roomData.category || 'general',
        isPrivate,
        maxParticipants: roomData.maxParticipants || 50,
        // Never persist plaintext passwords.
        passwordHash: plainPassword
          ? await hashRoomPassword({
              createdBy: this.currentUser.uid,
              name: roomData.name,
              password: plainPassword,
            })
          : null,
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
        ambassadors: [],
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
      snapshot.forEach((snap) => {
        const data = snap.data();
        // Include public rooms or rooms user is a participant in
        if (!data.isPrivate || data.participants.includes(this.currentUser.uid)) {
          rooms.push(publicRoomView(snap.id, data));
        }
      });

      // Sort occupancy-first (people before empty), then recent activity.
      rooms.sort((a, b) => {
        const ac = Number(a.participantCount) || 0;
        const bc = Number(b.participantCount) || 0;
        if (ac > 0 && bc === 0) return -1;
        if (ac === 0 && bc > 0) return 1;
        if (bc !== ac) return bc - ac;
        return b.lastActivity - a.lastActivity;
      });
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
      snapshot.forEach((snap) => {
        rooms.push(publicRoomView(snap.id, snap.data()));
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

      // Check if room is private and requires password (hashed; legacy plaintext tolerated once).
      if (roomData.isPrivate && (roomData.passwordHash || roomData.password)) {
        const candidate = String(password || '');
        let ok = false;
        if (roomData.passwordHash) {
          const hashed = await hashRoomPassword({
            createdBy: roomData.createdBy,
            name: roomData.name,
            password: candidate,
          });
          ok = hashed === roomData.passwordHash;
        } else if (roomData.password) {
          ok = roomData.password === candidate;
        }
        if (!ok) {
          throw new Error('Incorrect password');
        }
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

  /** Opt-in page ambassador — helps grow empty/low rooms (share + welcome). */
  async claimAmbassador(roomId) {
    if (!this.currentUser) throw new Error('User not authenticated');

    const roomRef = doc(db, 'chatRooms', roomId);
    const roomDoc = await getDoc(roomRef);
    if (!roomDoc.exists()) throw new Error('Room not found');

    const data = roomDoc.data() || {};
    const list = Array.isArray(data.ambassadors) ? data.ambassadors : [];
    if (list.some((a) => a?.uid === this.currentUser.uid || a === this.currentUser.uid)) {
      return { alreadyAmbassador: true, ambassadors: list };
    }
    if (list.length >= 5) {
      throw new Error('Ambassador slots full');
    }

    // Ensure membership so firestore rules allow the update.
    if (!Array.isArray(data.participants) || !data.participants.includes(this.currentUser.uid)) {
      await updateDoc(roomRef, {
        participants: arrayUnion(this.currentUser.uid),
        participantCount: increment(1),
        lastActivity: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const entry = {
      uid: this.currentUser.uid,
      displayName: this.currentUser.displayName || 'Anonymous',
      claimedAt: Date.now(),
    };
    await updateDoc(roomRef, {
      ambassadors: arrayUnion(entry),
      updatedAt: serverTimestamp(),
      lastActivity: serverTimestamp(),
    });

    await this.sendMessage(roomId, {
      text: `${this.currentUser.displayName || 'Someone'} became a page ambassador`,
      type: 'system',
    }).catch(() => {});

    return { alreadyAmbassador: false, ambassadors: [...list, entry] };
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

      return publicRoomView(roomDoc.id, roomDoc.data());
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
      
      snapshot.forEach((snap) => {
        const room = publicRoomView(snap.id, snap.data());

        // Filter by search term
        const matchesSearch = !searchTerm || 
          room.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (room.description || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (room.tags || []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));

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