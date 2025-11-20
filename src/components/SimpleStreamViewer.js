/**
 * SimpleStreamViewer - Matches the simple LiveService.js implementation
 * 
 * This viewer watches the 'streams' collection (not 'liveStreams')
 * and displays a message about the stream status.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';

const SimpleStreamViewer = ({ streamId, onError, style }) => {
  const [streamData, setStreamData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!streamId) {
      setLoading(false);
      return;
    }

    console.log('📺 SimpleStreamViewer: Subscribing to stream:', streamId);

    // Subscribe to the 'streams' collection (not 'liveStreams')
    const streamRef = doc(db, 'streams', streamId);
    const unsubscribe = onSnapshot(
      streamRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          console.log('📺 Stream data received:', data);
          setStreamData(data);
          setLoading(false);

          if (data.status !== 'live') {
            console.log('⚠️ Stream is not live, status:', data.status);
            if (onError) {
              onError(new Error('Stream has ended'));
            }
          }
        } else {
          console.log('❌ Stream document does not exist:', streamId);
          setLoading(false);
          if (onError) {
            onError(new Error('Stream not found'));
          }
        }
      },
      (error) => {
        console.error('❌ Error subscribing to stream:', error);
        setLoading(false);
        if (onError) {
          onError(error);
        }
      }
    );

    return () => {
      console.log('📺 SimpleStreamViewer: Unsubscribing from stream');
      unsubscribe();
    };
  }, [streamId]);

  if (loading) {
    return (
      <View style={[styles.container, style]}>
        <ActivityIndicator size="large" color="#FF007A" />
        <Text style={styles.loadingText}>Loading stream...</Text>
      </View>
    );
  }

  if (!streamData) {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.errorText}>Stream not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderTitle}>📹 Live Stream</Text>
        <Text style={styles.placeholderText}>
          {streamData.title || 'Untitled Stream'}
        </Text>
        <Text style={styles.placeholderSubtext}>
          Status: {streamData.status}
        </Text>
        <Text style={styles.infoText}>
          🎥 Video playback: The broadcaster is recording segments.{'\n'}
          Full HLS playback requires HLSLiveStreamService integration.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    padding: 20,
    alignItems: 'center',
  },
  placeholderTitle: {
    color: '#FF007A',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  placeholderText: {
    color: 'white',
    fontSize: 18,
    marginBottom: 5,
    textAlign: 'center',
  },
  placeholderSubtext: {
    color: '#aaa',
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
  },
  infoText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  loadingText: {
    color: 'white',
    fontSize: 16,
    marginTop: 10,
  },
  errorText: {
    color: '#ff2d55',
    fontSize: 16,
  },
});

export default SimpleStreamViewer;
