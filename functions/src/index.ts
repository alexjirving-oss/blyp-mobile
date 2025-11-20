/**
 * Enterprise Firebase Functions for Scalable Live Streaming
 * Production-ready server-side processing for:
 *  - Video transcoding and quality generation
 *  - Real-time segment processing
 *  - CDN optimization and caching
 *  - Stream analytics and monitoring
 *  - Automatic scaling and load balancing
 *  - Global edge distribution
 *  - Performance optimization
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';
// @ts-ignore (library lacks bundled types)
import * as ffmpeg from 'fluent-ffmpeg';
import * as ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
// fetch import removed (unused)

// Helper: parse stream path (legacy & new layouts)
function parseStreamPath(filePath: string) {
  const parts = filePath.split('/');
  // Expected patterns:
  // 1) streams/<streamId>/segment_10.mp4
  // 2) streams/<userId>/<streamId>/segment_10.mp4
  // 3) streams/<streamId>/raw/segment_10.mp4
  let streamId: string | null = null;
  let variant: string = 'unknown';
  if (parts.length >= 3 && parts[0] === 'streams') {
    if (/^segment_\d+/.test(parts[2]) || parts[2] === 'raw') {
      // pattern 1 or 3
      streamId = parts[1];
      variant = parts[2] === 'raw' ? 'raw-folder' : 'flat';
    } else if (parts.length >= 4 && /^segment_\d+/.test(parts[3])) {
      // pattern 2 (streams/<userId>/<streamId>/segment_X.mp4)
      streamId = parts[2];
      variant = 'nested-user-stream';
    } else if (parts.length >= 5 && parts[3] === 'raw' && /^segment_\d+/.test(parts[4])) {
      streamId = parts[2];
      variant = 'nested-user-stream-raw';
    }
  }
  // Derive root directory (where qualities/playlists should live) ignoring optional 'raw' folder
  // Examples:
  // streams/<streamId>/segment_5.mp4        -> streams/<streamId>
  // streams/<userId>/<streamId>/segment_5.mp4 -> streams/<userId>/<streamId>
  // streams/<streamId>/raw/segment_5.mp4   -> streams/<streamId>
  // streams/<userId>/<streamId>/raw/segment_5.mp4 -> streams/<userId>/<streamId>
  let rootDir: string | null = null;
  if (streamId) {
    if (variant.startsWith('nested-user-stream')) {
      // parts: [streams, userId, streamId, (raw?), segment_X.mp4]
      rootDir = ['streams', parts[1], streamId].join('/');
    } else {
      // flat or raw-folder: [streams, streamId, ...]
      rootDir = ['streams', streamId].join('/');
    }
  }
  return { streamId, variant, parts, rootDir };
}

// Initialize Firebase Admin (use project default bucket, which may use the firebasestorage.app domain)
admin.initializeApp();

const db = admin.firestore();
const storage = new Storage();

// Set FFmpeg path
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

/**
 * Video Transcoding Function - Processes uploaded segments into multiple qualities
 * Triggered when a video segment is uploaded to Firebase Storage
 */
