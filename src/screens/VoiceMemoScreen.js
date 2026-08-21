import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import ScreenContainer from '../components/ScreenContainer';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { COLORS } from '../styles/theme';
import { isLiveStagePublishing } from '../services/livePublishAudioGuard';

const VoiceMemoScreen = () => {
  const navigation = useNavigation();
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingUri, setRecordingUri] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sound, setSound] = useState(null);

  useEffect(() => {
    return sound
      ? () => {
          sound.unloadAsync();
        }
      : undefined;
  }, [sound]);

  const startRecording = async () => {
    try {
      // Soft-fail while Stage mic is open — setAudioModeAsync would yank IVS call audio.
      if (isLiveStagePublishing()) {
        Alert.alert('Unavailable', 'Voice memo is unavailable while you are live.');
        return;
      }

      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Please grant microphone permissions');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording', err);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    
    const uri = recording.getURI();
    setRecordingUri(uri);
    setRecording(null);
    // Drop PlayAndRecord so later chat / UI sounds use the loudspeaker.
    try {
      // eslint-disable-next-line global-require
      const { ensureMediaPlaybackAudioMode } = require('../services/notifySound');
      await ensureMediaPlaybackAudioMode({ background: false });
    } catch {
      // Same latch as ensureMediaPlaybackAudioMode — never reclaim media mode mid-publish.
      if (isLiveStagePublishing()) return;
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          playThroughEarpieceAndroid: false,
        });
      } catch {
        // ignore
      }
    }
  };

  const playRecording = async () => {
    if (!recordingUri) return;

    try {
      setIsPlaying(true);
      try {
        // eslint-disable-next-line global-require
        const { ensureMediaPlaybackAudioMode } = require('../services/notifySound');
        await ensureMediaPlaybackAudioMode({ background: false });
      } catch {
        if (!isLiveStagePublishing()) {
          await Audio.setAudioModeAsync({
            allowsRecordingIOS: false,
            playsInSilentModeIOS: true,
            playThroughEarpieceAndroid: false,
          });
        }
      }
      const { sound } = await Audio.Sound.createAsync({ uri: recordingUri });
      setSound(sound);
      
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          setIsPlaying(false);
        }
      });
      
      await sound.playAsync();
    } catch (error) {
      console.error('Error playing sound:', error);
      setIsPlaying(false);
    }
  };

  const stopPlaying = async () => {
    if (sound) {
      await sound.stopAsync();
      setIsPlaying(false);
    }
  };

  const saveVoiceMemo = () => {
    if (recordingUri) {
      // Navigate to review screen with voice memo
      navigation.navigate('Review', { 
        media: { uri: recordingUri }, 
        type: 'audio' 
      });
    }
  };

  const deleteRecording = () => {
    setRecordingUri(null);
    setIsRecording(false);
    if (sound) {
      sound.unloadAsync();
      setSound(null);
    }
  };

  return (
    <ScreenContainer noSafeArea={true} style={styles.screenContainer}>
      <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon  name="close" size={24} color="#9ca3af"  />
        </TouchableOpacity>
        <Text style={styles.statusText}>
          {isRecording ? 'Recording...' : recordingUri ? 'Ready!' : 'Tap to record'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.promptText}>
          {isRecording ? 'Recording your voice memo...' : 'Tap to remember...'}
        </Text>

        <View style={styles.recordingContainer}>
          {/* Pulse animation rings */}
          {!recordingUri && (
            <View style={styles.pulseContainer}>
              <View style={[styles.pulseRing, styles.pulseRing1]} />
              <View style={[styles.pulseRing, styles.pulseRing2]} />
              <View style={[styles.pulseRing, styles.pulseRing3]} />
            </View>
          )}

          {/* Main record button */}
          <TouchableOpacity
            style={[
              styles.recordButton,
              isRecording && styles.recordButtonActive
            ]}
            onPress={isRecording ? stopRecording : startRecording}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={isRecording ? ['#ef4444', '#dc2626'] : ['#FF2D55', '#FF2D55', '#E01E45']}
              style={styles.recordGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Icon  
                name={isRecording ? 'stop' : 'mic'} 
                size={48} 
                color={isRecording ? 'white' : '#0A0A0C'} 
               />
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Playback controls */}
        {recordingUri && (
          <View style={styles.playbackContainer}>
            <TouchableOpacity
              style={styles.playButton}
              onPress={isPlaying ? stopPlaying : playRecording}
            >
              <Icon  
                name={isPlaying ? 'pause' : 'play'} 
                size={32} 
                color="#FF2D55" 
               />
            </TouchableOpacity>
            
            <View style={styles.playbackActions}>
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={deleteRecording}
              >
                <Icon  name="trash-outline" size={24} color="#ef4444"  />
                <Text style={styles.actionText}>Delete</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.actionButton}
                onPress={saveVoiceMemo}
              >
                <Icon  name="checkmark" size={24} color="#10b981"  />
                <Text style={styles.actionText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  screenContainer: {
    paddingTop: 0,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  statusText: {
    color: '#6b7280',
    fontSize: 14,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  promptText: {
    color: '#9ca3af',
    fontSize: 24,
    fontWeight: '300',
    textAlign: 'center',
    marginBottom: 60,
  },
  recordingContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
  },
  pulseContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    borderRadius: 100,
    borderWidth: 2,
    borderColor: '#FF2D55',
  },
  pulseRing1: {
    width: 120,
    height: 120,
    opacity: 0.6,
  },
  pulseRing2: {
    width: 160,
    height: 160,
    opacity: 0.4,
  },
  pulseRing3: {
    width: 200,
    height: 200,
    opacity: 0.2,
  },
  recordButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  recordButtonActive: {
    transform: [{ scale: 1.1 }],
  },
  recordGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playbackContainer: {
    alignItems: 'center',
    width: '100%',
  },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#141418',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: 2,
    borderColor: '#FF2D55',
  },
  playbackActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    maxWidth: 300,
  },
  actionButton: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  actionText: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 4,
    fontWeight: '600',
  },
});

export default VoiceMemoScreen;