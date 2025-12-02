/**
 * HLS Streaming Backend Implementation
 * 
 * Wraps the existing HLSLiveStreamService to conform to StreamingBackendAPI interface.
 * This allows seamless switching to other backends (Agora, etc.) without changing UI logic.
 */

import HLSLiveStreamServiceInstance from '../services/HLSLiveStreamService';
import { ensureUserProfile, createStream as liveServiceCreateStream } from '../services/LiveService';
import { logStreamingEvent } from './StreamingLog';
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
    logStreamingEvent('STREAM_START_REQUEST', {
      backendId: 'HLS',
      userId,
      source: 'backend',
    });

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

      logStreamingEvent('STREAM_START_SUCCESS', {
        backendId: 'HLS',
        streamId: hlsResult.streamId,
        userId,
        source: 'backend',
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
      
      logStreamingEvent('STREAM_START_FAILURE', {
        backendId: 'HLS',
        userId,
        reason: 'BACKEND_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        source: 'backend',
      });

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
    logStreamingEvent('SEGMENT_UPLOAD_REQUEST', {
      backendId: 'HLS',
      streamId,
      userId,
      segmentNumber,
      source: 'backend',
    });

    try {
      // HLS service uploadSegment throws on error, not structured result
      await HLSLiveStreamServiceInstance.uploadSegment(
        streamId,
        fileUri,
        segmentNumber,
        userId
      );

      logStreamingEvent('SEGMENT_UPLOAD_SUCCESS', {
        backendId: 'HLS',
        streamId,
        userId,
        segmentNumber,
        source: 'backend',
      });

      return {
        ok: true,
        data: { segmentNumber },
      };
    } catch (error: any) {
      console.error('[HLSBackend] uploadSegment error:', error);
      
      // Map permission denied errors from Storage/Firestore
      if (error?.code === 'permission-denied' || error?.code === 'storage/unauthorized') {
        console.error('[HLS][SECURITY] Permission denied in uploadSegment - check Storage/Firestore rules');
        logStreamingEvent('SEGMENT_UPLOAD_FAILURE', {
          backendId: 'HLS',
          streamId,
          userId,
          segmentNumber,
          reason: 'PERMISSION_DENIED',
          errorMessage: 'Permission denied',
          source: 'backend',
        });
        return {
          ok: false,
          reason: 'PERMISSION_DENIED',
          error: 'You do not have permission to upload segments to this stream',
        };
      }

      logStreamingEvent('SEGMENT_UPLOAD_FAILURE', {
        backendId: 'HLS',
        streamId,
        userId,
        segmentNumber,
        reason: 'BACKEND_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        source: 'backend',
      });

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
    logStreamingEvent('STREAM_END_REQUEST', {
      backendId: 'HLS',
      streamId,
      userId,
      source: 'backend',
    });

    try {
      // HLS service endStream already returns structured result
      const result = await HLSLiveStreamServiceInstance.endStream(streamId, userId);

      if (!result.ok) {
        // Map HLS-specific reasons to StreamingErrorReason
        const mappedReason = result.reason === 'PERMISSION_DENIED' 
          ? 'PERMISSION_DENIED' 
          : 'BACKEND_ERROR';

        logStreamingEvent('STREAM_END_FAILURE', {
          backendId: 'HLS',
          streamId,
          userId,
          reason: mappedReason as any,
          errorMessage: result.error,
          source: 'backend',
        });

        return {
          ok: false,
          reason: mappedReason as any,
          error: result.error,
        };
      }

      logStreamingEvent('STREAM_END_SUCCESS', {
        backendId: 'HLS',
        streamId,
        userId,
        source: 'backend',
      });

      return { ok: true };
    } catch (error) {
      console.error('[HLSBackend] endStream error:', error);
      
      logStreamingEvent('STREAM_END_FAILURE', {
        backendId: 'HLS',
        streamId,
        userId,
        reason: 'BACKEND_ERROR',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        source: 'backend',
      });

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
    logStreamingEvent('VIEWER_SUBSCRIBE_REQUEST', {
      backendId: 'HLS',
      streamId,
      source: 'backend',
    });

    let snapshotCount = 0;

    // Forward to HLS service, normalizing the snapshot format
    const unsubscribe = HLSLiveStreamServiceInstance.subscribeToStream(streamId, (rawData: any) => {
      if (!rawData) {
        logStreamingEvent('VIEWER_SUBSCRIBE_END', {
          backendId: 'HLS',
          streamId,
          source: 'backend',
        });
        onSnapshot(null);
        return;
      }

      snapshotCount++;

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

      const snapshot: ViewerStreamSnapshot = {
        streamId,
        title: rawData.title || 'Untitled Stream',
        hostUserId: rawData.hostUserId || rawData.userId,
        isLive: rawData.status !== 'ended' && rawData.isLive !== false,
        segments,
        currentSegment: rawData.currentSegment,
        viewCount: rawData.viewCount || 0,
        status: rawData.status,
      };

      // Log snapshot every 10th update to avoid spam
      if (snapshotCount === 1 || snapshotCount % 10 === 0) {
        logStreamingEvent('VIEWER_SUBSCRIBE_SNAPSHOT', {
          backendId: 'HLS',
          streamId,
          status: snapshot.status,
          viewerCount: snapshot.viewCount,
          source: 'backend',
        });
      }

      onSnapshot(snapshot);
    });

    // Wrap unsubscribe to log termination
    return () => {
      logStreamingEvent('VIEWER_SUBSCRIBE_END', {
        backendId: 'HLS',
        streamId,
        source: 'backend',
      });
      unsubscribe();
    };
  },
};
