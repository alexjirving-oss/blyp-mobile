/**
 * Agora SDK configuration
 */

// Your Agora App ID - replace with your actual credentials
export const AGORA_APP_ID = 'c1d9c1e3bbfa45b7811d5a5895d31ff0';

// Agora SDK configuration
export const AGORA_CONFIG = {
  // Video encoding configuration
  videoConfig: {
    width: 640,
    height: 360,
    frameRate: 24,
    bitrate: 1000,
  },
  
  // Whether to use dual stream mode (recommended for bandwidth optimization)
  useDualStream: true,
  
  // Audio profile - 0: Default, 1: Music standard, 2: Music high, 3: Music high stereo
  audioProfile: 1,
  
  // Default client role
  defaultRole: 'audience', // 'audience' or 'broadcaster'
};

// Stream quality presets
export const STREAM_QUALITY = {
  LOW: {
    width: 320,
    height: 180,
    frameRate: 15,
    bitrate: 400,
  },
  MEDIUM: {
    width: 640,
    height: 360,
    frameRate: 24,
    bitrate: 800,
  },
  HIGH: {
    width: 1280,
    height: 720,
    frameRate: 30,
    bitrate: 1500,
  },
};