export const processVideoSegment = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '2GB',
    maxInstances: 100
  })
  // Use default bucket trigger (avoid hard-coding bucket name to remain compatible with firebasestorage.app domain)
  .storage.object()
  .onFinalize(async (object) => {
    try {
      const filePath = object.name;
      const bucket = object.bucket;

      // Guard: required path & naming
      if (!filePath || !filePath.includes('streams/') || !filePath.includes('segment_')) {
        return null;
      }

      console.log(`🎬 Processing video segment: ${filePath}`);
      const { streamId, variant, parts, rootDir } = parseStreamPath(filePath);
      if (!streamId) {
        console.log('❌ Unable to parse streamId from path', { filePath, parts });
        return null;
      }
      if (!rootDir) {
        console.log('❌ Unable to determine rootDir for path', { filePath, parts });
        return null;
      }
  const rootDirStr: string = rootDir as string; // non-null (guarded)
  const segmentName = parts.find(p => /^segment_\d+/.test(p))?.replace(/\.mp4$/, '') || path.basename(filePath, path.extname(filePath));
  console.log(`🧩 Parsed streamId=${streamId} variant=${variant} segmentName=${segmentName} rootDir=${rootDirStr}`);

      // Download original segment
      const tempDir = os.tmpdir();
      const sourceFile = path.join(tempDir, `source_${Date.now()}_${segmentName}.mp4`);
      await storage.bucket(bucket).file(filePath).download({ destination: sourceFile });
      console.log('📥 Downloaded source to', sourceFile);

      // Determine segment index for ramp decisions
      const segmentIndex = parseInt(segmentName.replace('segment_', ''), 10);

      // Base quality ladder
      let baseQualities = [
        { name: '240p', width: 426, height: 240, bitrate: '400k', fps: 24 },
        { name: '480p', width: 854, height: 480, bitrate: '1000k', fps: 30 },
        { name: '720p', width: 1280, height: 720, bitrate: '2500k', fps: 30 },
        { name: '1080p', width: 1920, height: 1080, bitrate: '5000k', fps: 30 }
      ];
      // Ramp-up: delay 1080p for first 3 segments to reduce startup latency
      if (segmentIndex < 3) {
        baseQualities = baseQualities.filter(q => q.name !== '1080p');
      }

      // Sequential retry loop (simpler & avoids TS nullable capture issues). Max 2 attempts per quality.
      const processedSegments: any[] = [];
      for (const q of baseQualities) {
        let attempt = 0;
        while (attempt < 2) {
          try {
            const result = await transcodeSegment(sourceFile, q, streamId, segmentName, bucket, rootDirStr);
            if (result) processedSegments.push(result);
            break;
          } catch (err) {
            attempt++;
            console.warn(`⚠️ Transcode retry ${attempt} for ${q.name} (segment ${segmentName})`);
            if (attempt >= 2) {
              console.error(`❌ Giving up on quality ${q.name} for segment ${segmentName}`, err);
            }
          }
        }
      }

      await updateStreamManifest(streamId, segmentName, processedSegments);
  await generateHLSPlaylist(streamId, segmentName, rootDirStr);
      await updateProcessingAnalytics(streamId, processedSegments.length);

      fs.unlinkSync(sourceFile);
      console.log(`✅ Finished processing ${segmentName}`);
      return null;
    } catch (error) {
      console.error('❌ Video processing error:', error);
      throw error;
    }
  });

/**
 * Transcode video segment to specific quality
 */
async function transcodeSegment(
  sourceFile: string,
  quality: any,
  streamId: string,
  segmentName: string,
  bucket: string,
  rootDir: any // using any due to upstream nullable inference; guarded prior to call
): Promise<any> {
  
  return new Promise((resolve, reject) => {
    const tempDir = os.tmpdir();
    const outputFile = path.join(tempDir, `${segmentName}_${quality.name}.mp4`);
    
    console.log(`🔄 Transcoding to ${quality.name}: ${outputFile}`);
    
    ffmpeg(sourceFile)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(`${quality.width}x${quality.height}`)
      .videoBitrate(quality.bitrate)
      .fps(quality.fps)
      .format('mp4')
      .outputOptions([
        '-preset fast',
        '-crf 23',
        '-maxrate ' + quality.bitrate,
        '-bufsize ' + (parseInt(quality.bitrate) * 2) + 'k',
        '-g ' + (quality.fps * 2), // Keyframe interval
        '-keyint_min ' + quality.fps,
        '-sc_threshold 0',
        '-profile:v baseline',
        '-level 3.0'
      ])
      .on('end', async () => {
        try {
          // Upload transcoded segment
          const destinationPath = `${rootDir}/qualities/${quality.name}/${segmentName}.mp4`;
          
          await storage.bucket(bucket).upload(outputFile, {
            destination: destinationPath,
            metadata: {
              contentType: 'video/mp4',
              cacheControl: 'public, max-age=300', // 5 minutes cache
              metadata: {
                quality: quality.name,
                streamId: streamId,
                segmentName: segmentName,
                processedAt: new Date().toISOString()
              }
            }
          });
          
          // Get public URL
          const [url] = await storage.bucket(bucket).file(destinationPath).getSignedUrl({
            action: 'read',
            expires: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
          });
          
          // Cleanup temp file
          fs.unlinkSync(outputFile);
          
          console.log(`✅ Uploaded ${quality.name}: ${destinationPath}`);
          
          resolve({
            quality: quality.name,
            url: url,
            path: destinationPath,
            width: quality.width,
            height: quality.height,
            bitrate: quality.bitrate
          });
          
        } catch (error) {
          console.error(`❌ Upload error for ${quality.name}:`, error);
          reject(error);
        }
      })
  .on('error', (error: any) => {
        console.error(`❌ Transcoding error for ${quality.name}:`, error);
        // Cleanup on error
        if (fs.existsSync(outputFile)) {
          fs.unlinkSync(outputFile);
        }
        reject(error);
      })
      .save(outputFile);
  });
}

