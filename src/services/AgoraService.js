import { db, auth } from '../config/firebase';

class AgoraService {
  constructor() {
    this.localStream = null;
    this.remoteStreams = new Map();
    this.peerConnections = new Map();
    this.isInitialized = false;
    this.channelId = null;
  this.userId = (auth().currentUser || auth.currentUser)?.uid || null;
    this.signalCollection = 'webrtc_signals';
    this.streamsCollection = 'streams';
    this.unsubscribeSignal = null;
    this.lastConnectionAttempt = null;
    this._webrtc = null; // Lazy-loaded react-native-webrtc module
    
    // Event listeners
    this.eventListeners = {
      onRemoteStream: null,
      onUserLeft: null
    };
  }

  // Lazy import react-native-webrtc only when needed to avoid static dep and missing dep warnings
  async ensureWebRTC() {
    if (this._webrtc) return this._webrtc;
    try {
      // Dynamic import so that Expo projects without Dev Client don't fail static analysis
      const pkg = 'react-native-' + 'webrtc';
      const mod = await import(pkg);
      this._webrtc = mod;
      return this._webrtc;
    } catch (e) {
      console.warn('react-native-webrtc not available in this runtime:', e?.message || e);
      this._webrtc = null;
      return null;
    }
  }

  async init() {
    try {
      console.log("🔄 WebRTC initialized");
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error("❌ WebRTC initialization error:", error);
      return false;
    }
  }

  async getLocalStream() {
    try {
      const rtc = await this.ensureWebRTC();
      if (!rtc || !rtc.mediaDevices) throw new Error('WebRTC mediaDevices unavailable');
      const stream = await rtc.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      this.localStream = stream;
      return stream;
    } catch (error) {
      console.error("❌ Error getting local stream:", error);
      return null;
    }
  }

  async joinChannelAsBroadcaster(channelId) {
    try {
      this.channelId = channelId;
      
      // Get local media stream
      const stream = await this.getLocalStream();
      if (!stream) {
        console.error(" Failed to get local stream");
        return false;
      }
      
      // Set up signaling
      await this.setupSignaling();
      
      // Add broadcaster to the channel
      await this.addUserToChannel('broadcaster');
      
      console.log(" Joined as broadcaster:", channelId);
      return true;
    } catch (error) {
      console.error(" Error joining as broadcaster:", error);
      return false;
    }
  }

  async joinChannelAsAudience(channelId) {
    try {
      this.channelId = channelId;
      
      // Set up signaling
      await this.setupSignaling();
      
      // Add audience member to the channel
      await this.addUserToChannel('audience');
      
      // Find broadcaster and connect
      const channelDoc = await db.collection(this.streamsCollection).doc(channelId).get();
      if (channelDoc.exists) {
        const channelData = channelDoc.data();
        if (channelData.broadcaster) {
          console.log(" Connecting to broadcaster:", channelData.broadcaster);
          await this.createPeerConnection(channelData.broadcaster);
          await this.createOffer(channelData.broadcaster);
        }
      }
      
      console.log(" Joined as viewer:", channelId);
      return true;
    } catch (error) {
      console.error(" Error joining as audience:", error);
      return false;
    }
  }

  async leaveChannel() {
    try {
      // Stop local stream
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => track.stop());
        this.localStream = null;
      }
      
      // Close peer connections
      this.peerConnections.forEach((pc) => pc.close());
      this.peerConnections.clear();
      this.remoteStreams.clear();
      
      // Clean up signaling
      if (this.unsubscribeSignal) {
        this.unsubscribeSignal();
        this.unsubscribeSignal = null;
      }
      
      // Remove user from channel
      if (this.channelId && this.userId) {
        try {
          await deleteDoc(doc(db, this.streamsCollection, this.channelId, 'participants', this.userId));
        } catch (e) {
          console.warn(" Failed to remove participant from channel", e);
        }
      }
      
      this.channelId = null;
      
