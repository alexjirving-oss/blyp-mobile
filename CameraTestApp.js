/**
 * CAMERA TEST APP - Direct replacement for App.js to isolate camera bug
 * This replaces the entire app to test only camera functionality
 */

import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

export default function CameraTestApp() {
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraRef = useRef(null);

  // Request permission if not granted
  React.useEffect(() => {
    if (!cameraPermission?.granted) {
      requestCamera();
    }
  }, []);

  if (!cameraPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Requesting camera permissions...</Text>
      </View>
    );
  }

  if (!cameraPermission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission not granted</Text>
        <TouchableOpacity onPress={requestCamera} style={styles.button}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* SINGLE PERSISTENT CAMERA - NEVER UNMOUNTS */}
      <CameraView 
        ref={cameraRef}
        style={styles.camera} 
        facing="front"
        mode="video"
        onCameraReady={() => {
          console.log('📷 TEST Camera is ready');
          setCameraReady(true);
        }}
        onMountError={(error) => {
          console.error('❌ TEST Camera mount error:', error);
          setCameraReady(false);
        }}
      />
      
      {/* SIMPLE OVERLAY TEST */}
      {overlayVisible && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>OVERLAY IS ON</Text>
          <Text style={styles.overlayText}>Camera should still be visible</Text>
        </View>
      )}
      
      {/* DEBUG INFO */}
      <View style={styles.debugOverlay}>
        <Text style={styles.debugText}>🔬 MINIMAL CAMERA TEST 🔬</Text>
        <Text style={styles.debugText}>Camera Ready: {cameraReady ? 'YES ✅' : 'NO ❌'}</Text>
        <Text style={styles.debugText}>Overlay: {overlayVisible ? 'ON' : 'OFF'}</Text>
        <Text style={styles.debugText}>If camera disappears when overlay turns on,</Text>
        <Text style={styles.debugText}>this is an Expo Camera + React overlay bug</Text>
      </View>
      
      {/* TOGGLE BUTTON */}
      <View style={styles.controls}>
        <TouchableOpacity 
          style={styles.toggleButton} 
          onPress={() => {
            console.log('🔄 Toggling overlay from', overlayVisible, 'to', !overlayVisible);
            setOverlayVisible(!overlayVisible);
          }}
        >
          <Text style={styles.toggleText}>
            {overlayVisible ? 'HIDE OVERLAY' : 'SHOW OVERLAY'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 0, 0, 0.7)', // Red overlay
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  debugOverlay: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 255, 0, 0.9)',
    padding: 15,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'blue',
  },
  debugText: {
    color: 'black',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  controls: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toggleButton: {
    backgroundColor: '#FF1744',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  toggleText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  text: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#FF1744',
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});