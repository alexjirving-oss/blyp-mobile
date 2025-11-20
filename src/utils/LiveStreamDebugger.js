/**
 * Live Stream Viewer Debugging Diagnostic
 * 
 * This script identifies why viewers see "Waiting for video segments..."
 * instead of the actual streamer camera feed.
 */

console.log('🔍 LIVE STREAM VIEWER DEBUG DIAGNOSTIC');
console.log('=======================================\n');

// Import Firebase for direct debugging
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';
import HLSLiveStreamService from '../services/HLSLiveStreamService';

class LiveStreamDebugger {
  constructor() {
    this.debugResults = [];
    this.streamData = null;
  }

  /**
   * Step 1: Examine live stream document structure
   */
  async debugStreamDocument(streamId) {
    console.log('📊 STEP 1: Examining Stream Document Structure');
    console.log('='.repeat(50));
    
    try {
      const streamRef = doc(db, 'liveStreams', streamId);
      const streamDoc = await getDoc(streamRef);
      
      if (!streamDoc.exists()) {
        this.logResult('CRITICAL', 'Stream document does not exist in Firestore');
        return null;
      }
      
      const data = streamDoc.data();
      this.streamData = data;
      
      console.log('✅ Stream document found');
      console.log('📋 Stream Status:', data.status);
      console.log('📋 Current Segment:', data.currentSegment);
      console.log('📋 Total Segments:', data.totalSegments);
      console.log('📋 Stream Health:', data.streamHealth);
      
      // Check segments structure
      if (!data.segments) {
        this.logResult('CRITICAL', 'No segments object found in stream document');
        return data;
      }
      
      const segmentKeys = Object.keys(data.segments);
      console.log('📋 Available Segments:', segmentKeys.length);
      console.log('📋 Segment Keys:', segmentKeys);
      
      if (segmentKeys.length === 0) {
        this.logResult('CRITICAL', 'Stream has no segments - broadcaster may not be uploading properly');
        return data;
      }
      
      // Examine first few segments
      for (let i = 0; i < Math.min(3, segmentKeys.length); i++) {
        const segmentKey = segmentKeys[i];
        const segment = data.segments[segmentKey];
        
        console.log(`📋 Segment ${segmentKey}:`, {
          hasUrl: !!segment.url,
          url: segment.url ? segment.url.substring(0, 50) + '...' : 'MISSING',
          uploadedAt: segment.uploadedAt,
          size: segment.size,
          type: segment.type
        });
        
        if (!segment.url) {
          this.logResult('ERROR', `Segment ${segmentKey} missing URL`);
        }
        
        if (segment.type && segment.type !== 'video') {
          this.logResult('WARNING', `Segment ${segmentKey} is type "${segment.type}" - not video`);
        }
      }
      
      this.logResult('SUCCESS', `Found ${segmentKeys.length} segments in Firestore`);
      return data;
      
    } catch (error) {
      this.logResult('ERROR', `Failed to fetch stream document: ${error.message}`);
      return null;
    }
  }

