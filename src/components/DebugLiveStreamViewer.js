/**
 * Debug Live Stream Viewer - Ultra-simplified for debugging
 * 
 * This strips away all complexity to show exactly what's happening
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  ScrollView,
} from 'react-native';
import UnifiedVideo from './UnifiedVideo';
import HLSLiveStreamService from '../services/HLSLiveStreamService';

const DebugLiveStreamViewer = ({ streamId, style }) => {
  const [rawData, setRawData] = useState(null);
  const [segments, setSegments] = useState([]);
  const [currentUrl, setCurrentUrl] = useState(null);
  const [logs, setLogs] = useState([]);
  
  const unsubscribeRef = useRef(null);
  const mountedRef = useRef(true);

  // Add log entry
  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-10), `${timestamp}: ${message}`]);
    console.log('🐛 DEBUG VIEWER:', message);
  };

  useEffect(() => {
    mountedRef.current = true;
    
    if (streamId) {
      addLog(`Starting debug viewer for stream: ${streamId}`);
      
      // Subscribe to stream
      unsubscribeRef.current = HLSLiveStreamService.subscribeToStream(
        streamId,
        (data) => {
          if (!mountedRef.current) return;
          
          addLog('Raw data received');
          setRawData(data);
          
          if (data && data.segments) {
            const segmentKeys = Object.keys(data.segments);
            addLog(`Found ${segmentKeys.length} segment keys: ${segmentKeys.join(', ')}`);
            
            // Build segment list
            const segmentList = [];
            segmentKeys.forEach(key => {
              const segment = data.segments[key];
              if (segment && segment.url) {
                segmentList.push({
                  key,
                  url: segment.url,
                  timestamp: segment.uploadedAt
                });
                addLog(`Segment ${key}: ${segment.url.substring(0, 50)}...`);
              }
            });
            
            setSegments(segmentList);
            
            // Try to use the latest segment
            if (segmentList.length > 0) {
              const latest = segmentList[segmentList.length - 1];
              addLog(`Setting current URL to segment ${latest.key}`);
              setCurrentUrl(latest.url);
            } else {
              addLog('No valid segments found');
            }
          } else {
            addLog('No segments in data');
          }
        }
      );
    }

    return () => {
      mountedRef.current = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [streamId]);

  return (
    <View style={[styles.container, style]}>
      {/* Video Area */}
      <View style={styles.videoArea}>
        {currentUrl ? (
          <UnifiedVideo
            source={{ uri: currentUrl }}
            style={styles.video}
            shouldPlay={true}
            volume={1.0}
            onLoad={() => addLog('Video loaded successfully')}
            onError={(error) => addLog(`Video error: ${error.message || 'Unknown'}`)}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              {streamId ? 'Waiting for video...' : 'No stream ID'}
            </Text>
          </View>
        )}
      </View>

      {/* Debug Info */}
      <View style={styles.debugPanel}>
        <ScrollView style={styles.logContainer}>
          <Text style={styles.debugTitle}>🐛 DEBUG INFO</Text>
          
          <Text style={styles.label}>Stream ID:</Text>
          <Text style={styles.value}>{streamId || 'None'}</Text>
          
          <Text style={styles.label}>Current URL:</Text>
          <Text style={styles.value}>
            {currentUrl ? currentUrl.substring(0, 60) + '...' : 'None'}
          </Text>
          
          <Text style={styles.label}>Available Segments:</Text>
          {segments.map((seg, idx) => (
            <Text key={idx} style={styles.value}>
              {seg.key}: {seg.url.substring(0, 40)}...
            </Text>
          ))}
          
          <Text style={styles.label}>Raw Data Keys:</Text>
          <Text style={styles.value}>
            {rawData ? Object.keys(rawData).join(', ') : 'None'}
          </Text>
          
          <Text style={styles.label}>Logs:</Text>
          {logs.map((log, idx) => (
            <Text key={idx} style={styles.logEntry}>
              {log}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  videoArea: {
    flex: 2,
    backgroundColor: '#111',
  },
  video: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: 'white',
    fontSize: 18,
  },
  debugPanel: {
    flex: 1,
    backgroundColor: '#222',
    padding: 10,
  },
  logContainer: {
    flex: 1,
  },
  debugTitle: {
    color: '#00ff00',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  label: {
    color: '#ffff00',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 5,
  },
  value: {
    color: 'white',
    fontSize: 11,
    marginBottom: 5,
  },
  logEntry: {
    color: '#ccc',
    fontSize: 10,
    marginBottom: 2,
  },
});

export default DebugLiveStreamViewer;