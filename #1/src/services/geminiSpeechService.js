/**
 * Gemini-Powered Speech Service for Blyp Mobile
 * 
 * Uses Gemini AI's multi-modal capabilities to transcribe audio
 * More reliable than separate Speech APIs
 */

import * as FileSystem from 'expo-file-system';
import { geminiApiKey } from '../config/firebase';

class GeminiSpeechService {
  constructor() {
    this.apiKey = geminiApiKey;
    this.apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${this.apiKey}`;
  }

  /**
   * Transcribe audio using Gemini AI's multimodal capabilities
   */
  async transcribeAudio(audioUri) {
    if (!audioUri) {
      throw new Error('No audio URI provided');
    }

    console.log('🤖 Transcribing with Gemini AI...');

    try {
      // Convert audio to base64
      const audioBase64 = await this.convertAudioToBase64(audioUri);
      
      const payload = {
        contents: [{
          parts: [
            {
              text: "Please transcribe the speech in this audio file. Return only the spoken words, nothing else. If the audio is unclear or empty, return: 'Please speak clearly and try again.'"
            },
            {
              inline_data: {
                mime_type: "audio/mp4",
                data: audioBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200
        }
      };

      console.log('🌐 Sending audio to Gemini for transcription...');

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout after 15 seconds')), 15000)
      );

      // Create fetch promise  
      const fetchPromise = fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      // Race between fetch and timeout
      const response = await Promise.race([fetchPromise, timeoutPromise]);

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.candidates && result.candidates[0]) {
        const transcription = result.candidates[0].content.parts[0].text.trim();
        
        // Check if it's a valid transcription
        if (transcription && !transcription.includes('Please speak clearly')) {
          console.log('✅ Gemini transcription successful:', transcription);
          return transcription;
        }
      }
      
      throw new Error('No clear speech detected');

    } catch (error) {
      console.warn('⚠️ Gemini speech transcription failed:', error.message);
      
      // Return helpful manual input prompt
      return "🎤 Audio recorded! Type what you said here, then tap 'Enhance with AI' for magic! ✨";
    }
  }

  /**
   * Convert audio file to base64
   */
  async convertAudioToBase64(audioUri) {
    try {
      const audioBase64 = await FileSystem.readAsStringAsync(audioUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      
      return audioBase64;
    } catch (error) {
      throw new Error('Failed to process audio file');
    }
  }
}

export default new GeminiSpeechService();