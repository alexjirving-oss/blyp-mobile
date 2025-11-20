/**
 * Example: How to integrate live streaming into your app
 * 
 * This shows how to add "Go Live" buttons and display active streams
 */

import React, { useState, useEffect, useRef } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  Animated,
  Easing,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import HLSLiveStreamService from '../services/HLSLiveStreamService';

/**
 * Example 1: "Go Live" Button for Profile Screen
 */
export const GoLiveButton = () => {
  const navigation = useNavigation();
  
  return (
    <TouchableOpacity
      style={styles.goLiveButton}
      onPress={() => {
        const t0 = Date.now();
        console.log('[METRIC][T0_startBroadcastPressed]', new Date(t0).toISOString(), { t0 });
        navigation.navigate('LiveStreamScreen', { isCreator: true, __t0: t0 });
      }}
    >
      <Icon  name="radio" size={20} color="white"  />
      <Text style={styles.goLiveText}>Go Live</Text>
    </TouchableOpacity>
  );
};

/**
 * Example 2: Live Streams Feed Component
 * Shows currently active streams
 */
// Simple Shimmer placeholder block
const Shimmer = ({ height = 100, width = 160, borderRadius = 12, style }) => {
  const translateX = useRef(new Animated.Value(-150)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(translateX, {
        toValue: 150,
        duration: 1100,
        easing: Easing.inOut(Easing.linear),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [translateX]);
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#1f2937', height, width, borderRadius }, style]}>
      <Animated.View
        style={{
          position: 'absolute',
          left: -150,
          top: 0,
          bottom: 0,
          width: 150,
          transform: [{ translateX }],
          backgroundColor: 'rgba(255,255,255,0.08)',
        }}
      />
    </View>
  );
};

export const LiveStreamsFeed = ({ onMeasured }) => {
  const navigation = useNavigation();
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLiveStreams = async () => {
    try {
      const activeStreams = await HLSLiveStreamService.getActiveStreams(10);
      setStreams(activeStreams || []);
    } catch (e) {
      console.log('LiveStreamsFeed fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveStreams();
    const id = setInterval(fetchLiveStreams, 10000);
    return () => clearInterval(id);
  }, []);

  // Hide entirely if no streams (no layout gap)
  if (!loading && streams.length === 0) return null;

  const openStream = (streamId) => navigation.navigate('LiveStreamScreen', { streamId });

  return (
    <View style={styles.container} onLayout={(e) => { const h = e.nativeEvent.layout.height; onMeasured && onMeasured(h); }}>
      <Text style={styles.sectionTitle}>🔴 Live Now</Text>
      {loading ? (
        <View style={{ flexDirection: 'row', gap: 12, paddingLeft: 16 }}>
          <Shimmer />
          <Shimmer />
          <Shimmer />
        </View>
      ) : (
        <FlatList
          data={streams}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingRight: 16 }}
          ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.streamCard}
              onPress={() => openStream(item.id)}
              activeOpacity={0.9}
            >
              <Image
                source={{ uri: item.thumbnailUrl || 'https://via.placeholder.com/300x169' }}
                style={styles.thumbnail}
              />
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
              <View style={styles.streamInfo}>
                <Text style={styles.streamTitle} numberOfLines={2}>{item.title || 'Live stream'}</Text>
                <View style={styles.streamMeta}>
                  <View style={styles.viewerCount}>
                    <Icon  name="eye" size={12} color="#999"  />
                    <Text style={styles.metaText}>{item.viewCount || 0} watching</Text>
                  </View>
                </View>
                <Text style={styles.broadcasterName} numberOfLines={1}>{item.userDisplayName || 'Anonymous'}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
};

/**
 * Example 3: Add to Home Screen
 * 
 * In your HomeScreen.js:
 * 
 * import { LiveStreamsFeed, GoLiveButton } from './path/to/LiveStreamExamples';
 * 
 * Then in your render:
 * 
 * <View>
 *   <LiveStreamsFeed />
 *   <GoLiveButton />
 *   {/* Your other home screen content *\/}
 * </View>
 */

const styles = StyleSheet.create({
  // Go Live Button
  goLiveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF1744',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    gap: 8,
  },
  goLiveText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // Live Streams Feed
  container: {
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  loadingText: {
    color: '#999',
    fontSize: 14,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    marginTop: 12,
  },
  streamCard: {
    width: 280,
    marginLeft: 16,
    borderRadius: 12,
    backgroundColor: '#1a1a2e',
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: 157, // 16:9 aspect ratio
    backgroundColor: '#000',
  },
  liveBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 4,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'white',
  },
  liveText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  streamInfo: {
    padding: 12,
  },
  streamTitle: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  streamMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  viewerCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: '#999',
    fontSize: 11,
  },
  broadcasterName: {
    color: '#666',
    fontSize: 11,
  },
});