      console.log(" Left channel successfully");
      return true;
    } catch (error) {
      console.error(" Error leaving channel:", error);
      return false;
    }
  }

  getLocalVideoStream() {
    return this.localStream;
  }
  
  /**
   * Set up WebRTC signaling
   */
  async setupSignaling() {
    if (this.unsubscribeSignal) {
      this.unsubscribeSignal();
    }
    
    if (!this.userId || !this.channelId) {
      console.error(" Missing userId or channelId for signaling");
      return;
    }
    
    console.log(" Setting up WebRTC signaling...");
    
    // Listen for signaling messages
    const q = db.collection(this.signalCollection)
      .where('targetId', '==', this.userId)
      .where('channelId', '==', this.channelId);
    
    this.unsubscribeSignal = q.onSnapshot((snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          console.log(` Received ${data.type} signal from ${data.fromId}`);
          
          // Process the signaling message
          await this.handleSignal(data);
          
          // Delete the processed signal
          try {
            await change.doc.ref.delete();
          } catch (e) {
            console.warn(' Failed to delete processed signal', e);
          }
        }
      });
    });
  }
  
  /**
   * Add user to channel participants
   */
  async addUserToChannel(role) {
    if (!this.userId || !this.channelId) return;
    
    const userRef = db.collection(this.streamsCollection).doc(this.channelId).collection('participants').doc(this.userId);
    
    await userRef.set({
      userId: this.userId,
      role,
      joinedAt: new Date().toISOString()
    });
    
    // If broadcaster, update the stream document
    if (role === 'broadcaster') {
      await db.collection(this.streamsCollection).doc(this.channelId).update({
        broadcaster: this.userId
      });
    }
  }
  
  /**
   * Create a peer connection to another user
   */
  async createPeerConnection(remoteUserId) {
    if (this.peerConnections.has(remoteUserId)) {
      console.log(` Peer connection to ${remoteUserId} already exists`);
      return this.peerConnections.get(remoteUserId);
    }
    
    try {
      // Create new peer connection
      const rtc = await this.ensureWebRTC();
      if (!rtc || !rtc.RTCPeerConnection) throw new Error('WebRTC RTCPeerConnection unavailable');
      const pc = new rtc.RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
      
      // Add local stream to connection if available
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          pc.addTrack(track, this.localStream);
        });
      }
      
      // Handle ICE candidates
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          this.sendSignal(remoteUserId, 'ice-candidate', { candidate });
        }
      };
      
      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        console.log(` Connection state: ${pc.connectionState} with ${remoteUserId}`);
        
        // Handle connection state changes
        this.handleConnectionStateChange(pc, remoteUserId);
      };
      
      // Handle remote stream
      pc.ontrack = (event) => {
        console.log(` Received remote track from ${remoteUserId}`);
        if (event.streams && event.streams[0]) {
          this.remoteStreams.set(remoteUserId, event.streams[0]);
          
          // Notify listeners about the new remote stream
          if (this.eventListeners.onRemoteStream) {
            this.eventListeners.onRemoteStream(remoteUserId, event.streams[0]);
          }
        }
      };
      
      this.peerConnections.set(remoteUserId, pc);
      return pc;
    } catch (error) {
      console.error(' Error creating peer connection:', error);
      return null;
    }
  }
  
  /**
   * Create and send offer to remote peer
   */
  async createOffer(remoteUserId) {
    try {
      let pc = this.peerConnections.get(remoteUserId);
      if (!pc) {
        pc = await this.createPeerConnection(remoteUserId);
      }
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      this.sendSignal(remoteUserId, 'offer', {
        sdp: pc.localDescription
      });
    } catch (error) {
      console.error(' Error creating offer:', error);
    }
  }
  
  /**
   * Send a signaling message to another user
   */
  async sendSignal(targetId, type, payload) {
    try {
      await db.collection(this.signalCollection).add({
        channelId: this.channelId,
        fromId: this.userId,
        targetId,
        type,
        payload,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(' Error sending signal:', error);
    }
  }
  
  /**
   * Handle incoming signal
   */
  async handleSignal(data) {
    const { fromId, type, payload } = data;
    
    switch (type) {
      case 'offer':
        await this.handleOffer(fromId, payload.sdp);
        break;
      case 'answer':
        await this.handleAnswer(fromId, payload.sdp);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(fromId, payload.candidate);
        break;
      default:
        console.warn(` Unknown signal type: ${type}`);
    }
  }
  
  /**
   * Handle an offer from a remote peer
   */
  async handleOffer(fromId, sdp) {
    try {
      let pc = this.peerConnections.get(fromId);
      if (!pc) {
        pc = await this.createPeerConnection(fromId);
      }
      
      const rtc = await this.ensureWebRTC();
      if (!rtc || !rtc.RTCSessionDescription) throw new Error('WebRTC RTCSessionDescription unavailable');
      await pc.setRemoteDescription(new rtc.RTCSessionDescription(sdp));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      this.sendSignal(fromId, 'answer', {
        sdp: pc.localDescription
      });
    } catch (error) {
      console.error(' Error handling offer:', error);
    }
  }
  
  /**
   * Handle an answer from a remote peer
   */
  async handleAnswer(fromId, sdp) {
    try {
      const pc = this.peerConnections.get(fromId);
      if (pc) {
        const rtc = await this.ensureWebRTC();
        if (!rtc || !rtc.RTCSessionDescription) throw new Error('WebRTC RTCSessionDescription unavailable');
        await pc.setRemoteDescription(new rtc.RTCSessionDescription(sdp));
      }
    } catch (error) {
      console.error(' Error handling answer:', error);
    }
  }
  
  /**
   * Handle an ICE candidate from a remote peer
   */
  async handleIceCandidate(fromId, candidate) {
    try {
      const pc = this.peerConnections.get(fromId);
      if (pc) {
        const rtc = await this.ensureWebRTC();
        if (!rtc || !rtc.RTCIceCandidate) throw new Error('WebRTC RTCIceCandidate unavailable');
        await pc.addIceCandidate(new rtc.RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error(' Error handling ICE candidate:', error);
    }
  }
  
  /**
   * Handle connection state changes and attempt reconnection if needed
   */
  async handleConnectionStateChange(pc, remoteUserId) {
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      console.log(` Connection to ${remoteUserId} is ${pc.connectionState}, attempting reconnection...`);
      
      // Close the old connection
      pc.close();
      this.peerConnections.delete(remoteUserId);
      this.remoteStreams.delete(remoteUserId);
      
      // Notify about user leaving
      if (this.eventListeners.onUserLeft) {
        this.eventListeners.onUserLeft(remoteUserId);
      }
      
      // Prevent too frequent reconnection attempts
      const now = Date.now();
      if (!this.lastConnectionAttempt || (now - this.lastConnectionAttempt > 5000)) {
        this.lastConnectionAttempt = now;
        
        // Only attempt to reconnect if we have a channel ID and we're not the broadcaster
        if (this.channelId) {
          setTimeout(async () => {
            try {
              const channelDoc = await db.collection(this.streamsCollection).doc(this.channelId).get();
              if (channelDoc.exists) {
                const channelData = channelDoc.data();
                if (channelData.broadcaster) {
                  console.log(` Attempting to reconnect to broadcaster: ${channelData.broadcaster}`);
                  await this.createPeerConnection(channelData.broadcaster);
                  await this.createOffer(channelData.broadcaster);
                }
              }
            } catch (error) {
              console.error(' Reconnection attempt failed:', error);
            }
          }, 3000); // Wait 3 seconds before trying to reconnect
        }
      }
    }
  }
  
  /**
   * Set event listeners for WebRTC events
   */
  setEventListeners(listeners) {
    this.eventListeners = { ...this.eventListeners, ...listeners };
    console.log('📡 WebRTC event listeners updated');
  }
  
  /**
   * Get a specific remote stream by user ID
   */
  getRemoteStream(userId) {
    return this.remoteStreams.get(userId);
  }
  
  /**
   * Get all remote streams
   */
  getAllRemoteStreams() {
    return Array.from(this.remoteStreams.values());
  }
  
  /**
   * Get all peer connections
   */
  getPeerConnections() {
    return this.peerConnections;
  }
  
  /**
   * Switch between front and back camera
   */
  switchCamera() {
    try {
      if (this.localStream) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        if (videoTrack && videoTrack._switchCamera) {
          videoTrack._switchCamera();
          console.log('📸 Camera switched');
          return true;
        }
      }
      console.warn('⚠️ Cannot switch camera - no local stream or video track');
      return false;
    } catch (error) {
      console.error('❌ Error switching camera:', error);
      return false;
    }
  }
}

// Export a lightweight placeholder to avoid import-time failures in environments without react-native-webrtc
export const RTCView = () => null;
export default new AgoraService();
