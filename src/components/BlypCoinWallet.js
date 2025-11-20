import React, { useState, useEffect } from 'react';
import Icon from './Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  FlatList,
  SafeAreaView,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { doc, getDoc, getDocs } from 'firebase/firestore';
import { auth, firestore as db } from '../config/firebase';
import BlypCoinService from '../services/BlypCoinService';

const BlypCoinWallet = ({ navigation, showBalance = true, compact = false }) => {
  const [balance, setBalance] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [canClaimDaily, setCanClaimDaily] = useState(false);
  const currentUser = auth.currentUser;

  useEffect(() => {
    if (currentUser) {
      // Subscribe to real-time balance updates
      const unsubscribe = BlypCoinService.subscribeToBalance(currentUser.uid, (newBalance) => {
        setBalance(newBalance);
      });

      checkDailyReward();
      return unsubscribe;
    }
  }, [currentUser]);

  const checkDailyReward = async () => {
    // Check if user can claim daily reward
    // This is a simplified check - you'd want more robust logic
    try {
      const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
      if (userDoc.exists()) {
        const lastCheckIn = userDoc.data().lastCheckIn?.toDate();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        setCanClaimDaily(!lastCheckIn || lastCheckIn < today);
      }
    } catch (error) {
      console.error('Error checking daily reward:', error);
    }
  };

  const loadTransactions = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    try {
      const history = await BlypCoinService.getTransactionHistory(currentUser.uid);
      setTransactions(history);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimDailyReward = async () => {
    if (!currentUser) return;
    
    try {
      const result = await BlypCoinService.claimDailyReward(currentUser.uid);
      Alert.alert(
        'Daily Reward Claimed! 🎉',
        `You earned ${result.reward} Blypcoins!\nCurrent streak: ${result.streak} days`,
        [{ text: 'Awesome!', style: 'default' }]
      );
      setCanClaimDaily(false);
    } catch (error) {
      Alert.alert('Already Claimed', 'Come back tomorrow for your next reward!');
    }
  };

  const openWalletModal = () => {
    setShowModal(true);
    loadTransactions();
  };

  const formatTransactionType = (type, reason) => {
    const icons = {
      credit: '📈',
      debit: '📉'
    };
    
    const reasons = {
      purchase: 'Package Purchase',
      gift_sent: 'Gift Sent',
      gift_received: 'Gift Received',
      daily_reward: 'Daily Reward',
      boost: 'Post Boost'
    };
    
    return `${icons[type]} ${reasons[reason] || reason}`;
  };

  const renderTransaction = ({ item }) => (
    <View style={styles.transactionItem}>
      <View style={styles.transactionLeft}>
        <Text style={styles.transactionType}>
          {formatTransactionType(item.type, item.reason)}
        </Text>
        <Text style={styles.transactionDate}>
          {item.timestamp.toLocaleDateString()} {item.timestamp.toLocaleTimeString()}
        </Text>
      </View>
      <View style={styles.transactionRight}>
        <Text style={[
          styles.transactionAmount,
          item.type === 'credit' ? styles.creditAmount : styles.debitAmount
        ]}>
          {item.type === 'credit' ? '+' : '-'}{item.amount}
        </Text>
      </View>
    </View>
  );

  if (compact) {
    return (
      <TouchableOpacity style={styles.compactWallet} onPress={openWalletModal}>
        <Text style={styles.coinEmoji}>🪙</Text>
        <Text style={styles.compactBalance}>{balance.toLocaleString()}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <LinearGradient
        colors={['#fbbf24', '#f59e0b', '#d97706']}
        style={styles.walletCard}
      >
        <View style={styles.walletHeader}>
          <View>
            <Text style={styles.walletTitle}>Blypcoin Wallet</Text>
            {showBalance && (
              <View style={styles.balanceRow}>
                <Text style={styles.coinEmoji}>🪙</Text>
                <Text style={styles.balanceAmount}>{balance.toLocaleString()}</Text>
              </View>
            )}
          </View>
          
          <TouchableOpacity 
            style={styles.walletButton}
            onPress={openWalletModal}
          >
            <Icon  name="wallet" size={20} color="#fff"  />
          </TouchableOpacity>
        </View>

        <View style={styles.walletActions}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => navigation?.navigate('CoinStore')}
          >
            <Icon  name="add" size={16} color="#fff"  />
            <Text style={styles.actionText}>Buy Coins</Text>
          </TouchableOpacity>

          {canClaimDaily && (
            <TouchableOpacity 
              style={[styles.actionButton, styles.dailyButton]}
              onPress={handleClaimDailyReward}
            >
              <Icon  name="gift" size={16} color="#fff"  />
              <Text style={styles.actionText}>Daily Reward</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity 
            style={styles.actionButton}
            onPress={openWalletModal}
          >
            <Icon  name="list" size={16} color="#fff"  />
            <Text style={styles.actionText}>History</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Wallet Details Modal */}
      <Modal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowModal(false)}
            >
              <Icon  name="close" size={24} color="#fff"  />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Wallet Details</Text>
            <View style={styles.placeholder} />
          </View>

          <LinearGradient
            colors={['#fbbf24', '#f59e0b', '#d97706']}
            style={styles.modalBalanceCard}
          >
            <Text style={styles.modalBalanceLabel}>Current Balance</Text>
            <View style={styles.modalBalanceRow}>
              <Text style={styles.modalCoinEmoji}>🪙</Text>
              <Text style={styles.modalBalanceAmount}>{balance.toLocaleString()}</Text>
            </View>
          </LinearGradient>

          <View style={styles.transactionsSection}>
            <Text style={styles.transactionsTitle}>Transaction History</Text>
            
            {loading ? (
              <Text style={styles.loadingText}>Loading...</Text>
            ) : transactions.length === 0 ? (
              <Text style={styles.emptyText}>No transactions yet</Text>
            ) : (
              <FlatList
                data={transactions}
                renderItem={renderTransaction}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                style={styles.transactionsList}
              />
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  walletCard: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
  },
  walletHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  walletTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coinEmoji: {
    fontSize: 20,
    marginRight: 6,
  },
  balanceAmount: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
  },
  walletButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 12,
    borderRadius: 12,
  },
  walletActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 4,
  },
  dailyButton: {
    backgroundColor: 'rgba(34, 197, 94, 0.8)',
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  compactWallet: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fbbf24',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  compactBalance: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
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
    fontSize: 20,
    fontWeight: '700',
  },
  placeholder: {
    width: 32,
  },
  modalBalanceCard: {
    margin: 20,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  modalBalanceLabel: {
    color: '#fff',
    fontSize: 16,
    opacity: 0.9,
    marginBottom: 8,
  },
  modalBalanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalCoinEmoji: {
    fontSize: 32,
    marginRight: 8,
  },
  modalBalanceAmount: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '800',
  },
  transactionsSection: {
    flex: 1,
    paddingHorizontal: 20,
  },
  transactionsTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  transactionsList: {
    flex: 1,
  },
  transactionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 12,
    marginBottom: 8,
  },
  transactionLeft: {
    flex: 1,
  },
  transactionType: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  transactionDate: {
    color: '#94a3b8',
    fontSize: 12,
  },
  transactionRight: {
    alignItems: 'flex-end',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  creditAmount: {
    color: '#10b981',
  },
  debitAmount: {
    color: '#ef4444',
  },
  loadingText: {
    color: '#94a3b8',
    textAlign: 'center',
    fontSize: 16,
    marginTop: 40,
  },
  emptyText: {
    color: '#94a3b8',
    textAlign: 'center',
    fontSize: 16,
    marginTop: 40,
  },
});

export default BlypCoinWallet;