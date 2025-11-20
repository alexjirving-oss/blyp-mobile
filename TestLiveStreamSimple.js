import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { auth } from './src/config/firebase';

const TestLiveStreamSimple = () => {
  const [title, setTitle] = useState('');

  const testStartStreaming = async () => {
    try {
      console.log('🧪 TEST: Starting streaming test...');
      
      if (!title.trim()) {
        Alert.alert('Title Required', 'Please enter a title for your stream.');
        return;
      }
      
      console.log('🧪 TEST: Title validated:', title);
      
      // Check auth
      if (!auth.currentUser) {
        Alert.alert('Authentication Error', 'You must be logged in to start a stream.');
        return;
      }
      
      console.log('🧪 TEST: User authenticated:', auth.currentUser.uid);
      
      // Try to import HLS service
      console.log('🧪 TEST: About to import HLSLiveStreamService...');
      const HLSLiveStreamService = require('./src/services/HLSLiveStreamService').default;
      console.log('🧪 TEST: HLS Service imported:', !!HLSLiveStreamService);
      
      // Try to create stream
      console.log('🧪 TEST: Attempting to create stream...');
      const result = await HLSLiveStreamService.createStream({
        title: title.trim(),
        description: 'Test stream',
        thumbnailFile: null,
      });
      
      console.log('🧪 TEST: Stream creation result:', result);
      Alert.alert('Success!', `Stream created: ${result?.streamId || 'Unknown ID'}`);
      
    } catch (error) {
      console.error('🧪 TEST ERROR:', error);
      Alert.alert('Test Failed', `Error: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Live Stream Test</Text>
      <TextInput
        style={styles.input}
        placeholder="Stream Title"
        value={title}
        onChangeText={setTitle}
      />
      <TouchableOpacity style={styles.button} onPress={testStartStreaming}>
        <Text style={styles.buttonText}>Test Go Live</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 24,
    textAlign: 'center',
    marginBottom: 30,
  },
  input: {
    backgroundColor: '#333',
    color: '#fff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#ff1744',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default TestLiveStreamSimple;