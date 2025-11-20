import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView } from 'expo-camera';

const TestBroadcaster = ({ streamId, style }) => {
  return (
    <View style={[styles.container, style]}>
      {/* Camera */}
      <CameraView
        style={styles.camera}
        facing="front"
      />
      
      {/* MASSIVE OVERLAY THAT CANNOT BE MISSED */}
      <View style={styles.overlay}>
        <Text style={styles.title}>🔥 TEST BROADCASTER 🔥</Text>
        <Text style={styles.text}>Stream ID: {streamId}</Text>
        <Text style={styles.text}>Camera is working!</Text>
        <Text style={styles.text}>If you see this, the component loaded!</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'red',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: 'yellow',
    padding: 30,
    borderRadius: 10,
    borderWidth: 5,
    borderColor: 'red',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'black',
    textAlign: 'center',
    marginBottom: 20,
  },
  text: {
    fontSize: 18,
    color: 'black',
    textAlign: 'center',
    marginBottom: 10,
  },
});

export default TestBroadcaster;