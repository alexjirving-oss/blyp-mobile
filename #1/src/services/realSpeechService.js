/**
 * Real Speech-to-Text Service for Blyp Mobile
 * 
 * Provides actual speech-to-text transcription using Google Cloud Speech API
 * Falls back to demo mode if the service is unavailable
 */

import * as FileSystem from 'expo-file-system';

class RealSpeechService {
  constructor() {
    // Use the same API key as Gemini (both are Google Cloud services)
  this.apiKey = "AIzaSyB_keeUJQhLwK8fUlnDRDoZDuO4rreneqY";
    this.speechApiUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`;
  }

  /**
   * Transcribe audio file to text
   * 
   * @param {string} audioUri - Local audio file URI
   * @returns {Promise<string>} Transcribed text
   */
  async transcribeAudio(audioUri) {
    if (!audioUri) {
      throw new Error('No audio URI provided for transcription');
    }

    console.log('🎯 Starting real speech transcription...', audioUri);

    try {
      // First, try real speech-to-text
      const transcription = await this.transcribeWithGoogleSpeech(audioUri);
      
      if (transcription && transcription.trim()) {
        console.log('✅ Real speech transcription successful:', transcription);
        return transcription;
      }

      // If empty result, use fallback
      throw new Error('Empty transcription result');

    } catch (error) {
      console.warn('⚠️ Real speech service failed, using manual input:', error.message);
      
      // Return helpful manual input prompt
      return "🎤 Type what you said here, then tap 'Enhance with AI' ✨";
    }
  }

  /**
   * Transcribe using Google Cloud Speech-to-Text API
   */
  async transcribeWithGoogleSpeech(audioUri) {
    try {
      console.log('📡 Converting audio for Google Speech API...');
      
      // Read audio file and convert to base64
      const audioBase64 = await this.convertAudioToBase64(audioUri);
      
      const requestBody = {
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000, // Match our recording settings
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
          enableWordTimeOffsets: false,
          model: 'latest_short', // Optimized for short audio clips
        },
        audio: {
          content: audioBase64
        }
      };

      console.log('🌐 Calling Google Speech API...');
      
      // Add timeout for speech API
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Speech API timeout')), 10000);
      });

      const fetchPromise = fetch(this.speechApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google Speech API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('📄 Speech API response:', result);
      
      if (result.results && result.results[0] && result.results[0].alternatives[0]) {
        const transcript = result.results[0].alternatives[0].transcript;
        const confidence = result.results[0].alternatives[0].confidence || 0;
        
        console.log(`🎯 Transcription confidence: ${(confidence * 100).toFixed(1)}%`);
        
        // Only return if confidence is reasonable
        if (confidence > 0.3) {
          return transcript.trim();
        } else {
          throw new Error(`Low confidence transcription: ${confidence}`);
        }
      }
      
      throw new Error('No transcription results in response');

    } catch (error) {
      console.error('❌ Google Speech API failed:', error);
      throw error;
    }
  }

  /**
   * Convert audio file to base64 for API transmission
   */
  async convertAudioToBase64(audioUri) {
    try {
      console.log('🔄 Reading audio file...');
      
      // Use Expo FileSystem to read the audio file
      const audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      console.log('✅ Audio converted to base64');
      return audioBase64;

    } catch (error) {
      console.error('❌ Failed to convert audio to base64:', error);
      throw new Error('Failed to process audio file');
    }
  }

  /**
   * Test if the speech service is available
   */
  async testSpeechService() {
    try {
      console.log('🧪 Testing Google Speech API connection...');
      
      // Create a minimal test request
      const testRequest = {
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
        },
        audio: {
          content: '' // Empty content for connection test
        }
      };

      const response = await fetch(this.speechApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testRequest)
      });

      // Even if it fails due to empty audio, a 400 error means the API is reachable
      const reachable = response.status === 400 || response.status === 200;
      
      console.log(reachable ? '✅ Speech API reachable' : '❌ Speech API unreachable');
      return reachable;

    } catch (error) {
      console.error('❌ Speech API test failed:', error);
      return false;
    }
  }
}

// Export singleton instance
export default new RealSpeechService();