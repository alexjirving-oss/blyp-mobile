/**
 * Simple Speech-to-Text Service for Blyp Mobile
 * 
 * Uses browser's built-in Web Speech API (works in Expo web/browser)
 * Falls back to manual input on mobile devices
 */

class SimpleSpeechService {
  constructor() {
    this.isListening = false;
    this.recognition = null;
    
    // Check if Web Speech API is available
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';
      
      console.log('✅ Web Speech API available');
    } else {
      console.log('⚠️ Web Speech API not available - will use manual input');
    }
  }

  /**
   * Transcribe audio to text using simple methods
   * 
   * @param {string} audioUri - Audio file URI (not used in this simple version)
   * @returns {Promise<string>} Transcribed text or manual input prompt
   */
  async transcribeAudio(audioUri) {
    console.log('🎯 Starting simple speech transcription...');

    try {
      // For now, return a helpful manual input prompt
      // In a future version, this could use the Web Speech API for real-time transcription
      
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate processing
      
      const helpfulPrompt = "✏️ Replace this text with what you said, then tap 'Enhance with AI' to see magic happen! 🚀";
      
      console.log('✅ Simple speech service - manual input mode');
      return helpfulPrompt;

    } catch (error) {
      console.error('❌ Simple speech service failed:', error);
      return "Type what you said here, then use 'Enhance with AI' ✨";
    }
  }

  /**
   * Start real-time speech recognition (for future use)
   * This would work in browsers but needs special handling for mobile
   */
  async startRealTimeSpeech() {
    if (!this.recognition) {
      throw new Error('Speech recognition not available');
    }

    return new Promise((resolve, reject) => {
      this.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        console.log('🎤 Real-time speech result:', transcript);
        resolve(transcript);
      };

      this.recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        reject(new Error(event.error));
      };

      this.recognition.start();
    });
  }

  /**
   * Check if real-time speech is available
   */
  isRealTimeSpeechAvailable() {
    return Boolean(this.recognition);
  }
}

export default new SimpleSpeechService();