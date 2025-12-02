/**
 * StreamingLog - Centralized Streaming Observability API
 * 
 * Single source of truth for all streaming events (HLS, Agora, future backends).
 * Provides structured logging with analytics integration and console dev output.
 * 
 * Usage:
 *   logStreamingEvent('STREAM_START_SUCCESS', { backendId: 'HLS', streamId, userId });
 * 
 * NO MORE ad-hoc console.log in streaming code - use this API exclusively.
 */

import type { StreamingBackendId, StreamingEventType, StreamingLogPayload } from '../types/StreamingTypes';

// Import EnterpriseAnalyticsService if available
let analyticsService: any = null;
try {
  // Dynamic import to avoid breaking if analytics not configured
  analyticsService = require('../services/EnterpriseAnalyticsService').default;
} catch {
  console.warn('[STREAM] EnterpriseAnalyticsService not available - analytics disabled');
}

/**
 * Log a structured streaming event
 * 
 * @param event - Event type from StreamingEventType taxonomy
 * @param payload - Event payload with backendId, streamId, userId, etc.
 */
export function logStreamingEvent(
  event: StreamingEventType,
  payload: StreamingLogPayload = {} as StreamingLogPayload
): void {
  const timestamp = Date.now();
  const backendId = payload.backendId || 'HLS'; // Default to HLS for now
  
  // Build structured event
  const structuredEvent = {
    event,
    timestamp,
    backendId,
    streamId: payload.streamId,
    userId: payload.userId,
    segmentNumber: payload.segmentNumber,
    reason: payload.reason,
    errorMessage: payload.errorMessage,
    status: payload.status,
    viewerCount: payload.viewerCount,
    ...payload, // Allow arbitrary additional fields
  };
  
  // 1. Send to analytics service if available
  if (analyticsService && typeof analyticsService.logStreamingEvent === 'function') {
    try {
      analyticsService.logStreamingEvent(structuredEvent);
    } catch (err) {
      console.error('[STREAM][ANALYTICS] Failed to log event:', err);
    }
  }
  
  // 2. Structured console output for dev (single line, easily greppable)
  const consolePrefix = `[STREAM][${backendId}][${event}]`;
  const consolePayload = {
    streamId: payload.streamId,
    userId: payload.userId?.substring(0, 8), // Truncate UID for readability
    segmentNumber: payload.segmentNumber,
    reason: payload.reason,
    status: payload.status,
    viewerCount: payload.viewerCount,
    // Include other relevant fields but omit long strings
  };
  
  // Use different console methods based on event type
  if (event.includes('FAILURE') || event.includes('ERROR')) {
    console.error(consolePrefix, consolePayload);
  } else if (event.includes('SUCCESS') || event.includes('START_REQUEST')) {
    console.log(consolePrefix, consolePayload);
  } else {
    // Snapshot/end events - quieter in dev
    if (__DEV__ && Math.random() < 0.1) {
      // Sample 10% of snapshot events to avoid spam
      console.debug(consolePrefix, consolePayload);
    }
  }
}

/**
 * Batch log helper for high-frequency events (e.g., segment uploads)
 * Buffers events and flushes periodically to avoid overwhelming analytics
 */
let eventBuffer: Array<{ event: StreamingEventType; payload: StreamingLogPayload }> = [];
let flushTimer: NodeJS.Timeout | null = null;

export function logStreamingEventBatched(
  event: StreamingEventType,
  payload: StreamingLogPayload = {} as StreamingLogPayload
): void {
  eventBuffer.push({ event, payload });
  
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushEventBuffer();
    }, 5000); // Flush every 5 seconds
  }
}

function flushEventBuffer(): void {
  if (eventBuffer.length === 0) return;
  
  console.log(`[STREAM][BATCH] Flushing ${eventBuffer.length} events`);
  
  // Send batch to analytics
  if (analyticsService && typeof analyticsService.logStreamingEventBatch === 'function') {
    try {
      analyticsService.logStreamingEventBatch(eventBuffer);
    } catch (err) {
      console.error('[STREAM][ANALYTICS] Failed to flush batch:', err);
    }
  }
  
  eventBuffer = [];
  flushTimer = null;
}
