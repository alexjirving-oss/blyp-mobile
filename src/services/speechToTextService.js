import { Audio } from 'expo-av';
import { Platform, Alert } from 'react-native';

/**
 * Speech-to-Text Service for Blyp Mobile
 * 
 * Handles voice recording and transcription for AI content generation
 * Features:
 * - High-quality audio recording
 * - Cross-platform audio processing
 * - Integration with AI service for enhanced content
 */

class SpeechToTextService {
  constructor() {
    this.recording = null;
    this.isRecording = false;
    this.recordingStartTime = null;
    this._stopping = false;
    this._starting = false;
    this._lastError = null;
    // Use Audio.RecordingOptionsPresets for better compatibility
    // Extend preset with metering enabled for speech detection
    const preset = Audio.RecordingOptionsPresets.HIGH_QUALITY;
    this.recordingSettings = {
      ...preset,
      android: {
        ...preset.android,
        extension: '.m4a',
        outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_MPEG_4,
        audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_AAC,
      },
      ios: {
        ...preset.ios,
        extension: '.m4a',
        audioQuality: Audio.RECORDING_OPTION_IOS_AUDIO_QUALITY_HIGH,
      },
      isMeteringEnabled: true,
    };
  }

  /**
   * Request audio permissions
   */
  async requestPermissions() {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert(
          'Microphone Permission Required',
          'Please grant microphone permission to use voice features.',
          [{ text: 'OK' }]
        );
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error requesting audio permissions:', error);
      return false;
    }
  }

  /**
   * Set up audio mode for recording
   */
  async setupAudioMode() {
    try {
      // Use a simpler audio mode configuration to avoid compatibility issues
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
    } catch (error) {
      console.error('Failed to set audio mode:', error);
      // Don't throw - continue without setting audio mode
      console.warn('Continuing without audio mode configuration');
    }
  }

  /**
   * Start voice recording with auto-stop when silence detected
   * 
   * @param {Function} onStatusUpdate - Callback for recording status updates
   * @param {Function} onAutoStop - Callback when recording auto-stops due to silence
   * @param {number} silenceTimeout - Milliseconds of silence before auto-stop (default: 3000)
   * @returns {Promise<boolean>} Success status
   */
  async startRecording(onStatusUpdate, onAutoStop = null, silenceTimeout = 3000) {
    if (this._starting) {
      console.warn('⚠️ startRecording invoked while starting; treating as pending success');
      return true;
    }
    if (this.isRecording && this.recording) {
      console.log('ℹ️ Already recording; returning existing session');
      return true;
    }
    this._starting = true;
    this._lastError = null;
    try {
      // Request permissions
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        this._starting = false;
        return false;
      }

      // Set up audio mode
      await this.setupAudioMode();
      // Additional Android audio config for robustness
      try {
        if (Platform.OS === 'android') {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
            shouldDuckAndroid: true,
            staysActiveInBackground: false,
            // Recording session only — restored to media/loudspeaker on stop.
            playThroughEarpieceAndroid: false,
          });
        }
      } catch (androidModeErr) {
        console.warn('⚠️ Android audio mode extended config failed:', androidModeErr?.message);
      }

      // Create recording with both platform options
      console.log('🎤 Starting voice recording...');
      
      let recording;
      try {
        const created = await Audio.Recording.createAsync(this.recordingSettings);
        recording = created.recording;
      } catch (primaryErr) {
        console.warn('⚠️ Primary recording init failed, retrying with LOW_QUALITY:', primaryErr?.message);
        try {
          const fallbackCreated = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);
          recording = fallbackCreated.recording;
        } catch (fallbackErr) {
          console.error('❌ Fallback recording init failed:', fallbackErr?.message);
          this._lastError = fallbackErr;
          this._starting = false;
          return false;
        }
      }
      
      this.recording = recording;
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      // Set up status updates with auto-stop functionality
      if (onStatusUpdate || onAutoStop) {
        let silenceStartTime = null;
        let lastSoundTime = Date.now();
        
        this.recording.setOnRecordingStatusUpdate((status) => {
          // Call the status update callback
          if (onStatusUpdate) {
            onStatusUpdate({
              isRecording: status.isRecording,
              duration: status.durationMillis,
              metering: status.metering
            });
          }
          
          // Auto-stop logic based on audio level
          if (onAutoStop && status.metering !== undefined) {
            const currentTime = Date.now();
            const audioLevel = status.metering || -160; // Default to very quiet if undefined
            const isSpeaking = audioLevel > -50; // Threshold for detecting speech
            
            if (isSpeaking) {
              // Sound detected - reset silence timer
              lastSoundTime = currentTime;
              silenceStartTime = null;
            } else {
              // Silence detected
              if (silenceStartTime === null) {
                silenceStartTime = currentTime;
              }
              
              // Check if we've been silent long enough
              const silenceDuration = currentTime - silenceStartTime;
              const timeSinceLastSound = currentTime - lastSoundTime;
              
              // Auto-stop if we've been silent for the timeout AND we had some speech before
              if (!this._stopping && silenceDuration > silenceTimeout && timeSinceLastSound > silenceTimeout && lastSoundTime > 0) {
                console.log('🔇 Silence detected - auto-stopping recording...');
                this.stopRecording().then(() => {
                  if (onAutoStop) {
                    onAutoStop();
                  }
                });
              }
            }
          }
        });
      }

      console.log('✅ Voice recording started successfully');
      this._starting = false;
      return true;

    } catch (error) {
      console.error('❌ Failed to start voice recording:', error);
      this.isRecording = false;
      this.recording = null;
      this._starting = false;
      this._lastError = error;
      
      Alert.alert(
        'Recording Error', 
        'Failed to start voice recording. Please try again.',
        [{ text: 'OK' }]
      );
      
      return false;
    }
  }

  /**
   * Stop voice recording and get audio URI
   * 
   * @returns {Promise<string|null>} Audio file URI or null if failed
   */
  async stopRecording() {
    if (this._stopping) {
      console.warn('⚠️ Recording stop already in progress');
      return null;
    }

    const rec = this.recording; // capture local ref to guard against races
    if (!rec || !this.isRecording) {
      console.warn('⚠️ No active recording to stop');
      return null;
    }

    try {
      this._stopping = true;
      console.log('🛑 Stopping voice recording...');
      
      // Check recording status before stopping
      const status = await rec.getStatusAsync();
      
      // Ensure minimum recording duration (500ms) to prevent "no valid audio data" errors
      if (status.durationMillis && status.durationMillis < 500) {
        console.log('⏱️ Recording too short, waiting a moment...');
        await new Promise(resolve => setTimeout(resolve, 500 - status.durationMillis));
      }
      
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI?.() || null;
      
      this.isRecording = false;
      this.recording = null;
      this._stopping = false;

      // Clear PlayAndRecord / earpiece routing — chat + feed sounds need media/loudspeaker.
      await this.restorePlaybackAudioMode();

      // Validate URI exists
      if (!uri) {
        throw new Error('No audio file generated');
      }

      console.log('✅ Voice recording stopped:', uri);
      return uri;

    } catch (error) {
      console.error('❌ Failed to stop voice recording:', error);
      this.isRecording = false;
      this.recording = null;
      this._stopping = false;
      await this.restorePlaybackAudioMode();
      
      // Throw the error so it can be handled by the calling function
      throw new Error(`Stop encountered an error: ${error.message}`);
    }
  }

  /**
   * Clear recording audio session so UI sounds use loudspeaker / media stream.
   */
  async restorePlaybackAudioMode() {
    try {
      // eslint-disable-next-line global-require
      const { ensureMediaPlaybackAudioMode } = require('./notifySound');
      await ensureMediaPlaybackAudioMode({ background: false });
    } catch {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch {
        // ignore
      }
    }
  }

  /**
   * Cancel current recording
   */
  async cancelRecording() {
    if (!this.recording || !this.isRecording) {
      return;
    }

    try {
      console.log('❌ Cancelling voice recording...');
      
      await this.recording.stopAndUnloadAsync();
      this.isRecording = false;
      this.recording = null;
      await this.restorePlaybackAudioMode();

    } catch (error) {
      console.error('Error cancelling recording:', error);
      this.isRecording = false;
      this.recording = null;
      await this.restorePlaybackAudioMode();
    }
  }

  /**
   * Get recording status
   */
  getRecordingStatus() {
    return {
      isRecording: this.isRecording,
      hasActiveRecording: Boolean(this.recording),
      starting: this._starting,
      lastError: this._lastError?.message || null
    };
  }

  /**
   * Transcribe audio to text (demo implementation with user input)
   * 
   * In a real implementation, this would:
   * 1. Upload audio to speech-to-text service (Google Speech-to-Text, Azure, etc.)
   * 2. Return the transcribed text
   * 
   * For now, provides helpful demo functionality
   * 
   * @param {string} audioUri - Audio file URI
   * @returns {Promise<string>} Transcribed text
   */
  async transcribeAudio(audioUri) {
    if (!audioUri) {
      throw new Error('No audio URI provided for transcription');
    }

    console.log('📝 Transcribing audio...', audioUri);

    try {
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 500));

      // In a production app, you would integrate with a real speech-to-text service:
      // - Google Cloud Speech-to-Text API
      // - Azure Cognitive Services Speech
      // - AWS Transcribe
      // - Expo Speech library (if available)
      
      // For demo/testing purposes, return a helpful placeholder
      const demoTranscription = "Type what you said here, then tap 'Enhance with AI' to see the magic! ✨";

      console.log('✅ Audio transcribed (DEMO MODE):', demoTranscription);
      console.log('💡 Production: Real speech-to-text would transcribe your actual words');
      
      return demoTranscription;

    } catch (error) {
      console.error('❌ Failed to transcribe audio:', error);
      throw new Error('Failed to transcribe audio. Please try again.');
    }
  }

  /**
   * Record and transcribe in one operation
   * 
   * @param {Object} options - Recording options
   * @param {Function} options.onStart - Called when recording starts
   * @param {Function} options.onStop - Called when recording stops  
   * @param {Function} options.onTranscriptionComplete - Called with transcribed text
   * @param {Function} options.onError - Called on error
   * @returns {Promise<string>} Transcribed text
   */
  async recordAndTranscribe(options = {}) {
    const {
      onStart,
      onStop,
      onTranscriptionComplete,
      onError
    } = options;

    try {
      // Start recording
      const recordingStarted = await this.startRecording();
      
      if (!recordingStarted) {
        throw new Error('Failed to start recording');
      }

      if (onStart) {
        onStart();
      }

      // Note: In a real app, you might want to:
      // 1. Show a recording UI
      // 2. Let the user manually stop recording
      // 3. Or implement automatic stop after silence detection
      
      // For this demo, we'll need the caller to manually call stopRecording()
      // and then transcribeAudio() with the returned URI

      return new Promise((resolve, reject) => {
        // Store resolve/reject for later use
        this._currentPromise = { resolve, reject, onStop, onTranscriptionComplete };
      });

    } catch (error) {
      console.error('Record and transcribe error:', error);
      if (onError) {
        onError(error);
      }
      throw error;
    }
  }

  /**
   * Complete the transcription process (called after manual stop)
   */
  async completeTranscription() {
    try {
      const audioUri = await this.stopRecording();
      
      if (this._currentPromise?.onStop) {
        this._currentPromise.onStop();
      }

      if (!audioUri) {
        throw new Error('No audio recorded');
      }

      const transcription = await this.transcribeAudio(audioUri);
      
      if (this._currentPromise?.onTranscriptionComplete) {
        this._currentPromise.onTranscriptionComplete(transcription);
      }

      if (this._currentPromise?.resolve) {
        this._currentPromise.resolve(transcription);
      }

      this._currentPromise = null;
      return transcription;

    } catch (error) {
      if (this._currentPromise?.reject) {
        this._currentPromise.reject(error);
      }
      this._currentPromise = null;
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.isRecording && this.recording) {
      await this.cancelRecording();
    }
  }
}

// Export singleton instance
export default new SpeechToTextService();

// Export class for testing
export { SpeechToTextService };