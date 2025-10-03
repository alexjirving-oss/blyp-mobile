import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { auth } from '../config/firebase';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';

const { width } = Dimensions.get('window');

// Gem packages data
const getGemPackages = () => [
  {
    id: 'gems_1',
    gems: 50,
    bonus: 0,
    price: 0.99,
    icon: '💎',
    popular: false
  },
  {
    id: 'gems_2',
    gems: 120,
    bonus: 20,
    price: 1.99,
    icon: '💎',
    popular: true
  },
  {
    id: 'gems_3',
    gems: 300,
    bonus: 80,
    price: 4.99,
    icon: '💎',
    popular: false
  },
  {
    id: 'gems_4',
    gems: 650,
    bonus: 200,
    price: 9.99,
    icon: '💎',
    popular: false
  },
  {
    id: 'gems_5',
    gems: 1500,
    bonus: 600,
    price: 19.99,
    icon: '💎',
    popular: false
  }
];

const CoinStoreScreen = ({ navigation }) => {
  const [balance, setBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState('coins'); // 'coins' or 'gems'
  const [packages] = useState(BlypCoinService.getCoinPackages());
  const [gemPackages] = useState(() => getGemPackages());
  const currentUser = auth.currentUser;

  useEffect(() => {
    loadBalance();
    
    if (!currentUser) return;
    
    // Subscribe to real-time balance updates
    const unsubscribeCoin = BlypCoinService.subscribeToBalance(currentUser.uid, (newBalance) => {
      setBalance(newBalance);
    });
    
    const unsubscribeGem = GemService.subscribeToGems(currentUser.uid, (newBalance) => {
      setGemBalance(newBalance);
    });

    return () => {
      if (unsubscribeCoin) unsubscribeCoin();
      if (unsubscribeGem) unsubscribeGem();
    };
  }, [currentUser]);

  const loadBalance = async () => {
    if (currentUser) {
      try {
        const userBalance = await BlypCoinService.getUserBalance(currentUser.uid);
        setBalance(userBalance);
        
        const userGems = await GemService.getUserGems(currentUser.uid);
        setGemBalance(userGems);
      } catch (error) {
        console.error('Error loading balance:', error);
      }
    }
  };

  const handlePurchase = async (packageData) => {
    if (!currentUser) {
      Alert.alert('Error', 'Please log in to purchase Blypcoins');
      return;
    }

    Alert.alert(
      'Purchase Blypcoins',
      `Buy ${packageData.coins + packageData.bonus} Blypcoins for $${packageData.price}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Buy Now',
          onPress: () => processPurchase(packageData)
        }
      ]
    );
  };

  const processPurchase = async (packageData) => {
    setLoading(true);
    try {
      // In a real app, integrate with payment processor (Stripe, Apple Pay, etc.)
      // For demo, we'll simulate the purchase
      
      const totalCoins = packageData.coins + packageData.bonus;
      
      await BlypCoinService.addCoins(
        currentUser.uid,
        totalCoins,
        'purchase',
        {
          packageId: packageData.id,
          price: packageData.price,
          baseCoins: packageData.coins,
          bonusCoins: packageData.bonus
        }
      );
      
      Alert.alert(
        'Purchase Successful! 🎉',
        `You received ${totalCoins} Blypcoins!`,
        [{ text: 'Awesome!', style: 'default' }]
      );
      
    } catch (error) {
      console.error('Purchase error:', error);
      Alert.alert('Purchase Failed', 'Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleGemPurchase = async (packageData) => {
    if (!currentUser) {
      Alert.alert('Error', 'Please log in to purchase Gems');
      return;
    }

    Alert.alert(
      'Purchase Gems',
      `Buy ${packageData.gems + packageData.bonus} Gems for $${packageData.price}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Buy Now',
          onPress: () => processGemPurchase(packageData)
        }
      ]
    );
  };

  const processGemPurchase = async (packageData) => {
    setLoading(true);
    try {
      const totalGems = packageData.gems + packageData.bonus;
      
      await GemService.addGems(
        currentUser.uid,
        totalGems,
        'purchase'
      );
      
      Alert.alert(
        'Purchase Successful! 💎',
        `You received ${totalGems} Gems!`,
        [{ text: 'Awesome!', style: 'default' }]
      );
      
    } catch (error) {
      console.error('Gem purchase error:', error);
      Alert.alert('Purchase Failed', 'Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const renderPackage = (pkg) => {
    const totalCoins = pkg.coins + pkg.bonus;
    const coinValue = pkg.price / totalCoins;
    const savings = pkg.bonus > 0 ? Math.round((pkg.bonus / pkg.coins) * 100) : 0;

    return (
      <TouchableOpacity
        key={pkg.id}
        style={[styles.packageCard, pkg.popular && styles.popularCard]}
        onPress={() => handlePurchase(pkg)}
        disabled={loading}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={pkg.popular ? ['#6366f1', '#8b5cf6', '#ec4899'] : ['#1e293b', '#334155', '#475569']}
          style={styles.packageGradient}
        >
          {pkg.popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularText}>MOST POPULAR</Text>
            </View>
          )}
          
          <Text style={styles.packageIcon}>{pkg.icon}</Text>
          
          <View style={styles.coinInfo}>
            <Text style={styles.coinAmount}>{pkg.coins.toLocaleString()}</Text>
            {pkg.bonus > 0 && (
              <Text style={styles.bonusText}>+{pkg.bonus} BONUS</Text>
            )}
            <Text style={styles.totalCoins}>= {totalCoins.toLocaleString()} total</Text>
          </View>
          
          <View style={styles.priceInfo}>
            <Text style={styles.price}>${pkg.price}</Text>
            <Text style={styles.pricePerCoin}>
              ${coinValue.toFixed(3)} per coin
            </Text>
            {savings > 0 && (
              <Text style={styles.savings}>Save {savings}%!</Text>
            )}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  const renderGemPackage = (pkg) => {
    const totalGems = pkg.gems + pkg.bonus;
    const gemValue = pkg.price / totalGems;
    const savings = pkg.bonus > 0 ? Math.round((pkg.bonus / pkg.gems) * 100) : 0;

    return (
      <TouchableOpacity
        key={pkg.id}
        style={[styles.packageCard, pkg.popular && styles.popularCard]}
        onPress={() => handleGemPurchase(pkg)}
        disabled={loading}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={pkg.popular ? ['#ec4899', '#be185d', '#9d174d'] : ['#374151', '#4b5563', '#6b7280']}
          style={styles.packageGradient}
        >
          {pkg.popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularText}>MOST POPULAR</Text>
            </View>
          )}
          
          <Text style={styles.packageIcon}>{pkg.icon}</Text>
          
          <View style={styles.coinInfo}>
            <Text style={styles.coinAmount}>{pkg.gems.toLocaleString()}</Text>
            {pkg.bonus > 0 && (
              <Text style={styles.bonusText}>+{pkg.bonus} BONUS</Text>
            )}
            <Text style={styles.totalCoins}>= {totalGems.toLocaleString()} total</Text>
          </View>
          
          <View style={styles.priceInfo}>
            <Text style={styles.price}>${pkg.price}</Text>
            <Text style={styles.pricePerCoin}>
              ${gemValue.toFixed(3)} per gem
            </Text>
            {savings > 0 && (
              <Text style={styles.savings}>Save {savings}%!</Text>
            )}
          </View>
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>Currency Store</Text>
        
        <View style={styles.balanceContainer}>
          <View style={styles.balanceRow}>
            <Text style={styles.coinEmoji}>🪙</Text>
            <Text style={styles.balanceAmount}>{balance.toLocaleString()}</Text>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.coinEmoji}>💎</Text>
            <Text style={styles.balanceAmount}>{gemBalance.toLocaleString()}</Text>
          </View>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'coins' && styles.activeTab]}
          onPress={() => setSelectedTab('coins')}
        >
          <Text style={[styles.tabText, selectedTab === 'coins' && styles.activeTabText]}>
            🪙 Blypcoins
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'gems' && styles.activeTab]}
          onPress={() => setSelectedTab('gems')}
        >
          <Text style={[styles.tabText, selectedTab === 'gems' && styles.activeTabText]}>
            💎 Gems
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Info Section */}
        <View style={styles.infoSection}>
          <LinearGradient
            colors={selectedTab === 'coins' ? ['#fbbf24', '#f59e0b', '#d97706'] : ['#ec4899', '#be185d', '#9d174d']}
            style={styles.infoCard}
          >
            <Text style={styles.infoTitle}>
              {selectedTab === 'coins' ? '💡 What are Blypcoins?' : '💎 What are Gems?'}
            </Text>
            <Text style={styles.infoText}>
              {selectedTab === 'coins' 
                ? 'Send gifts to creators, unlock premium features, and show your support!'
                : 'Premium currency for exclusive features, rare gifts, and special perks!'
              }
            </Text>
          </LinearGradient>
        </View>

        {/* Packages Grid */}
        <View style={styles.packagesSection}>
          <Text style={styles.sectionTitle}>Choose Your Package</Text>
          
          <View style={styles.packagesGrid}>
            {selectedTab === 'coins' 
              ? packages.map(renderPackage)
              : gemPackages.map(renderGemPackage)
            }
          </View>
        </View>

        {/* Features */}
        <View style={styles.featuresSection}>
          <Text style={styles.sectionTitle}>
            {selectedTab === 'coins' ? 'What You Can Do' : 'Exclusive Gem Benefits'}
          </Text>
          
          <View style={styles.featuresList}>
            {selectedTab === 'coins' ? (
              <>
                <View style={styles.featureItem}>
                  <Text style={styles.featureIcon}>🎁</Text>
                  <Text style={styles.featureText}>Send gifts to creators</Text>
                </View>
                <View style={styles.featureItem}>
                  <Text style={styles.featureIcon}>⭐</Text>
                  <Text style={styles.featureText}>Boost your posts</Text>
                </View>
                <View style={styles.featureItem}>
                  <Text style={styles.featureIcon}>👑</Text>
                  <Text style={styles.featureText}>Unlock premium features</Text>
                </View>
                <View style={styles.featureItem}>
                  <Text style={styles.featureIcon}>💰</Text>
                  <Text style={styles.featureText}>Earn coins from gifts</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.featureItem}>
                  <Text style={styles.featureIcon}>🌟</Text>
                  <Text style={styles.featureText}>Send exclusive premium gifts</Text>
                </View>
                <View style={styles.featureItem}>
                  <Text style={styles.featureIcon}>💎</Text>
                  <Text style={styles.featureText}>Access rare avatar frames</Text>
                </View>
                <View style={styles.featureItem}>
                  <Text style={styles.featureIcon}>🎨</Text>
                  <Text style={styles.featureText}>Unlock special themes</Text>
                </View>
                <View style={styles.featureItem}>
                  <Text style={styles.featureIcon}>👑</Text>
                  <Text style={styles.featureText}>VIP status and benefits</Text>
                </View>
              </>
            )}
          </View>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balanceLabel: {
    color: '#94a3b8',
    fontSize: 12,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  coinEmoji: {
    fontSize: 16,
    marginRight: 4,
  },
  balanceAmount: {
    color: '#fbbf24',
    fontSize: 16,
    fontWeight: '700',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    margin: 20,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#334155',
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#fff',
  },
  content: {
    flex: 1,
  },
  infoSection: {
    padding: 20,
  },
  infoCard: {
    padding: 20,
    borderRadius: 16,
  },
  infoTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  infoText: {
    color: '#fff',
    fontSize: 14,
    opacity: 0.9,
  },
  packagesSection: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  packagesGrid: {
    gap: 12,
  },
  packageCard: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  popularCard: {
    borderWidth: 2,
    borderColor: '#fbbf24',
  },
  packageGradient: {
    padding: 20,
    position: 'relative',
  },
  popularBadge: {
    position: 'absolute',
    top: -1,
    left: -1,
    right: -1,
    backgroundColor: '#fbbf24',
    paddingVertical: 4,
    alignItems: 'center',
  },
  popularText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  packageIcon: {
    fontSize: 40,
    textAlign: 'center',
    marginBottom: 12,
  },
  coinInfo: {
    alignItems: 'center',
    marginBottom: 16,
  },
  coinAmount: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  bonusText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  totalCoins: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 2,
  },
  priceInfo: {
    alignItems: 'center',
  },
  price: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  pricePerCoin: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  savings: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  featuresSection: {
    padding: 20,
  },
  featuresList: {
    gap: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 12,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 16,
  },
  featureText: {
    color: '#fff',
    fontSize: 16,
    flex: 1,
  },
  bottomSpacer: {
    height: 40,
  },
});

export default CoinStoreScreen;