  /**
   * Step 2: Test HLSLiveStreamService.getBufferSegments
   */
  debugBufferSegments(streamData) {
    console.log('\n📦 STEP 2: Testing Buffer Segments Processing');
    console.log('='.repeat(50));
    
    if (!streamData) {
      this.logResult('CRITICAL', 'No stream data to process');
      return [];
    }
    
    try {
      const bufferSegments = HLSLiveStreamService.getBufferSegments(streamData);
      
      console.log('📦 Buffer Segments Result:', bufferSegments);
      console.log('📦 Buffer Length:', bufferSegments.length);
      
      if (bufferSegments.length === 0) {
        this.logResult('CRITICAL', 'getBufferSegments returned empty array');
        
        // Debug why it's empty
        console.log('🔍 Debugging empty buffer:');
        console.log('  - Stream Data Type:', typeof streamData);
        console.log('  - Has segments:', !!streamData.segments);
        console.log('  - Current Segment:', streamData.currentSegment);
        console.log('  - Current Segment Type:', typeof streamData.currentSegment);
        
        if (typeof streamData.currentSegment !== 'number') {
          this.logResult('ERROR', 'currentSegment is not a number - this breaks getBufferSegments');
        }
        
        if (streamData.currentSegment < 0) {
          this.logResult('ERROR', 'currentSegment is negative - this breaks getBufferSegments');
        }
        
        return [];
      }
      
      // Examine each buffer segment
      bufferSegments.forEach((segment, index) => {
        console.log(`📦 Buffer Segment ${index}:`, {
          number: segment.number,
          hasUrl: !!segment.url,
          urlValid: segment.url && (segment.url.startsWith('https://') || segment.url.startsWith('http://')),
          isCurrent: segment.isCurrent,
          timestamp: segment.timestamp
        });
        
        if (!segment.url) {
          this.logResult('ERROR', `Buffer segment ${segment.number} has no URL`);
        }
        
        if (!segment.url.startsWith('https://') && !segment.url.startsWith('http://')) {
          this.logResult('ERROR', `Buffer segment ${segment.number} has invalid URL format: ${segment.url}`);
        }
      });
      
      this.logResult('SUCCESS', `Generated ${bufferSegments.length} buffer segments`);
      return bufferSegments;
      
    } catch (error) {
      this.logResult('ERROR', `getBufferSegments failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Step 3: Test segment URL accessibility
   */
  async debugSegmentUrls(bufferSegments) {
    console.log('\n🌐 STEP 3: Testing Segment URL Accessibility');
    console.log('='.repeat(50));
    
    if (!bufferSegments || bufferSegments.length === 0) {
      this.logResult('CRITICAL', 'No buffer segments to test');
      return;
    }
    
    for (const segment of bufferSegments.slice(0, 2)) { // Test first 2 segments
      try {
        console.log(`🌐 Testing segment ${segment.number}: ${segment.url}`);
        
        const response = await fetch(segment.url, { method: 'HEAD' });
        
        if (response.ok) {
          const contentLength = response.headers.get('content-length');
          console.log(`✅ Segment ${segment.number} accessible (${contentLength} bytes)`);
          this.logResult('SUCCESS', `Segment ${segment.number} URL accessible`);
        } else {
          console.log(`❌ Segment ${segment.number} failed: ${response.status} ${response.statusText}`);
          this.logResult('ERROR', `Segment ${segment.number} not accessible: ${response.status}`);
        }
        
      } catch (error) {
        console.log(`❌ Segment ${segment.number} network error:`, error.message);
        this.logResult('ERROR', `Segment ${segment.number} network error: ${error.message}`);
      }
    }
  }

  /**
   * Step 4: Simulate viewer component logic
   */
  simulateViewerLogic(bufferSegments) {
    console.log('\n🎬 STEP 4: Simulating Viewer Component Logic');
    console.log('='.repeat(50));
    
    if (!bufferSegments || bufferSegments.length === 0) {
      console.log('❌ No buffer segments available');
      this.logResult('CRITICAL', 'Viewer would show "Waiting for video segments..." - no segments available');
      return null;
    }
    
    // Simulate LiveStreamViewer_PRODUCTION logic
    const currentSegment = bufferSegments.find(seg => seg && seg.isCurrent);
    const latestSegment = bufferSegments[bufferSegments.length - 1];
    const bestSegment = currentSegment || latestSegment;
    
    console.log('🎬 Viewer Logic Simulation:');
    console.log('  - Current Segment:', currentSegment ? currentSegment.number : 'none');
    console.log('  - Latest Segment:', latestSegment ? latestSegment.number : 'none');
    console.log('  - Best Segment:', bestSegment ? bestSegment.number : 'none');
    
    if (!bestSegment) {
      this.logResult('CRITICAL', 'No best segment found - viewer shows placeholder');
      return null;
    }
    
    if (!bestSegment.url) {
      this.logResult('CRITICAL', 'Best segment has no URL - viewer shows placeholder');
      return null;
    }
    
    if (!bestSegment.url.startsWith('https://') && !bestSegment.url.startsWith('http://')) {
      this.logResult('CRITICAL', `Best segment has invalid URL format: ${bestSegment.url} - viewer shows placeholder`);
      return null;
    }
    
    console.log('✅ Viewer would load segment:', bestSegment.number);
    console.log('✅ Video URL:', bestSegment.url);
    this.logResult('SUCCESS', `Viewer should show video from segment ${bestSegment.number}`);
    
    return bestSegment;
  }

  /**
   * Utility: Log result with categorization
   */
  logResult(level, message) {
    const result = { level, message, timestamp: new Date().toISOString() };
    this.debugResults.push(result);
    
    const icons = { 
      SUCCESS: '✅', 
      WARNING: '⚠️', 
      ERROR: '❌', 
      CRITICAL: '🚨' 
    };
    
    console.log(`${icons[level]} ${level}: ${message}`);
  }

  /**
   * Generate final diagnosis report
   */
  generateDiagnosis() {
    console.log('\n📋 FINAL DIAGNOSIS REPORT');
    console.log('='.repeat(50));
    
    const critical = this.debugResults.filter(r => r.level === 'CRITICAL');
    const errors = this.debugResults.filter(r => r.level === 'ERROR');
    const warnings = this.debugResults.filter(r => r.level === 'WARNING');
    const successes = this.debugResults.filter(r => r.level === 'SUCCESS');
    
    console.log(`🚨 Critical Issues: ${critical.length}`);
    console.log(`❌ Errors: ${errors.length}`);
    console.log(`⚠️  Warnings: ${warnings.length}`);
    console.log(`✅ Successes: ${successes.length}`);
    
    if (critical.length > 0) {
      console.log('\n🚨 CRITICAL ISSUES (Fix These First):');
      critical.forEach(issue => console.log(`   • ${issue.message}`));
    }
    
    if (errors.length > 0) {
      console.log('\n❌ ERRORS:');
      errors.forEach(issue => console.log(`   • ${issue.message}`));
    }
    
    // Determine root cause
    let rootCause = 'Unknown';
    
    if (critical.some(c => c.message.includes('Stream document does not exist'))) {
      rootCause = 'Stream not created or invalid streamId';
    } else if (critical.some(c => c.message.includes('No segments object'))) {
      rootCause = 'Broadcaster not uploading segments to Firestore';
    } else if (critical.some(c => c.message.includes('Stream has no segments'))) {
      rootCause = 'Broadcaster unable to upload video segments';
    } else if (critical.some(c => c.message.includes('getBufferSegments returned empty'))) {
      rootCause = 'Buffer segment processing logic failure';
    } else if (critical.some(c => c.message.includes('currentSegment is not a number'))) {
      rootCause = 'Invalid currentSegment field in Firestore';
    } else if (errors.some(e => e.message.includes('not accessible'))) {
      rootCause = 'Firebase Storage permissions or network issues';
    }
    
    console.log('\n🎯 LIKELY ROOT CAUSE:', rootCause);
    
    return { critical, errors, warnings, successes, rootCause };
  }
}

// Export for use in components
export { LiveStreamDebugger };

// Example usage in a React component:
/*
import { LiveStreamDebugger } from './LiveStreamDebugger';

// In your component:
const debugStream = async (streamId) => {
  const debugger = new LiveStreamDebugger();
  
  const streamData = await debugger.debugStreamDocument(streamId);
  const bufferSegments = debugger.debugBufferSegments(streamData);
  await debugger.debugSegmentUrls(bufferSegments);
  const bestSegment = debugger.simulateViewerLogic(bufferSegments);
  
  const diagnosis = debugger.generateDiagnosis();
  
  console.log('🎯 Diagnosis:', diagnosis.rootCause);
};
*/