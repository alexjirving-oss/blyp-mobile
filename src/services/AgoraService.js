import { Platform } from 'react-native';
import RtcEngine from 'react-native-agora';
import { requestCameraAndAudioPermission } from '../utils/permissions';

import { AGORA_APP_ID } from '../config/agora';

// Your Agora App ID (replace this with your actual App ID)
// const AGORA_APP_ID = 'YOUR_AGORA_APP_ID'; // ⚠️ Replace with your App ID

class AgoraService {
  constructor() {
    this.engine = null;
    this.localUid = null;
    this.channelId = null;
    this.eventListeners = [];
  }

  /**
   * Initialize the Agora RTC Engine
   * @returns {Promise<RtcEngine>} - Initialized RTC Engine instance
   */
  async init() {
    try {
      console.log('🔧 Agora: Starting initialization with App ID:', AGORA_APP_ID.substring(0, 8) + '...');
      
      // Request permissions on Android
      if (Platform.OS === 'android') {
        console.log('📱 Agora: Requesting camera and audio permissions...');
        await requestCameraAndAudioPermission();
        console.log('✅ Agora: Permissions granted');
      }
      
      // Create RTC engine instance
      console.log('🎬 Agora: Creating RTC engine instance...');
      this.engine = await RtcEngine.create(AGORA_APP_ID);
      console.log('✅ Agora: RTC engine created');
      
      // Enable video & audio modules
      console.log('🎥 Agora: Enabling video and audio...');
      await this.engine.enableVideo();
      await this.engine.enableAudio();
      
      // Set default configurations
      console.log('⚙️ Agora: Setting channel profile and client role...');
      await this.engine.setChannelProfile(1); // LiveBroadcasting
      await this.engine.setClientRole(1); // Broadcaster by default
      
      // Set video encoding config for better quality
      console.log('📹 Agora: Configuring video encoding...');
      await this.engine.setVideoEncoderConfiguration({
        dimensions: {
          width: 640,
          height: 360
        },
        frameRate: 24,
        bitrate: 1000,
        orientationMode: 0, // Adaptive
        degradationPreference: 2, // BalancedMode
      });
      
      // Enable dual-stream mode for better bandwidth adaptation
      await this.engine.enableDualStreamMode(true);
      
      console.log('✅ Agora RTC Engine initialized successfully');
      return this.engine;
    } catch (error) {
      console.error('❌ Error initializing Agora RTC Engine:', error);
      console.error('❌ Error details:', error.message, error.code);
      throw error;
    }
  }
  
  /**
   * Start local video preview
   * @param {number} viewId - Local view component ID
   */
  async startPreview() {
    if (!this.engine) {
      throw new Error('Agora RTC Engine not initialized');
    }
    
    try {
      await this.engine.startPreview();
      console.log('📹 Local video preview started');
    } catch (error) {
      console.error('❌ Error starting preview:', error);
      throw error;
    }
  }
  
  /**
   * Join a channel as broadcaster (streamer)
   * @param {string} channelId - Channel ID to join
   * @param {string} token - Authentication token (null if App ID Authentication)
   * @returns {Promise<void>}
   */
  async joinChannelAsBroadcaster(channelId, token = null) {
    if (!this.engine) {
      throw new Error('Agora RTC Engine not initialized');
    }
    
    try {
      this.channelId = channelId;
      
      // Set client role to broadcaster
      await this.engine.setClientRole(1); // 1 = Broadcaster
      
      // Join the channel
      await this.engine.joinChannel(token, channelId, null, 0);
      console.log(`🚀 Joined channel ${channelId} as broadcaster`);
    } catch (error) {
      console.error(`❌ Error joining channel ${channelId}:`, error);
      throw error;
    }
  }
  
  /**
   * Join a channel as audience (viewer)
   * @param {string} channelId - Channel ID to join
   * @param {string} token - Authentication token (null if App ID Authentication)
   * @returns {Promise<void>}
   */
  async joinChannelAsAudience(channelId, token = null) {
    if (!this.engine) {
      throw new Error('Agora RTC Engine not initialized');
    }
    
    try {
      this.channelId = channelId;
      
      // Set client role to audience
      await this.engine.setClientRole(2); // 2 = Audience
      
      // Join the channel
      await this.engine.joinChannel(token, channelId, null, 0);
      console.log(`👀 Joined channel ${channelId} as audience`);
    } catch (error) {
      console.error(`❌ Error joining channel ${channelId}:`, error);
      throw error;
    }
  }
  
  /**
   * Leave the current channel
   * @returns {Promise<void>}
   */
  async leaveChannel() {
    if (!this.engine) {
      return;
    }
    
    try {
      await this.engine.leaveChannel();
      console.log(`👋 Left channel ${this.channelId}`);
      this.channelId = null;
    } catch (error) {
      console.error('❌ Error leaving channel:', error);
      throw error;
    }
  }
  
  /**
   * Switch camera between front and back
   * @returns {Promise<void>}
   */
  async switchCamera() {
    if (!this.engine) {
      throw new Error('Agora RTC Engine not initialized');
    }
    
    try {
      await this.engine.switchCamera();
      console.log('🔄 Camera switched');
    } catch (error) {
      console.error('❌ Error switching camera:', error);
      throw error;
    }
  }
  
  /**
   * Toggle local audio (mute/unmute)
   * @param {boolean} muted - Whether audio should be muted
   * @returns {Promise<void>}
   */
  async muteLocalAudio(muted) {
    if (!this.engine) {
      throw new Error('Agora RTC Engine not initialized');
    }
    
    try {
      await this.engine.muteLocalAudioStream(muted);
      console.log(`🎤 Local audio ${muted ? 'muted' : 'unmuted'}`);
    } catch (error) {
      console.error('❌ Error toggling local audio:', error);
      throw error;
    }
  }
  
  /**
   * Toggle local video (enable/disable)
   * @param {boolean} disabled - Whether video should be disabled
   * @returns {Promise<void>}
   */
  async disableLocalVideo(disabled) {
    if (!this.engine) {
      throw new Error('Agora RTC Engine not initialized');
    }
    
    try {
      await this.engine.muteLocalVideoStream(disabled);
      console.log(`📹 Local video ${disabled ? 'disabled' : 'enabled'}`);
    } catch (error) {
      console.error('❌ Error toggling local video:', error);
      throw error;
    }
  }
  
  /**
   * Add event listener for Agora events
   * @param {string} event - Event name
   * @param {Function} callback - Callback function
   */
  addListener(event, callback) {
    if (!this.engine) {
      throw new Error('Agora RTC Engine not initialized');
    }
    
    const listener = this.engine.addListener(event, callback);
    this.eventListeners.push(listener);
    return listener;
  }
  
  /**
   * Clean up resources
   */
  async destroy() {
    if (!this.engine) {
      return;
    }
    
    try {
      // Remove all event listeners
      this.eventListeners.forEach(listener => {
        if (listener && typeof listener.remove === 'function') {
          listener.remove();
        }
      });
      this.eventListeners = [];
      
      // Leave channel if in one
      if (this.channelId) {
        await this.leaveChannel();
      }
      
      // Destroy the engine
      await this.engine.destroy();
      this.engine = null;
      console.log('🗑️ Agora RTC Engine destroyed');
    } catch (error) {
      console.error('❌ Error destroying Agora RTC Engine:', error);
    }
  }
}

export default new AgoraService();