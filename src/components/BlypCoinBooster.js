import React, { useState } from 'react';
import Icon from './Icon';
import { 
  View, 
  Text, 
  TouchableOpacity, 
  TextInput, 
  Alert, 
  StyleSheet
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import BlypCoinService from '../services/BlypCoinService';
import { auth } from '../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { firestore as db } from '../config/firebase';

/**
 * Developer component to add Blypcoins to any user's balance
 * Triggered by developer code 369
 */
const BlypCoinBooster = ({ visible = false, onClose }) => {
  const [targetUsername, setTargetUsername] = useState('');
  const [coinAmount, setCoinAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Function to find user ID by username
  const findUserByUsername = async (username) => {
    try {
      // Remove @ if present
      const cleanUsername = username.replace('@', '');
      
      // Query users collection by username
      const usersRef = collection(db, 'users');
      const q = query(usersRef, where('username', '==', cleanUsername));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const userDoc = querySnapshot.docs[0];
        return {
          success: true,
          userId: userDoc.id,
          userData: userDoc.data()
        };
      } else {
        return {
          success: false,
          error: `User '${username}' not found`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Error searching for user: ${error.message}`
      };
    }
  };

  const handleAddCoins = async () => {
    if (!targetUsername.trim()) {
      Alert.alert('Error', 'Please enter a username');
      return;
    }

    if (!coinAmount.trim() || isNaN(coinAmount) || parseInt(coinAmount) <= 0) {
      Alert.alert('Error', 'Please enter a valid coin amount');
      return;
    }

    const coins = parseInt(coinAmount);
    if (coins > 1000000) {
      Alert.alert('Error', 'Maximum amount is 1,000,000 coins');
      return;
    }

    setIsLoading(true);
    try {
      // Find user by username
      const userResult = await findUserByUsername(targetUsername);
      
      if (!userResult.success) {
        Alert.alert('❌ User Not Found', userResult.error);
        setIsLoading(false);
        return;
      }

      // Get current balance
      const currentBalance = await BlypCoinService.getUserBalance(userResult.userId);
      
      // Add coins using BlypCoinService
      await BlypCoinService.addCoinsToUser(
        userResult.userId, 
        coins, 
        'Developer Addition',
        {
          addedBy: auth.currentUser?.uid,
          addedByUsername: 'Developer',
          timestamp: new Date().toISOString()
        }
      );
      
      const newBalance = currentBalance + coins;
      
      Alert.alert(
        '🎉 Coins Added Successfully!', 
        `Added ${coins.toLocaleString()} Blypcoins to @${userResult.userData.username}\n\n` +
        `Previous Balance: ${currentBalance.toLocaleString()}\n` +
        `New Balance: ${newBalance.toLocaleString()}`,
        [{ 
          text: 'OK', 
          onPress: () => {
            setTargetUsername('');
            setCoinAmount('');
          }
        }]
      );
      
    } catch (error) {
      console.error('Error adding coins:', error);
      Alert.alert('❌ Error', error.message || 'Failed to add coins');
    }
    setIsLoading(false);
  };

  const checkUserBalance = async () => {
    if (!targetUsername.trim()) {
      Alert.alert('Error', 'Please enter a username');
      return;
    }

    setIsLoading(true);
    try {
      // Find user by username
      const userResult = await findUserByUsername(targetUsername);
      
      if (!userResult.success) {
        Alert.alert('❌ User Not Found', userResult.error);
        setIsLoading(false);
        return;
      }

      // Get current balance
      const balance = await BlypCoinService.getUserBalance(userResult.userId);
      
      Alert.alert(
        '💰 Current Balance', 
        `@${userResult.userData.username} has ${balance.toLocaleString()} Blypcoins`
      );
      
    } catch (error) {
      console.error('Error checking balance:', error);
      Alert.alert('❌ Error', 'Failed to check balance');
    }
    setIsLoading(false);
  };

  const presetAmounts = [100, 500, 1000, 5000, 10000, 50000];

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#a855f7', '#d946ef', '#ec4899']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Text style={styles.title}>💰 Blypcoin Booster</Text>
          {onClose && (
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Icon  name="close" size={24} color="#fff"  />
            </TouchableOpacity>
          )}
        </View>
        
        <TextInput
          style={styles.input}
          placeholder="Username (with or without @)"
          value={targetUsername}
          onChangeText={setTargetUsername}
          placeholderTextColor="#9ca3af"
          autoCapitalize="none"
          editable={!isLoading}
        />
        
        <TextInput
          style={styles.input}
          placeholder="Coin Amount"
          value={coinAmount}
          onChangeText={setCoinAmount}
          placeholderTextColor="#9ca3af"
          keyboardType="numeric"
          editable={!isLoading}
        />

        <View style={styles.presetContainer}>
          <View style={styles.presetGrid}>
            {presetAmounts.map((amount) => (
              <TouchableOpacity
                key={amount}
                style={styles.presetButton}
                onPress={() => setCoinAmount(amount.toString())}
                disabled={isLoading}
              >
                <Text style={styles.presetText}>{amount.toLocaleString()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.checkButton]}
            onPress={checkUserBalance}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Check Balance</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.boostButton]}
            onPress={handleAddCoins}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Add Coins</Text>
          </TouchableOpacity>
        </View>

        {isLoading && (
          <Text style={styles.loadingText}>Processing...</Text>
        )}
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
  presetContainer: {
    width: '100%',
    marginBottom: 16,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  presetButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  presetText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
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

export default BlypCoinBooster;