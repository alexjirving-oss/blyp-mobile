import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';

export default function AudioTile({ uri, user, title, style, autoPlay = false, shouldLoad = true }) {
  const soundRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadSound = useCallback(async () => {
    if (!shouldLoad || !uri) return;
    try {
      setIsLoading(true);
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: autoPlay });
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        setIsPlaying(status.isPlaying);
      });
      soundRef.current = sound;
    } catch (e) {
      console.log('🔊 Audio load error:', e?.message || e);
    } finally {
      setIsLoading(false);
    }
  }, [uri, autoPlay, shouldLoad]);

  const unloadSound = useCallback(async () => {
    try {
      await soundRef.current?.unloadAsync();
      soundRef.current = null;
    } catch {}
  }, []);

  useEffect(() => {
    loadSound();
    return () => {
      unloadSound();
    };
  }, [loadSound, unloadSound]);

  const togglePlay = async () => {
    try {
      if (!soundRef.current) return;
      if (isPlaying) await soundRef.current.pauseAsync();
      else await soundRef.current.playAsync();
    } catch (e) {
      console.log('🔊 Audio toggle error:', e?.message || e);
    }
  };

  if (!uri) return null;

  return (
    <View style={[styles.container, style]}> 
      <View style={styles.card}> 
        <View style={styles.header}> 
          <Image source={{ uri: user?.avatar || user?.photoURL }} style={styles.avatar} />
          <View style={{ flex: 1 }}>
            <Text style={styles.username} numberOfLines={1}>@{user?.username || 'user'}</Text>
            {!!title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
          </View>
        </View>
        <TouchableOpacity style={styles.player} activeOpacity={0.8} onPress={togglePlay}>
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.playText}>{isPlaying ? 'Pause' : 'Play'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  card: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { position: 'absolute', top: 24, left: 16, right: 16, flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, marginRight: 10 },
  username: { color: '#fff', fontWeight: 'bold' },
  title: { color: '#ddd', fontSize: 12 },
  player: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  playText: { color: '#fff', fontWeight: 'bold' }
});