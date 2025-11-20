/**
 * MINIMAL CAMERA TEST - To isolate the camera disappearing issue
 */
import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

const MinimalCameraTest = () => {
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [showOverlay, setShowOverlay] = useState(false);
  const [testState, setTestState] = useState('READY');
  const cameraRef = useRef(null);

  const runTest = async () => {
    console.log('🧪 STARTING MINIMAL CAMERA TEST');
    
    // Test 1: Just show overlay
    setTestState('TEST 1: OVERLAY');
    setShowOverlay(true);
    
    setTimeout(() => {
      // Test 2: Remove overlay
      setTestState('TEST 2: NO OVERLAY');
      setShowOverlay(false);
      
      setTimeout(() => {
        // Test 3: Show overlay again
        setTestState('TEST 3: OVERLAY AGAIN');
        setShowOverlay(true);
        
        setTimeout(() => {
          setTestState('TEST COMPLETE');
          setShowOverlay(false);
        }, 2000);
      }, 2000);
    }, 2000);
  };

  if (!cameraPermission) {
    return <View style={styles.container}><Text style={styles.text}>Loading...</Text></View>;
  }

  if (!cameraPermission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission required</Text>
        <TouchableOpacity style={styles.button} onPress={requestCamera}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* PERSISTENT CAMERA - NEVER UNMOUNTS */}
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="front"
        mode="video"
        onCameraReady={() => console.log('📷 Camera ready')}
        onMountError={(error) => console.error('❌ Camera error:', error)}
      />
      
      {/* TEST OVERLAY */}
      {showOverlay && (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>OVERLAY ACTIVE</Text>
        </View>
      )}
      
      {/* DEBUG INFO */}
      <View style={styles.debug}>
        <Text style={styles.debugText}>State: {testState}</Text>
        <Text style={styles.debugText}>Overlay: {showOverlay ? 'YES' : 'NO'}</Text>
        <TouchableOpacity style={styles.button} onPress={runTest}>
          <Text style={styles.buttonText}>RUN TEST</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

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
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  debug: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: 'rgba(255, 255, 0, 0.9)',
    padding: 10,
    borderRadius: 10,
  },
  debugText: {
    color: 'black',
    fontSize: 14,
    marginBottom: 5,
  },
  text: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#FF1744',
    padding: 10,
    borderRadius: 10,
    margin: 10,
  },
  buttonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
  },
});

export default MinimalCameraTest;