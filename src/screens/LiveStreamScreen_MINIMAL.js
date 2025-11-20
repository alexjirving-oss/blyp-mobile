import React, { useState } from 'react';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation } from '@react-navigation/native';

const LiveStreamScreen = () => {
  const navigation = useNavigation();
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isLive, setIsLive] = useState(false);

  const startStreaming = async () => {
    if (!title.trim()) {
      Alert.alert('Title Required', 'Please enter a title for your stream.');
      return;
    }

    try {
      // Request camera permission if needed
      if (!cameraPermission?.granted) {
        const result = await requestCamera();
        if (!result.granted) {
          Alert.alert('Camera Permission Required', 'Camera access is needed for live streaming.');
          return;
        }
      }

      // Simple transition to "live" state
      setIsLive(true);
      Alert.alert('Success', 'Live stream started! (Minimal version - streaming will be added later)');
      
    } catch (error) {
      console.error('Error starting stream:', error);
      Alert.alert('Error', 'Failed to start stream. Please try again.');
    }
  };

  const stopStreaming = () => {
    setIsLive(false);
    Alert.alert('Stream Ended', 'Your live stream has ended.');
  };

  if (isLive) {
    // Live streaming view
    return (
      <View style={styles.container}>
        <View style={styles.videoContainer}>
          {cameraPermission?.granted ? (
            <CameraView 
              style={styles.camera} 
              facing="front"
              mode="video"
            />
          ) : (
            <View style={styles.permissionContainer}>
              <Text style={styles.permissionText}>Camera permission needed</Text>
              <TouchableOpacity onPress={requestCamera} style={styles.permissionButton}>
                <Text style={styles.permissionButtonText}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          )}
          
          {/* Live indicator */}
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>

          {/* Stream info */}
          <View style={styles.streamInfo}>
            <Text style={styles.streamTitle}>{title}</Text>
            {description ? <Text style={styles.streamDescription}>{description}</Text> : null}
          </View>

          {/* End stream button */}
          <TouchableOpacity style={styles.endButton} onPress={stopStreaming}>
            <Text style={styles.endButtonText}>End Stream</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Setup view (before going live)
  return (
    <View style={styles.container}>
      <View style={styles.videoContainer}>
        {/* Camera preview */}
        {cameraPermission?.granted ? (
          <CameraView 
            style={styles.camera} 
            facing="front"
            mode="video"
          />
        ) : (
          <View style={styles.permissionContainer}>
            <Text style={styles.permissionText}>Camera permission needed</Text>
            <TouchableOpacity onPress={requestCamera} style={styles.permissionButton}>
              <Text style={styles.permissionButtonText}>Grant Permission</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Setup overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={styles.setupOverlay}
        >
          <Text style={styles.setupTitle}>Go Live</Text>
          
          {/* Title input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Stream Title *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="What's happening?"
              placeholderTextColor="#666"
              value={title}
              onChangeText={setTitle}
              maxLength={100}
            />
          </View>

          {/* Description input */}
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              placeholder="Tell viewers what to expect..."
              placeholderTextColor="#666"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              maxLength={300}
            />
          </View>

          {/* Go Live button */}
          <TouchableOpacity
            style={[styles.goLiveButton, !title.trim() && styles.goLiveButtonDisabled]}
            onPress={startStreaming}
            disabled={!title.trim()}
          >
            <LinearGradient
              colors={title.trim() ? ['#FF1744', '#F50057'] : ['#333', '#444']}
              style={styles.goLiveGradient}
            >
              <Icon  name="radio" size={24} color="white"  />
              <Text style={styles.goLiveText}>Go Live</Text>
            </LinearGradient>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  videoContainer: {
    flex: 1,
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  permissionText: {
    color: 'white',
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  permissionButton: {
    backgroundColor: '#FF1744',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 25,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  setupOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
  },
  setupTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  inputContainer: {
    marginBottom: 15,
  },
  inputLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 5,
  },
  textInput: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    padding: 15,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  goLiveButton: {
    marginTop: 20,
    borderRadius: 25,
    overflow: 'hidden',
  },
  goLiveButtonDisabled: {
    opacity: 0.5,
  },
  goLiveGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    paddingHorizontal: 30,
  },
  goLiveText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  liveIndicator: {
    position: 'absolute',
    top: 40,
    left: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,23,68,0.9)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 15,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
    marginRight: 5,
  },
  liveText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  streamInfo: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
  },
  streamTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  streamDescription: {
    color: 'white',
    fontSize: 14,
    opacity: 0.8,
  },
  endButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  endButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default LiveStreamScreen;