/**
 * Update stream manifest with processed segments
 */
async function updateStreamManifest(
  streamId: string, 
  segmentName: string, 
  processedSegments: any[]
) {
  try {
    const segmentNumber = parseInt(segmentName.replace('segment_', ''));
    
    const qualitiesMap = processedSegments.reduce((acc, segment) => {
      acc[segment.quality] = {
        url: segment.url,
        path: segment.path,
        width: segment.width,
        height: segment.height,
        bitrate: segment.bitrate,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      return acc;
    }, {});
    
    await db.collection('liveStreams').doc(streamId).update({
      [`segments.${segmentNumber}.qualities`]: qualitiesMap,
      [`segments.${segmentNumber}.processed`]: true,
      [`segments.${segmentNumber}.processedAt`]: admin.firestore.FieldValue.serverTimestamp(),
      availableQualities: processedSegments.map(s => s.quality),
      lastProcessedSegment: segmentNumber,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`📝 Updated manifest for segment ${segmentNumber}`);
    
  } catch (error) {
    console.error('❌ Manifest update error:', error);
    throw error;
  }
}

/**
 * Generate HLS playlist for adaptive streaming
 */
async function generateHLSPlaylist(streamId: string, segmentName: string, rootDir: string) {
  try {
    // Get stream data
    const streamDoc = await db.collection('liveStreams').doc(streamId).get();
    const streamData = streamDoc.data();
    
    if (!streamData || !streamData.segments) {
      return;
    }
    
    // Generate master playlist (after trimming window)
  const masterPlaylist = generateMasterPlaylist(streamData);
    
    // Generate quality-specific playlists
  const qualityPlaylists = generateQualityPlaylists(streamData);
    
    // Upload playlists to storage
    await Promise.all([
      uploadPlaylist(rootDir, 'master.m3u8', masterPlaylist),
      ...Object.entries(qualityPlaylists).map(([quality, playlist]) =>
        uploadPlaylist(rootDir, `${quality}.m3u8`, playlist as string)
      )
    ]);
    
    console.log(`📋 Generated HLS playlists for stream ${streamId}`);
    
  } catch (error) {
    console.error('❌ Playlist generation error:', error);
    throw error;
  }
}

/**
 * Generate master HLS playlist
 */
function generateMasterPlaylist(streamData: any): string {
  let playlist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
  
  const qualityInfo = {
    '240p': { bandwidth: 400000, resolution: '426x240' },
    '480p': { bandwidth: 1000000, resolution: '854x480' },
    '720p': { bandwidth: 2500000, resolution: '1280x720' },
    '1080p': { bandwidth: 5000000, resolution: '1920x1080' }
  };
  
  if (streamData.availableQualities) {
    streamData.availableQualities.forEach((quality: string) => {
      const info = (qualityInfo as Record<string, { bandwidth: number; resolution: string }>)[quality];
      if (info) {
        playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${info.bandwidth},RESOLUTION=${info.resolution}\n`;
        playlist += `${quality}.m3u8\n`;
      }
    });
  }
  
  return playlist;
}

/**
 * Generate quality-specific playlists
 */
function generateQualityPlaylists(streamData: any): Record<string, string> {
  const playlists: Record<string, string> = {};

  if (!streamData.availableQualities || !streamData.segments) {
    return playlists;
  }

  // Collect and sort segment numbers numerically to maintain sequence
  let segmentEntries = Object.entries(streamData.segments)
    .map(([num, data]) => [parseInt(num, 10), data] as [number, any])
    .filter(([n]) => !isNaN(n))
    .sort((a, b) => a[0] - b[0]);

  // Sliding window to keep only latest 40 segments in playlists (does not delete data, just playlist references)
  const WINDOW = 40;
  if (segmentEntries.length > WINDOW) {
    segmentEntries = segmentEntries.slice(segmentEntries.length - WINDOW);
  }

  streamData.availableQualities.forEach((quality: string) => {
    // Determine media sequence (first segment number or 0)
    const firstSegmentNumber = segmentEntries.length > 0 ? segmentEntries[0][0] : 0;
    let playlist = '#EXTM3U\n';
    playlist += '#EXT-X-VERSION:3\n';
    playlist += '#EXT-X-INDEPENDENT-SEGMENTS\n';
    playlist += `#EXT-X-TARGETDURATION:10\n`; // conservative upper bound
    playlist += `#EXT-X-MEDIA-SEQUENCE:${firstSegmentNumber}\n\n`;

    let segmentCount = 0;
    for (const [segmentNumber, segmentData] of segmentEntries) {
      if (segmentData.qualities && segmentData.qualities[quality]) {
        // Duration currently fixed; could be dynamic if stored later
        playlist += '#EXTINF:2.0,\n';
        // Stored path: streams/<streamId>/qualities/<quality>/segment_<n>.mp4
        // Playlist lives in: streams/<streamId>/playlists/<quality>.m3u8
        // So we reference via relative path below:
        playlist += `../qualities/${quality}/segment_${segmentNumber}.mp4\n`;
        segmentCount++;
      }
    }

    // Optionally append #EXT-X-ENDLIST if stream ended (we infer by status)
    if (streamData.status && streamData.status !== 'live') {
      playlist += '#EXT-X-ENDLIST\n';
    }

    playlists[quality] = playlist;
    console.log(`🎼 Built playlist for ${quality}: segments=${segmentCount}`);
  });

  return playlists;
}

/**
 * Upload playlist to storage
 */
async function uploadPlaylist(rootDir: string, fileName: string, content: string) {
  try {
    // Use default bucket from Admin SDK (avoids hard-coded project-specific bucket name)
    const bucketRef = admin.storage().bucket();
    const file = bucketRef.file(`${rootDir}/playlists/${fileName}`);
    
    await file.save(content, {
      metadata: {
        contentType: 'application/vnd.apple.mpegurl',
        cacheControl: 'public, max-age=30', // 30 seconds cache for live content
      }
    });
    
    console.log(`📋 Uploaded playlist: ${fileName}`);
    
  } catch (error) {
    console.error(`❌ Playlist upload error for ${fileName}:`, error);
    throw error;
  }
}

/**
 * Stream Analytics Function - Real-time viewer and performance tracking
 */
export const updateStreamAnalytics = functions.firestore
  .document('liveStreams/{streamId}')
  .onUpdate(async (change, context) => {
    try {
      const streamId = context.params.streamId;
      const beforeData = change.before.data();
      const afterData = change.after.data();
      
      // Calculate metrics
      const viewCountDelta = (afterData.viewCount || 0) - (beforeData.viewCount || 0);
      const newSegments = Object.keys(afterData.segments || {}).length - 
                          Object.keys(beforeData.segments || {}).length;
      
      // Update analytics
      await updateAnalyticsCollection(streamId, {
        viewCountDelta,
        newSegments,
        totalViewers: afterData.viewCount || 0,
        totalSegments: Object.keys(afterData.segments || {}).length,
        lastUpdate: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Check for alerts
      await checkStreamHealth(streamId, afterData);
      
      console.log(`📊 Analytics updated for stream ${streamId}: +${viewCountDelta} viewers, +${newSegments} segments`);
      
    } catch (error) {
      console.error('❌ Analytics update error:', error);
    }
  });

/**
 * Update analytics collection
 */
async function updateAnalyticsCollection(streamId: string, metrics: any) {
  const analyticsRef = db.collection('streamAnalytics').doc(streamId);
  
  await analyticsRef.set({
    streamId,
    ...metrics,
    hourlyStats: admin.firestore.FieldValue.arrayUnion({
      timestamp: new Date(),
      ...metrics
    })
  }, { merge: true });
}

/**
 * Check stream health and trigger alerts
 */
async function checkStreamHealth(streamId: string, streamData: any) {
  const health = streamData.streamHealth || {};
  const now = Date.now();
  const lastUpdate = streamData.lastUpdated?.toMillis() || now;
  const timeSinceUpdate = now - lastUpdate;
  
  // Alert conditions
  const alerts = [];
  
  if (timeSinceUpdate > 30000) {
    alerts.push('Stream inactive for 30+ seconds');
  }
  
  if (health.errorRate > 0.1) {
    alerts.push('High error rate detected');
  }
  
  if (health.bufferHealth < 0.2) {
    alerts.push('Poor buffer health');
  }
  
  if (alerts.length > 0) {
    await sendHealthAlert(streamId, alerts);
  }
}

/**
 * Send health alert
 */
async function sendHealthAlert(streamId: string, alerts: string[]) {
  console.warn(`⚠️ Health alert for stream ${streamId}:`, alerts);
  
  // In production, this would send to monitoring systems
  await db.collection('streamAlerts').add({
    streamId,
    alerts,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    severity: 'warning'
  });
}

/**
 * Stream Cleanup Function - Remove old segments and data
 */
/**
 * Stream Cleanup Function - Remove old segments and data
 */
export const cleanupOldStreams = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async (context) => {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - 24); // 24 hours ago
      
      // Find old streams
      const oldStreamsQuery = await db.collection('liveStreams')
        .where('status', '!=', 'live')
        .where('lastUpdated', '<', cutoffTime)
        .limit(100)
        .get();
      
      console.log(`🧹 Found ${oldStreamsQuery.size} old streams to cleanup`);
      
      // Cleanup each stream
      for (const doc of oldStreamsQuery.docs) {
        await cleanupStream(doc.id, doc.data());
      }
      
      console.log(`✅ Cleanup completed for ${oldStreamsQuery.size} streams`);
      
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  });

/**
 * Cleanup individual stream
 */
async function cleanupStream(streamId: string, streamData: any) {
  try {
    console.log(`🗑️ Cleaning up stream: ${streamId}`);
    
    // Delete storage files
    const bucketRef = admin.storage().bucket();
    const [files] = await bucketRef.getFiles({
      prefix: `streams/${streamId}/`
    });
    
    // Delete files in batches
  const deletePromises = files.map(file => file.delete());
    await Promise.all(deletePromises);
    
    // Delete Firestore documents
    await Promise.all([
      db.collection('liveStreams').doc(streamId).delete(),
      db.collection('streamAnalytics').doc(streamId).delete()
    ]);
    
    console.log(`✅ Cleaned up stream ${streamId}: ${files.length} files deleted`);
    
  } catch (error) {
    console.error(`❌ Error cleaning up stream ${streamId}:`, error);
  }
}

/**
 * Update processing analytics
 */
async function updateProcessingAnalytics(streamId: string, qualityCount: number) {
  try {
    await db.collection('processingAnalytics').doc(streamId).set({
      streamId,
      totalProcessed: admin.firestore.FieldValue.increment(1),
      qualitiesGenerated: admin.firestore.FieldValue.increment(qualityCount),
      lastProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
      processingHistory: admin.firestore.FieldValue.arrayUnion({
        timestamp: new Date(),
        qualityCount,
        processedAt: new Date().toISOString()
      })
    }, { merge: true });
    
  } catch (error) {
    console.error('❌ Processing analytics error:', error);
  }
}

/**
 * Thumbnail Generation Function
 */
export const generateThumbnails = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '1GB'
  })
  .storage.object()
  .onFinalize(async (object) => {
    try {
      const filePath = object.name;
      const bucket = object.bucket;
      
      if (!filePath || !filePath.includes('streams/') || !filePath.includes('segment_')) {
        return null;
      }
      
      console.log(`🖼️ Generating thumbnail for: ${filePath}`);
      
      // Use unified parser to reliably extract streamId across path variants
      const { streamId, rootDir } = parseStreamPath(filePath);
      if (!streamId || !rootDir) {
        console.log('❌ Thumbnail generation: unable to determine streamId/rootDir from path', filePath);
        return null;
      }
      
      // Only generate a thumbnail every 10th segment to reduce load
      const segmentIndex = parseInt(path.basename(filePath).match(/segment_(\d+)/)?.[1] || '0', 10);
      if (segmentIndex % 10 !== 0) {
        console.log('🛑 Skipping thumbnail (interval rule) for segment', segmentIndex);
        return null;
      }

      // Download video
      const tempDir = os.tmpdir();
      const videoFile = path.join(tempDir, `video_${Date.now()}.mp4`);
      const thumbnailFile = path.join(tempDir, `thumb_${Date.now()}.jpg`);
      
      await storage.bucket(bucket).file(filePath).download({ destination: videoFile });
      
      // Extract thumbnail using FFmpeg
      await new Promise<void>((resolve, reject) => {
        ffmpeg(videoFile)
          .screenshots({
            timestamps: ['50%'],
            filename: path.basename(thumbnailFile),
            folder: path.dirname(thumbnailFile),
            size: '320x180'
          })
          .on('end', () => resolve())
          .on('error', (error: any) => reject(error));
      });
      
      // Optimize thumbnail with Sharp
      const optimizedThumbnail = path.join(tempDir, `optimized_${Date.now()}.jpg`);
      await sharp(thumbnailFile)
        .resize(320, 180, { fit: 'cover' })
        .jpeg({ quality: 80 })
        .toFile(optimizedThumbnail);
      
      // Upload thumbnail
  const thumbnailPath = `${rootDir}/thumbnails/latest.jpg`;
      await storage.bucket(bucket).upload(optimizedThumbnail, {
        destination: thumbnailPath,
        metadata: {
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=3600'
        }
      });
      
      // Update stream document
      const [url] = await storage.bucket(bucket).file(thumbnailPath).getSignedUrl({
        action: 'read',
        expires: Date.now() + 24 * 60 * 60 * 1000
      });
      
      await db.collection('liveStreams').doc(streamId).update({
        latestThumbnail: url,
        thumbnailUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Cleanup
      [videoFile, thumbnailFile, optimizedThumbnail].forEach(file => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      });
      
      console.log(`✅ Thumbnail generated for stream ${streamId}`);
      return null; // Explicit return to satisfy TypeScript (no value needed)
    } catch (error) {
      console.error('❌ Thumbnail generation error:', error);
      return null; // Ensure all code paths return
    }
  });

// Removed duplicate parseStreamPath & processVideoSegment definitions (now consolidated at top of file)

/**
 * Analytics Retention Purge Function
 * Scheduled job enforcing 90-day (or configured) retention by deleting expired analytics events.
 * Selection criteria: documents in `analytics` where `retentionExpiresAt` < now and capped per run.
 * Safety: limits deletions to BATCH_LIMIT per invocation to avoid overload; subsequent runs continue.
 */
export const purgeExpiredAnalytics = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const now = Date.now();
    const BATCH_LIMIT = 500; // safety cap per execution
    let deleted = 0;
    try {
      const snap = await db.collection('analytics')
        .where('retentionExpiresAt', '<', now)
        .limit(BATCH_LIMIT)
        .get();
      if (snap.empty) {
        console.log('🧹 Analytics purge: no expired documents');
        return null;
      }
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      deleted = snap.size;
      await db.collection('analyticsPurgeLog').add({
        runAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedCount: deleted,
        batchLimit: BATCH_LIMIT
      });
      console.log(`✅ Analytics purge complete. Deleted ${deleted} expired events.`);
    } catch (err) {
      console.error('❌ Analytics purge error:', err);
      await db.collection('analyticsPurgeLog').add({
        runAt: admin.firestore.FieldValue.serverTimestamp(),
        error: (err as Error)?.message || String(err),
        deletedCount: deleted
      });
    }
    return null;
  });

/**
 * Report Aggregation Function
 * Ingests new reports and upserts an aggregated moderationQueue document per target.
 * Document key pattern: <targetType>_<targetId>
 * Fields maintained:
 *  - targetType, targetId
 *  - totalReports
 *  - reasons: { reasonCode: count }
 *  - firstReportedAt, lastReportedAt
 *  - openReportIds (trimmed window)
 *  - status: 'pending_review' | 'under_review' | 'resolved'
 * This is additive; original report docs remain unchanged.
 */
export const aggregateReport = functions.firestore
  .document('reports/{reportId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const { targetType, targetId, reasonCode } = data;
    if (!targetType || !targetId || !reasonCode) {
      console.log('⚠️ Report missing required aggregation fields');
      return null;
    }
    const queueDocId = `${targetType}_${targetId}`;
    const ref = db.collection('moderationQueue').doc(queueDocId);
    try {
      await db.runTransaction(async tx => {
        const existing = await tx.get(ref);
        const now = admin.firestore.FieldValue.serverTimestamp();
        if (!existing.exists) {
          tx.set(ref, {
            targetType,
            targetId,
            totalReports: 1,
            reasons: { [reasonCode]: 1 },
            firstReportedAt: now,
            lastReportedAt: now,
            openReportIds: [snap.id],
            status: 'pending_review',
            priorityScore: 1 // simple initial heuristic
          });
        } else {
          const cur = existing.data() || {};
          const reasons = cur.reasons || {};
          reasons[reasonCode] = (reasons[reasonCode] || 0) + 1;
          const openReportIds = Array.isArray(cur.openReportIds) ? [snap.id, ...cur.openReportIds].slice(0, 25) : [snap.id];
          const totalReports = (cur.totalReports || 0) + 1;
          // Simple priority heuristic: totalReports + distinctReasons * 0.5
          const distinctReasons = Object.keys(reasons).length;
          const priorityScore = totalReports + distinctReasons * 0.5;
          tx.update(ref, {
            reasons,
            totalReports,
            lastReportedAt: now,
            openReportIds,
            priorityScore
          });
        }
      });
      console.log(`🛡️ Aggregated report into moderationQueue/${queueDocId}`);
    } catch (err) {
      console.error('❌ Aggregation error:', err);
    }
    return null;
  });

/**
 * Daily Moderation Queue Priority Recalculation
 * Recomputes priorityScore factoring aging (older unresolved targets increase score modestly).
 */
export const recalcModerationQueue = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    try {
      const snap = await db.collection('moderationQueue').where('status', '==', 'pending_review').limit(500).get();
      const batch = db.batch();
      const nowMs = Date.now();
      snap.docs.forEach(d => {
        const cur = d.data();
        const totalReports = cur.totalReports || 0;
        const distinctReasons = Object.keys(cur.reasons || {}).length;
        const lastTs = cur.lastReportedAt?.toMillis?.() || nowMs;
        const ageHours = Math.max(0, (nowMs - lastTs) / (1000 * 60 * 60));
        const agingFactor = Math.min(12, ageHours / 6); // up to +12 after 72h
        const priorityScore = totalReports + distinctReasons * 0.5 + agingFactor;
        batch.update(d.ref, { priorityScore });
      });
      if (snap.size > 0) await batch.commit();
      console.log(`✅ Recalculated moderationQueue priorities for ${snap.size} targets`);
    } catch (e) {
      console.error('❌ Recalc moderation queue error', e);
    }
    return null;
  });