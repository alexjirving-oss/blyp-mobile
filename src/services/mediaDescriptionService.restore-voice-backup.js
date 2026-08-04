// Backup of mediaDescriptionService.js before voice flow restoration
import * as FileSystem from 'expo-file-system/legacy';
import { getGeminiApiKey, buildGeminiUrl, hasGeminiKey } from '../config/geminiConfig';
import { logStructured } from '../utils/logStructured';

class MediaDescriptionService {
  async testConnection() { /* content omitted for brevity in backup */ }
  async generateFullPostDataWithContext(mediaUri, contextPrompt, mediaDescriptions = [], transcript = '') { /* content omitted */ }
  async generateFullPostData(mediaUri, userPrompt = '') { /* content omitted */ }
  async generateMediaDescription(mediaItem) { /* content omitted */ }
  async generateMediaDescriptions(mediaItems) { /* content omitted */ }
  getFallbackDescription(mediaItem, index = 0) { /* content omitted */ }
  getSmartFallbackDescription(mediaItem, userPrompt = '') { /* content omitted */ }
  getContextualFallback(mediaDescriptions = []) { /* content omitted */ }
  getSmartContextualFallback(contextPrompt = '', mediaDescriptions = [], transcript = '') { /* content omitted */ }
  extractJsonBlock(text) { /* content omitted */ }
  pickTranscriptKeywords(text) { /* content omitted */ }
  getVideoFallbackDescription() { /* content omitted */ }
  extractTextFromGeminiDescriptionResponse(data) { /* content omitted */ }
}

export default new MediaDescriptionService();