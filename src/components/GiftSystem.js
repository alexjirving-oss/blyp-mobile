import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Animated,
  Dimensions,
  Easing,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { auth } from '../config/firebase';
import BlypCoinService from '../services/BlypCoinService';

const { width } = Dimensions.get('window');

const GiftSystem = ({ postId, creatorId, creatorName }) => {
  const [showGiftModal, setShowGiftModal] = useState(false);
    const [userBalance, setUserBalance] = useState(0);
  const [gifts, setGifts] = useState([]);

  const [selectedGift, setSelectedGift] = useState(null);
  const [sending, setSending] = useState(false);
  const [giftAnimation] = useState(new Animated.Value(0));
  
  // Disney Pixar-quality heart animation states
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const heartScale = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const heartRotation = useRef(new Animated.Value(0)).current;
  const heartY = useRef(new Animated.Value(0)).current;
  const sparkles = useRef(Array.from({length: 12}, () => ({
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    scale: new Animated.Value(0),
    opacity: new Animated.Value(0),
    rotation: new Animated.Value(0)
  }))).current;
  
  const currentUser = auth.currentUser;

  // Ensure creatorName is always a string
  const getCreatorName = () => {
    // If it's already a string, return as is
    if (typeof creatorName === 'string') {
      return creatorName.startsWith('@') ? creatorName : `@${creatorName}`;
    }
    // If it's an object with username property
    if (typeof creatorName === 'object' && creatorName?.username) {
      return creatorName.username.startsWith('@') ? creatorName.username : `@${creatorName.username}`;
    }
    // If it's an object with other structure, try to extract username
    if (typeof creatorName === 'object' && creatorName) {
      const possibleName = creatorName.name || creatorName.displayName || creatorName.user || creatorName.id;
      if (possibleName) {
        return possibleName.startsWith('@') ? possibleName : `@${possibleName}`;
      }
    }
    return '@Unknown User';
  };

  useEffect(() => {
    if (!currentUser) return undefined;

    let active = true;
    void BlypCoinService.getCatalog()
      .then((catalog) => {
        if (!active) return;
        setGifts(
          catalog.gifts.map((gift) => ({
            id: gift.giftId,
            name: gift.name,
            cost: Number(gift.coinCost) || 0,
            emoji: gift.assetJson?.emoji || '🎁',
            rarity: gift.assetJson?.rarity || 'common',
          }))
        );
      })
      .catch((error) => {
        console.error('Canonical gift catalog load failed:', error);
        if (active) setGifts([]);
      });

    const unsubscribe = BlypCoinService.subscribeToBalance(currentUser.uid, (balance) => {
      setUserBalance(balance);
    });

    return () => {
      active = false;
      if (unsubscribe) unsubscribe();
    };
  }, [currentUser]);

  const handleSendGift = async (gift) => {
    if (!currentUser) {
      Alert.alert('Login Required', 'Please login to send gifts');
      return;
    }

    if (currentUser.uid === creatorId) {
      Alert.alert('Cannot Send Gift', 'You cannot send gifts to yourself');
      return;
    }

    if (userBalance < gift.cost) {
      Alert.alert(
        'Insufficient Balance',
        `You need ${gift.cost} Blypcoins to send this gift. Your balance: ${userBalance}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Buy Coins', onPress: () => {
              setShowGiftModal(false);
              // Navigate to coin store - you'd implement this navigation
            }
          }
        ]
      );
      return;
    }

    Alert.alert(
      'Send Gift',
      `Send ${gift.name} ${gift.emoji} to ${getCreatorName()} for ${gift.cost} Blypcoins?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Send Gift', 
          onPress: () => processSendGift(gift)
        }
      ]
    );
  };

  const processSendGift = async (gift) => {
    setSending(true);
    setSelectedGift(gift);
    
    try {
      await BlypCoinService.sendGift(currentUser.uid, creatorId, gift.id, gift.cost, {
        streamId: postId,
      });

      // Trigger gift animation
      triggerGiftAnimation(gift);
      
      // Close modal after animation
      setTimeout(() => {
        setShowGiftModal(false);
        setSelectedGift(null);
        
        Alert.alert(
          'Gift Sent! 🎉',
          `You sent ${gift.name} ${gift.emoji} to ${getCreatorName()}!`,
          [{ text: 'Awesome!', style: 'default' }]
        );
      }, 2000);
      
    } catch (error) {
      console.error('Error sending gift:', error);
      Alert.alert('Error', 'Failed to send gift. Please try again.');
      setSelectedGift(null);
    } finally {
      setSending(false);
    }
  };

  const triggerGiftAnimation = (gift) => {
    if (gift.name === 'Heart' || gift.emoji === '❤️') {
      triggerDisneyHeartAnimation();
    } else {
      // Regular gift animation for other gifts
      Animated.sequence([
        Animated.timing(giftAnimation, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(giftAnimation, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        })
      ]).start();
    }
  };

  // Disney Pixar-quality heart animation - prepare to be amazed! 🎬✨
  const triggerDisneyHeartAnimation = () => {
    setShowHeartAnimation(true);
    
    // Reset all animation values
    heartScale.setValue(0);
    heartOpacity.setValue(0);
    heartRotation.setValue(0);
    heartY.setValue(0);
    sparkles.forEach(sparkle => {
      sparkle.x.setValue(0);
      sparkle.y.setValue(0);
      sparkle.scale.setValue(0);
      sparkle.opacity.setValue(0);
      sparkle.rotation.setValue(0);
    });

    // THE MAIN HEART ANIMATION - 5 phases of pure magic
    const mainHeartAnimation = Animated.sequence([
      // Phase 1: Dramatic entrance with anticipation
      Animated.parallel([
        Animated.timing(heartScale, {
          toValue: 1.5,
          duration: 400,
          easing: Easing.out(Easing.back(2)),
          useNativeDriver: true,
        }),
        Animated.timing(heartOpacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartRotation, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.elastic(1.2)),
          useNativeDriver: true,
        })
      ]),
      
      // Phase 2: Heartbeat effect - ba-dum, ba-dum
      Animated.sequence([
        Animated.timing(heartScale, {
          toValue: 1.8,
          duration: 150,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.4,
          duration: 100,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.7,
          duration: 120,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.5,
          duration: 80,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        })
      ]),
      
      // Phase 3: Graceful levitation
      Animated.timing(heartY, {
        toValue: -50,
        duration: 800,
        easing: Easing.out(Easing.circle),
        useNativeDriver: true,
      }),
      
      // Phase 4: Final dramatic scale and fade
      Animated.parallel([
        Animated.timing(heartScale, {
          toValue: 2.2,
          duration: 600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartOpacity, {
          toValue: 0,
          duration: 600,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(heartY, {
          toValue: -120,
          duration: 600,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        })
      ])
    ]);

    // SPARKLE PARTICLE SYSTEM - because every Disney movie needs sparkles!
    const sparkleAnimations = sparkles.map((sparkle, index) => {
      const delay = index * 80; // Stagger the sparkles
      const angle = (index / sparkles.length) * Math.PI * 2; // Circular distribution
      const radius = 80 + Math.random() * 40; // Random radius for natural effect
      
      return Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          // Sparkle position - spiral outward
          Animated.timing(sparkle.x, {
            toValue: Math.cos(angle) * radius,
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(sparkle.y, {
            toValue: Math.sin(angle) * radius - 30,
            duration: 1200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          
          // Sparkle lifecycle
          Animated.sequence([
            Animated.timing(sparkle.opacity, {
              toValue: 1,
              duration: 200,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(sparkle.opacity, {
              toValue: 0,
              duration: 1000,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            })
          ]),
          
          // Sparkle scale pulse
          Animated.sequence([
            Animated.timing(sparkle.scale, {
              toValue: 1,
              duration: 300,
              easing: Easing.out(Easing.back(1.5)),
              useNativeDriver: true,
            }),
            Animated.timing(sparkle.scale, {
              toValue: 0,
              duration: 900,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            })
          ]),
          
          // Sparkle rotation
          Animated.timing(sparkle.rotation, {
            toValue: 1,
            duration: 1200,
            easing: Easing.linear,
            useNativeDriver: true,
          })
        ])
      ]);
    });

    // Execute the complete Disney magic!
    Animated.parallel([
      mainHeartAnimation,
      ...sparkleAnimations
    ]).start(() => {
      // Animation complete - hide the overlay
      setTimeout(() => {
        setShowHeartAnimation(false);
      }, 200);
    });
  };

  const getRarityColor = (rarity) => {
    const colors = {
      common: ['#64748b', '#94a3b8'],
      rare: ['#3b82f6', '#60a5fa'],
      epic: ['#8b5cf6', '#a78bfa'],
      legendary: ['#f59e0b', '#fbbf24']
    };
    return colors[rarity] || colors.common;
  };

  const renderGift = (gift) => (
    <TouchableOpacity
      key={gift.id}
      style={[
        styles.giftItem,
        selectedGift?.id === gift.id && styles.selectedGift
      ]}
      onPress={() => handleSendGift(gift)}
      disabled={sending || userBalance < gift.cost}
      activeOpacity={0.8}
    >
      <LinearGradient
        colors={getRarityColor(gift.rarity)}
        style={styles.giftGradient}
      >
        <Text style={styles.giftEmoji}>{gift.emoji}</Text>
        <Text style={styles.giftName}>{gift.name}</Text>
        <View style={styles.giftCost}>
          <Text style={styles.coinIcon}>🪙</Text>
          <Text style={styles.costText}>{gift.cost}</Text>
        </View>
        
        {userBalance < gift.cost && (
          <View style={styles.insufficientOverlay}>
            <Icon  name="lock-closed" size={16} color="#fff"  />
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );

  return (
    <>
      <TouchableOpacity
        style={styles.giftButton}
        onPress={() => setShowGiftModal(true)}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={['#f59e0b', '#fbbf24']}
          style={styles.giftButtonGradient}
        >
          <Icon  name="gift" size={16} color="#fff"  />
          <Text style={styles.giftButtonText}>Gift</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Gift Animation Overlay */}
      {selectedGift && (
        <Animated.View
          style={[
            styles.giftAnimationOverlay,
            {
              opacity: giftAnimation,
              transform: [
                {
                  scale: giftAnimation.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.5, 2]
                  })
                }
              ]
            }
          ]}
          pointerEvents="none"
        >
          <Text style={styles.animatedGiftEmoji}>{selectedGift.emoji}</Text>
        </Animated.View>
      )}

      {/* Disney Pixar Heart Animation Overlay - Pure Magic! ✨ */}
      {showHeartAnimation && (
        <View style={styles.heartAnimationContainer} pointerEvents="none">
          {/* Main Heart with all the Disney magic */}
          <Animated.View
            style={[
              styles.animatedHeart,
              {
                opacity: heartOpacity,
                transform: [
                  { scale: heartScale },
                  { 
                    rotate: heartRotation.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '360deg']
                    })
                  },
                  { translateY: heartY }
                ]
              }
            ]}
          >
            <LinearGradient
              colors={['#ff0066', '#ff3385', '#ff6bb3']}
              style={styles.heartGradient}
            >
              <Text style={styles.magicalHeart}>❤️</Text>
            </LinearGradient>
          </Animated.View>

          {/* Sparkle Particle System */}
          {sparkles.map((sparkle, index) => (
            <Animated.View
              key={index}
              style={[
                styles.sparkle,
                {
                  opacity: sparkle.opacity,
                  transform: [
                    { translateX: sparkle.x },
                    { translateY: sparkle.y },
                    { scale: sparkle.scale },
                    {
                      rotate: sparkle.rotation.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0deg', '720deg']
                      })
                    }
                  ]
                }
              ]}
            >
              <Text style={styles.sparkleText}>✨</Text>
            </Animated.View>
          ))}
        </View>
      )}

      {/* Gift Selection Modal */}
      <Modal
        visible={showGiftModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowGiftModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowGiftModal(false)}
              >
                <Icon  name="close" size={24} color="#fff"  />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Send Gift</Text>
              <View style={styles.balanceContainer}>
                <Text style={styles.balanceText}>🪙 {userBalance}</Text>
              </View>
            </View>

            {/* Creator Info */}
            <View style={styles.creatorInfo}>
              <Text style={styles.creatorText}>Sending to: {getCreatorName()}</Text>
            </View>

            {/* Gifts Grid */}
            <ScrollView style={styles.giftsContainer} showsVerticalScrollIndicator={false}>
              <Text style={styles.sectionTitle}>Choose a Gift</Text>
              
              {/* Common Gifts */}
              <View style={styles.raritySection}>
                <Text style={styles.rarityTitle}>🥉 Common Gifts</Text>
                <View style={styles.giftsRow}>
                  {gifts.filter(g => g.rarity === 'common').map(renderGift)}
                </View>
              </View>

              {/* Rare Gifts */}
              <View style={styles.raritySection}>
                <Text style={styles.rarityTitle}>🥈 Rare Gifts</Text>
                <View style={styles.giftsRow}>
                  {gifts.filter(g => g.rarity === 'rare').map(renderGift)}
                </View>
              </View>

              {/* Epic Gifts */}
              <View style={styles.raritySection}>
                <Text style={styles.rarityTitle}>🥇 Epic Gifts</Text>
                <View style={styles.giftsRow}>
                  {gifts.filter(g => g.rarity === 'epic').map(renderGift)}
                </View>
              </View>

              {/* Legendary Gifts */}
              <View style={styles.raritySection}>
                <Text style={styles.rarityTitle}>💎 Legendary Gifts</Text>
                <View style={styles.giftsRow}>
                  {gifts.filter(g => g.rarity === 'legendary').map(renderGift)}
                </View>
              </View>
            </ScrollView>

            {/* Footer */}
            <View style={styles.modalFooter}>
              <Text style={styles.footerText}>
                💡 Creators receive 70% of gift value in Blypcoins
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  giftButton: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  giftButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  giftButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  giftAnimationOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -30,
    marginTop: -30,
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 1000,
  },
  animatedGiftEmoji: {
    fontSize: 40,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '95%',
    minHeight: '95%',
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  closeButton: {
    padding: 4,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  balanceContainer: {
    backgroundColor: '#fbbf24',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  balanceText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  creatorInfo: {
    padding: 20,
    backgroundColor: '#1e293b',
  },
  creatorText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  giftsContainer: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
    textAlign: 'center',
  },
  raritySection: {
    marginBottom: 24,
  },
  rarityTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  giftsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  giftItem: {
    width: (width - 64) / 3,
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  selectedGift: {
    transform: [{ scale: 0.95 }],
  },
  giftGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    position: 'relative',
  },
  giftEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  giftName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  giftCost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  coinIcon: {
    fontSize: 12,
  },
  costText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  insufficientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalFooter: {
    padding: 20,
    backgroundColor: '#1e293b',
  },
  footerText: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
  },
  
  // Disney Pixar Heart Animation Styles - Pure Magic! 🎬✨
  heartAnimationContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    pointerEvents: 'none',
  },
  animatedHeart: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 50,
    shadowColor: '#ff0066',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
  },
  heartGradient: {
    padding: 20,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ff0066',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
  },
  magicalHeart: {
    fontSize: 60,
    textShadowColor: '#ff0066',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  sparkle: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleText: {
    fontSize: 20,
    textShadowColor: '#ffd700',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
});

export default GiftSystem;