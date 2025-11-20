import React, { useState } from 'react';
import Icon from '../../../src/components/Icon';
import { View, Text, TouchableOpacity, TextInput, Alert, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { addFakeFollowers, getCurrentFollowerCount, removeFakeFollowers } from '../utils/boostFollowers';

/**
 * Debug component to boost followers for any user
 * Add this temporarily to any screen for quick follower boosting
 */
const FollowerBooster = ({ visible = false, onClose }) => {
  const [targetUserId, setTargetUserId] = useState('JvX9baS41LOSFKj7kx9T99obgVy1'); // Default to your user ID
  const [isLoading, setIsLoading] = useState(false);

  const boostFollowers = async (count) => {
    if (!targetUserId.trim()) {
      Alert.alert('Error', 'Please enter a valid user ID');
      return;
    }

    setIsLoading(true);
    try {
      console.log(`🚀 Boosting ${count} followers for user: ${targetUserId}`);
      
      const result = await addFakeFollowers(targetUserId, count);
      
      if (result.success) {
        Alert.alert(
          '🎉 Success!', 
          `Added ${result.addedCount} followers!\nNew total: ${result.newFollowerCount}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('❌ Error', result.error || 'Failed to add followers');
      }
    } catch (error) {
      Alert.alert('❌ Error', error.message);
    }
    setIsLoading(false);
  };

  const checkCurrentCount = async () => {
    if (!targetUserId.trim()) {
      Alert.alert('Error', 'Please enter a valid user ID');
      return;
    }

    try {
      const count = await getCurrentFollowerCount(targetUserId);
      Alert.alert('📊 Current Followers', `User has ${count} followers`);
    } catch (error) {
      Alert.alert('❌ Error', error.message);
    }
  };

  const cleanupFakeFollowers = async () => {
    if (!targetUserId.trim()) {
      Alert.alert('Error', 'Please enter a valid user ID');
      return;
    }

    setIsLoading(true);
    try {
      const result = await removeFakeFollowers(targetUserId);
      
      if (result.success) {
        Alert.alert('🧹 Cleanup Complete', `Removed ${result.removedCount} fake followers`);
      } else {
        Alert.alert('❌ Error', result.error || 'Failed to remove fake followers');
      }
    } catch (error) {
      Alert.alert('❌ Error', error.message);
    }
    setIsLoading(false);
  };

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#a855f7', '#d946ef', '#ec4899']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Text style={styles.title}>🚀 Follower Booster</Text>
          {onClose && (
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Icon  name="close" size={24} color="#fff"  />
            </TouchableOpacity>
          )}
        </View>
        
        <TextInput
          style={styles.input}
          placeholder="User ID"
          value={targetUserId}
          onChangeText={setTargetUserId}
          placeholderTextColor="#9ca3af"
        />

        <View style={styles.buttonRow}>
          <TouchableOpacity 
            style={[styles.button, styles.checkButton]} 
            onPress={checkCurrentCount}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Check Count</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.cleanupButton]} 
            onPress={cleanupFakeFollowers}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Cleanup</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity 
            style={[styles.button, styles.boostButton]} 
            onPress={() => boostFollowers(100)}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>+100</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.boostButton]} 
            onPress={() => boostFollowers(1000)}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>+1K</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.button, styles.boostButton]} 
            onPress={() => boostFollowers(10000)}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>+10K</Text>
          </TouchableOpacity>
        </View>

        {isLoading && <Text style={styles.loadingText}>⏳ Processing...</Text>}
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    zIndex: 9999,
    elevation: 9999,
  },
  gradient: {
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    right: 0,
    top: -2,
    padding: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: 'white',
    padding: 12,
    borderRadius: 8,
    width: '100%',
    marginBottom: 16,
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  button: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  boostButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  checkButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.8)',
  },
  cleanupButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.8)',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
  loadingText: {
    color: 'white',
    marginTop: 12,
    fontWeight: 'bold',
  },
});

export default FollowerBooster;