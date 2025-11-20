import React, { useEffect, useState } from 'react';
import { View, Text, Button, Alert } from 'react-native';
import { auth, db, storage } from '../config/firebase';

const FirebaseTestScreen = () => {
  const [testResults, setTestResults] = useState({
    auth: 'Testing...',
    firestore: 'Testing...',
    storage: 'Testing...'
  });

  const testFirebaseConnection = async () => {
    const results = { ...testResults };
    
    // Test Auth
    try {
      const currentUser = auth.currentUser;
      results.auth = currentUser ? `✅ Auth: ${currentUser.email}` : '⚠️ Auth: Not signed in';
    } catch (error) {
      results.auth = `❌ Auth Error: ${error.message}`;
    }

    // Test Firestore
    try {
      const testDoc = await db.collection('test').add({
        message: 'React Native Firebase Test',
        timestamp: new Date()
      });
      await testDoc.delete(); // Clean up
      results.firestore = '✅ Firestore: Connection working';
    } catch (error) {
      results.firestore = `❌ Firestore Error: ${error.message}`;
    }

    // Test Storage
    try {
      const storageRef = storage().ref('test/test-file.txt');
      // Just test reference creation, don't actually upload
      results.storage = '✅ Storage: Reference created successfully';
    } catch (error) {
      results.storage = `❌ Storage Error: ${error.message}`;
    }

    setTestResults(results);
  };

  useEffect(() => {
    testFirebaseConnection();
  }, []);

  const testUpload = async () => {
    try {
      Alert.alert('Upload Test', 'This would test file upload - implement after dev client is ready');
    } catch (error) {
      Alert.alert('Upload Error', error.message);
    }
  };

  return (
    <View style={{ padding: 20, paddingTop: 60 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 20 }}>
        🧪 Firebase Connection Test
      </Text>
      
      <Text style={{ fontSize: 16, marginBottom: 10 }}>
        {testResults.auth}
      </Text>
      <Text style={{ fontSize: 16, marginBottom: 10 }}>
        {testResults.firestore}
      </Text>
      <Text style={{ fontSize: 16, marginBottom: 20 }}>
        {testResults.storage}
      </Text>
      
      <Button title="🔄 Retest Connection" onPress={testFirebaseConnection} />
      <View style={{ marginTop: 10 }} />
      <Button title="📤 Test Upload" onPress={testUpload} />
    </View>
  );
};

export default FirebaseTestScreen;