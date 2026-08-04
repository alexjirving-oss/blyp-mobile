/**
 * Tests for mediaDescriptionService improvements
 * Validates:
 * - Gemini "unexpected structure" responses don't create junk descriptions
 * - Fallback text only used when no valid AI description and no voice caption
 * - Generic descriptions are detected and rejected
 * - Retry logic for MAX_TOKENS responses
 */

import mediaDescriptionService from '../src/services/mediaDescriptionService';

// Mock fetch globally
global.fetch = jest.fn();

// Mock FileSystem
jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(() => Promise.resolve('base64data==')),
  EncodingType: {
    Base64: 'base64',
  },
}));

// Mock firebase config
jest.mock('../src/config/firebase', () => ({
  geminiApiKey: 'test-api-key',
  geminiApiUrl: 'https://test.example/gemini?model=gemini-2.5-flash',
  geminiAuthHeaders: jest.fn(async () => ({ 'Content-Type': 'application/json' })),
}));

describe('mediaDescriptionService - Improved Reliability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Generic Description Detection', () => {
    it('should reject generic "a photo" descriptions', () => {
      const service = mediaDescriptionService;
      
      expect(service.isGenericDescription('a photo')).toBe(true);
      expect(service.isGenericDescription('A photo of something')).toBe(true);
      expect(service.isGenericDescription('The image shows')).toBe(true);
      expect(service.isGenericDescription('This is a picture')).toBe(true);
    });

    it('should reject time-based descriptions', () => {
      const service = mediaDescriptionService;
      
      expect(service.isGenericDescription('Photo captured at 14:32')).toBe(true);
      expect(service.isGenericDescription('Image taken at 2:30 PM')).toBe(true);
      expect(service.isGenericDescription('Recorded on 12/04/2025')).toBe(true);
    });

    it('should reject AI refusal messages', () => {
      const service = mediaDescriptionService;
      
      expect(service.isGenericDescription('Sorry, I cannot')).toBe(true);
      expect(service.isGenericDescription('As an AI, I am unable')).toBe(true);
      expect(service.isGenericDescription('I see a photo')).toBe(true);
    });

    it('should reject too-short descriptions', () => {
      const service = mediaDescriptionService;
      
      expect(service.isGenericDescription('Photo')).toBe(true);
      expect(service.isGenericDescription('Image')).toBe(true);
      expect(service.isGenericDescription('')).toBe(true);
      expect(service.isGenericDescription(null)).toBe(true);
    });

    it('should accept valid specific descriptions', () => {
      const service = mediaDescriptionService;
      
      expect(service.isGenericDescription('Coffee cup on wooden table with laptop')).toBe(false);
      expect(service.isGenericDescription('Sunset over city skyline with orange glow')).toBe(false);
      expect(service.isGenericDescription('Person coding on laptop in cozy room')).toBe(false);
    });
  });

  describe('Unexpected Response Structure Handling', () => {
    it('should return null (not junk description) when candidates array is empty', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [], // Empty candidates
        }),
      });

      const mediaItem = { type: 'photo', uri: 'file://test.jpg' };
      const result = await mediaDescriptionService.generateMediaDescription(mediaItem);

      expect(result).toBe(null);
    });

    it('should return null when content.parts is missing', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {}, // Missing parts
            finishReason: 'STOP',
          }],
        }),
      });

      const mediaItem = { type: 'photo', uri: 'file://test.jpg' };
      const result = await mediaDescriptionService.generateMediaDescription(mediaItem);

      expect(result).toBe(null);
    });

    it('should return null when safety filter blocks content', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'SAFETY',
            content: null,
          }],
        }),
      });

      const mediaItem = { type: 'photo', uri: 'file://test.jpg' };
      const result = await mediaDescriptionService.generateMediaDescription(mediaItem);

      expect(result).toBe(null);
    });
  });

  describe('MAX_TOKENS Retry Logic', () => {
    it('should retry with simpler prompt when MAX_TOKENS is hit', async () => {
      // First call returns MAX_TOKENS
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'MAX_TOKENS',
            content: {
              parts: [{ text: 'Truncated descrip...' }],
            },
          }],
        }),
      });

      // Retry call succeeds
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{ text: 'Coffee cup on wooden table' }],
            },
          }],
        }),
      });

      const mediaItem = { type: 'photo', uri: 'file://test.jpg' };
      const result = await mediaDescriptionService.generateMediaDescription(mediaItem);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toBe('Coffee cup on wooden table');
    });

    it('should return null if retry also fails', async () => {
      // First call returns MAX_TOKENS
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'MAX_TOKENS',
            content: {
              parts: [{ text: 'Truncated' }],
            },
          }],
        }),
      });

      // Retry also fails
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const mediaItem = { type: 'photo', uri: 'file://test.jpg' };
      const result = await mediaDescriptionService.generateMediaDescription(mediaItem);

      expect(result).toBe(null);
    });
  });

  describe('Fallback Description Quality', () => {
    it('should use neutral fallback text without timestamps', () => {
      const service = mediaDescriptionService;
      
      const photoFallback = service.getFallbackDescription({ type: 'photo' }, 0);
      const videoFallback = service.getFallbackDescription({ type: 'video' }, 0);
      
      expect(photoFallback).toBe('Photo shared by the user');
      expect(videoFallback).toBe('Video shared by the user');
      
      // Should not contain time patterns
      expect(photoFallback).not.toMatch(/\d+:\d+/);
      expect(videoFallback).not.toMatch(/\d+:\d+/);
    });

    it('should number multiple items in fallback', () => {
      const service = mediaDescriptionService;
      
      const photo1 = service.getFallbackDescription({ type: 'photo' }, 0);
      const photo2 = service.getFallbackDescription({ type: 'photo' }, 1);
      const photo3 = service.getFallbackDescription({ type: 'photo' }, 2);
      
      expect(photo1).toBe('Photo shared by the user');
      expect(photo2).toBe('Photo 2 shared by the user');
      expect(photo3).toBe('Photo 3 shared by the user');
    });
  });

  describe('Generic Description Rejection in Pipeline', () => {
    it('should return null when Gemini returns generic description', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{ text: 'A photo taken at 2:30 PM' }],
            },
          }],
        }),
      });

      const mediaItem = { type: 'photo', uri: 'file://test.jpg' };
      const result = await mediaDescriptionService.generateMediaDescription(mediaItem);

      expect(result).toBe(null);
    });

    it('should accept and return specific descriptions from Gemini', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{ text: 'Laptop and coffee cup on wooden desk with warm lighting' }],
            },
          }],
        }),
      });

      const mediaItem = { type: 'photo', uri: 'file://test.jpg' };
      const result = await mediaDescriptionService.generateMediaDescription(mediaItem);

      expect(result).toBe('Laptop and coffee cup on wooden desk with warm lighting');
    });
  });

  describe('Batch Processing with Null Handling', () => {
    it('should convert null descriptions to neutral fallbacks only as last resort', async () => {
      // Mock test connection
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: "Hello, API is working!" }] }
          }]
        }),
      });

      // First item: good description
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [{ text: 'Coffee on table' }],
            },
          }],
        }),
      });

      // Second item: returns null (blocked content)
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'SAFETY',
          }],
        }),
      });

      const mediaItems = [
        { type: 'photo', uri: 'file://photo1.jpg' },
        { type: 'photo', uri: 'file://photo2.jpg' },
      ];

      const results = await mediaDescriptionService.generateMediaDescriptions(mediaItems);

      expect(results[0]).toBe('Coffee on table');
      expect(results[1]).toBe('Photo 2 shared by the user'); // Fallback only when null
    });
  });
});
