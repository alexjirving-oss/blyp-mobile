import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
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
import { auth } from '../config/firebase';
import {
  getEconomyCatalog,
  getEconomyWallet,
  subscribeToEconomyWallet,
} from '../services/economyApiService';

const { width } = Dimensions.get('window');



const CoinStoreScreen = ({ navigation }) => {
  const [balance, setBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);
  const [selectedTab, setSelectedTab] = useState('coins'); // 'coins' or 'gems'
  const [packages, setPackages] = useState([]);

  const currentUser = auth.currentUser;

  useEffect(() => {
    if (!currentUser) return undefined;

    const loadStore = async () => {
      try {
        const [wallet, catalog] = await Promise.all([
          getEconomyWallet(),
          getEconomyCatalog(),
        ]);
        setBalance(wallet.spendableCoins);
        setGemBalance(wallet.gemAvailable);
        setPackages(catalog.coinPacks);
      } catch (error) {
        console.error('Error loading canonical economy store:', error);
      }
    };

    void loadStore();
    const unsubscribe = subscribeToEconomyWallet(
      (wallet) => {
        setBalance(wallet.spendableCoins);
        setGemBalance(wallet.gemAvailable);
      },
      {
        onError: (error) => console.error('Canonical wallet refresh failed:', error),
      }
    );

    return unsubscribe;
  }, [currentUser]);

  const handlePurchase = (packageData) => {
    if (!currentUser) {
      Alert.alert('Error', 'Please log in to purchase Blypcoins');
      return;
    }

    const metadata = packageData.metadata || {};
    const displayPrice = metadata.displayPrice || metadata.priceLabel || null;
    Alert.alert(
      'Store checkout required',
      `${Number(packageData.coinsGranted || 0).toLocaleString()} Blypcoins${
        displayPrice ? ` for ${displayPrice}` : ''
      } are available through ${packageData.platform}. No balance is granted until the store receipt is verified by Blyp.`,
      [{ text: 'OK', style: 'default' }]
    );
  };

  const renderPackage = (pkg) => {
    const metadata = pkg.metadata || {};
    const popular = metadata.popular === true;
    const displayPrice = metadata.displayPrice || metadata.priceLabel || 'Verified store SKU';

    return (
      <TouchableOpacity
        key={`${pkg.platform}:${pkg.sku}`}
        style={[styles.packageCard, popular && styles.popularCard]}
        onPress={() => handlePurchase(pkg)}
        disabled={!pkg.enabled}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={popular ? ['#6366f1', '#8b5cf6', '#ec4899'] : ['#1e293b', '#334155', '#475569']}
          style={styles.packageGradient}
        >
          {popular && (
            <View style={styles.popularBadge}>
              <Text style={styles.popularText}>MOST POPULAR</Text>
            </View>
          )}

          <Text style={styles.packageIcon}>🪙</Text>

          <View style={styles.coinInfo}>
            <Text style={styles.coinAmount}>{Number(pkg.coinsGranted || 0).toLocaleString()}</Text>
            <Text style={styles.totalCoins}>{pkg.platform} • {pkg.sku}</Text>
          </View>

          <View style={styles.priceInfo}>
            <Text style={styles.price}>{displayPrice}</Text>
            <Text style={styles.pricePerCoin}>Server-verified receipt required</Text>
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
          <Icon  name="arrow-back" size={24} color="#fff"  />
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
            {selectedTab === 'coins' ? (
              packages.length > 0 ? (
                packages.map(renderPackage)
              ) : (
                <Text style={styles.infoText}>No verified coin packages are currently available.</Text>
              )
            ) : (
              <Text style={styles.infoText}>
                Gem purchases are unavailable until a server-authoritative store contract is released.
              </Text>
            )}
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