import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  Animated,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { doc, getDoc } from 'firebase/firestore';
import { auth, firestore as db } from '../config/firebase';
import BlypCoinService from '../services/BlypCoinService';

const { width } = Dimensions.get('window');

const DailyRewards = () => {
  const [canClaim, setCanClaim] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pulseAnimation] = useState(new Animated.Value(1));
  const currentUser = auth.currentUser;

  useEffect(() => {
    checkDailyReward();
    
    // Start pulse animation if reward is available
    if (canClaim) {
      startPulseAnimation();
    }
  }, [canClaim]);

  const startPulseAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnimation, {
          toValue: 1.2,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  };

  const checkDailyReward = async () => {
    if (!currentUser) return;
    
    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        const lastCheckIn = userData.lastCheckIn?.toDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Check if can claim today
        const canClaimToday = !lastCheckIn || lastCheckIn < today;
        setCanClaim(canClaimToday);
        
        // Calculate current streak
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        let currentStreak = userData.checkInStreak || 0;
        if (lastCheckIn && lastCheckIn >= yesterday && !canClaimToday) {
          // Already claimed today, show current streak
          setStreak(currentStreak);
        } else if (canClaimToday) {
          // Can claim today, show potential streak
          if (lastCheckIn && lastCheckIn >= yesterday) {
            setStreak(currentStreak + 1);
          } else {
            setStreak(1); // Will reset to 1
          }
        }
      }
    } catch (error) {
      console.error('Error checking daily reward:', error);
    }
  };

  const claimDailyReward = async () => {
    if (!currentUser || !canClaim) return;
    
    setLoading(true);
    try {
      const result = await BlypCoinService.claimDailyReward(currentUser.uid);
      
      Alert.alert(
        '🎉 Daily Reward Claimed!',
        `You earned ${result.reward} Blypcoins!\n\nStreak: ${result.streak} days\n\n` +
        `🎯 Keep your streak going for bigger rewards!`,
        [{ text: 'Awesome!', style: 'default' }]
      );
      
      setCanClaim(false);
      setStreak(result.streak);
      setShowModal(false);
      
    } catch (error) {
      if (error.message === 'Daily reward already claimed') {
        Alert.alert('Already Claimed', 'Come back tomorrow for your next reward! ⏰');
      } else {
        Alert.alert('Error', 'Failed to claim reward. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getStreakReward = (streakDays) => {
    const baseReward = 10;
    const streakBonus = Math.min(streakDays * 2, 50);
    return baseReward + streakBonus;
  };

  const getStreakBadge = (streakDays) => {
    if (streakDays >= 30) return '💎';
    if (streakDays >= 14) return '🔥';
    if (streakDays >= 7) return '⭐';
    if (streakDays >= 3) return '🌟';
    return '✨';
  };

  if (!canClaim) {
    return null; // Don't show if no reward available
  }

  return (
    <>
      <Animated.View style={[styles.rewardButton, { transform: [{ scale: pulseAnimation }] }]}>
        <TouchableOpacity
          onPress={() => setShowModal(true)}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={['#fbbf24', '#f59e0b', '#d97706']}
            style={styles.buttonGradient}
          >
            <Icon  name="gift" size={20} color="#fff"  />
            <Text style={styles.buttonText}>Daily Reward</Text>
            <View style={styles.notificationDot} />
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={showModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <LinearGradient
              colors={['#1e293b', '#334155', '#475569']}
              style={styles.modalGradient}
            >
              {/* Header */}
              <View style={styles.modalHeader}>
                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => setShowModal(false)}
                >
                  <Icon  name="close" size={24} color="#fff"  />
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Daily Reward</Text>
                <View style={styles.placeholder} />
              </View>

              {/* Reward Display */}
              <View style={styles.rewardDisplay}>
                <Text style={styles.rewardEmoji}>🎁</Text>
                <Text style={styles.rewardAmount}>{getStreakReward(streak)}</Text>
                <Text style={styles.coinLabel}>Blypcoins</Text>
                
                <View style={styles.streakInfo}>
                  <Text style={styles.streakBadge}>{getStreakBadge(streak)}</Text>
                  <Text style={styles.streakText}>
                    Day {streak} Streak
                  </Text>
                </View>
                
                <Text style={styles.streakDescription}>
                  Keep your streak alive for bigger rewards!
                </Text>
              </View>

              {/* Streak Calendar Preview */}
              <View style={styles.calendarPreview}>
                <Text style={styles.calendarTitle}>Upcoming Rewards</Text>
                <View style={styles.calendarRow}>
                  {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                    <View key={day} style={[
                      styles.calendarDay,
                      day === 1 && styles.todayDay
                    ]}>
                      <Text style={styles.dayNumber}>{day}</Text>
                      <Text style={styles.dayReward}>
                        {getStreakReward(streak + day - 1)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Claim Button */}
              <TouchableOpacity
                style={[styles.claimButton, loading && styles.claimButtonDisabled]}
                onPress={claimDailyReward}
                disabled={loading}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={loading ? ['#64748b', '#94a3b8'] : ['#10b981', '#059669']}
                  style={styles.claimGradient}
                >
                  <Text style={styles.claimButtonText}>
                    {loading ? 'Claiming...' : 'Claim Reward'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  rewardButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 1000,
  },
  buttonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    gap: 6,
    position: 'relative',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  notificationDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: width * 0.9,
    borderRadius: 20,
    overflow: 'hidden',
  },
  modalGradient: {
    padding: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  closeButton: {
    padding: 4,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  placeholder: {
    width: 32,
  },
  rewardDisplay: {
    alignItems: 'center',
    padding: 30,
  },
  rewardEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  rewardAmount: {
    color: '#fbbf24',
    fontSize: 48,
    fontWeight: '800',
    marginBottom: 4,
  },
  coinLabel: {
    color: '#fff',
    fontSize: 18,
    opacity: 0.8,
    marginBottom: 20,
  },
  streakInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  streakBadge: {
    fontSize: 24,
  },
  streakText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  streakDescription: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
  },
  calendarPreview: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  calendarTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  calendarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  calendarDay: {
    alignItems: 'center',
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    minWidth: 40,
  },
  todayDay: {
    backgroundColor: '#fbbf24',
  },
  dayNumber: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  dayReward: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '500',
  },
  claimButton: {
    margin: 20,
    borderRadius: 16,
    overflow: 'hidden',
  },
  claimButtonDisabled: {
    opacity: 0.6,
  },
  claimGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  claimButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});

export default DailyRewards;