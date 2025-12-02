/**
 * HLS Streaming Backend Implementation
 * 
 * Wraps the existing HLSLiveStreamService to conform to StreamingBackendAPI interface.
 * This allows seamless switching to other backends (Agora, etc.) without changing UI logic.
 */

import HLSLiveStreamServiceInstance from '../services/HLSLiveStreamService';
import { ensureUserProfile, createStream as liveServiceCreateStream } from '../services/LiveService';
import type {
  StreamingBackendAPI,
  StreamingResult,
  HostStreamMeta,
  ViewerStreamSnapshot,
  ViewerStreamSegment,
} from '../types/StreamingTypes';

/**
 * HLS Backend Implementation
 * 
 * Maps existing HLS service methods to StreamingBackendAPI interface.
 * Preserves all existing behavior, error handling, and structured results.
 */
export const HLSStreamingBackend: StreamingBackendAPI = {
  /**
   * Create a new live stream with user profile setup
   */
  async createStream({ userId, title, displayName, photoURL, email }): Promise<StreamingResult<HostStreamMeta>> {
    try {
      // Ensure user profile exists (LiveService presence)
      await ensureUserProfile({ userId, displayName, photoURL, email });

      // Create stream via HLS service (already returns structured result)
      const hlsResult = await HLSLiveStreamServiceInstance.createStream({
        userId,
        title,
        userDisplayName: displayName,
        userPhotoURL: photoURL,
      });

      // HLS service already returns { ok, reason, error, streamId, streamData }
      if (!hlsResult.ok) {
        // Map HLS_BACKEND_ERROR to generic BACKEND_ERROR, preserve PERMISSION_DENIED
        const mappedReason = hlsResult.reason === 'PERMISSION_DENIED' 
          ? 'PERMISSION_DENIED' 
          : hlsResult.reason === 'HLS_BACKEND_NOT_CONFIGURED' 
          ? 'BACKEND_NOT_CONFIGURED'
          : hlsResult.reason === 'NOT_LOGGED_IN'
          ? 'NOT_LOGGED_IN'
          : 'BACKEND_ERROR';
        return {
          ok: false,
          reason: mappedReason as any,
          error: hlsResult.error,
        };
      }

      // Also mark user as live in LiveService streams collection
      await liveServiceCreateStream({
        streamId: hlsResult.streamId,
        title: title || 'Untitled Stream',
        thumbnailUrl: null,
        userId,
      });

      return {
        ok: true,
        data: {
          streamId: hlsResult.streamId,
          userId,
          title,
          createdAt: Date.now(),
        },
      };
    } catch (error) {
      console.error('[HLSBackend] createStream error:', error);
      return {
        ok: false,
        reason: 'BACKEND_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error creating stream',
      };
    }
  },

  /**
   * Upload a segment to Firebase Storage
   */
  async uploadSegment({ streamId, userId, fileUri, segmentNumber }): Promise<StreamingResult<{ segmentNumber: number }>> {
    try {
      // HLS service uploadSegment throws on error, not structured result
      await HLSLiveStreamServiceInstance.uploadSegment(
        streamId,
        fileUri,
        segmentNumber,
        userId
      );

      return {
        ok: true,
        data: { segmentNumber },
      };
    } catch (error: any) {
      console.error('[HLSBackend] uploadSegment error:', error);
      // Map permission denied errors from Storage/Firestore
      if (error?.code === 'permission-denied' || error?.code === 'storage/unauthorized') {
        console.error('[HLS][SECURITY] Permission denied in uploadSegment - check Storage/Firestore rules');
        return {
          ok: false,
          reason: 'PERMISSION_DENIED',
          error: 'You do not have permission to upload segments to this stream',
        };
      }
      return {
        ok: false,
        reason: 'BACKEND_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error uploading segment',
      };
    }
  },

  /**
   * End the live stream
   */
  async endStream({ streamId, userId }): Promise<StreamingResult<void>> {
    try {
      // HLS service endStream already returns structured result
      const result = await HLSLiveStreamServiceInstance.endStream(streamId, userId);

      if (!result.ok) {
        // Map HLS-specific reasons to StreamingErrorReason
        const mappedReason = result.reason === 'PERMISSION_DENIED' 
          ? 'PERMISSION_DENIED' 
          : 'BACKEND_ERROR';
        return {
          ok: false,
          reason: mappedReason as any,
          error: result.error,
        };
      }

      return { ok: true };
    } catch (error) {
      console.error('[HLSBackend] endStream error:', error);
      return {
        ok: false,
        reason: 'BACKEND_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error ending stream',
      };
    }
  },

  /**
   * Subscribe to real-time stream updates
   * 
   * Maps Firestore snapshot to ViewerStreamSnapshot interface.
   */
  subscribeToStream(streamId: string, onSnapshot: (snapshot: ViewerStreamSnapshot | null) => void): () => void {
    // Forward to HLS service, normalizing the snapshot format
    return HLSLiveStreamServiceInstance.subscribeToStream(streamId, (rawData: any) => {
      if (!rawData) {
        onSnapshot(null);
        return;
      }

      // Map Firestore document to ViewerStreamSnapshot
      const segments: ViewerStreamSegment[] = [];

      // Handle both legacy segments map and subcollection format
      if (rawData.segments && typeof rawData.segments === 'object') {
        // Legacy format: segments is a map { 0: { url, timestamp }, 1: { url, timestamp } }
        Object.entries(rawData.segments).forEach(([indexStr, segment]: [string, any]) => {
          const index = parseInt(indexStr, 10);
          if (!isNaN(index) && segment && (segment.url || segment.uri)) {
            segments.push({
              index,
              uri: segment.url || segment.uri,
            });
          }
        });
      }

      // Sort segments by index
      segments.sort((a, b) => a.index - b.index);

      onSnapshot({
        streamId,
        title: rawData.title || 'Untitled Stream',
        hostUserId: rawData.hostUserId || rawData.userId,
        isLive: rawData.status !== 'ended' && rawData.isLive !== false,
        segments,
        currentSegment: rawData.currentSegment,
        viewCount: rawData.viewCount || 0,
        status: rawData.status,
      });
    });
  },
};
