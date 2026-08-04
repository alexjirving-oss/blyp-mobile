import React, { useState, useEffect } from 'react';
import BlueScreen from '../ui/BlueScreen';
import Icon from '../components/Icon';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  Alert,
  RefreshControl,
  StatusBar
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import GameService from '../services/GameService';
import { auth } from '../config/firebase';
import BlypLogo from '../components/BlypLogo';
import HeaderWalletBalances from '../components/HeaderWalletBalances';
import { useAuth, hardLogout } from '../hooks/useCommon';
import { getEconomyWallet } from '../api/economyLiveApi';
import { shouldUseLiveServiceWallet } from '../utils/walletSource';
import BlypCoinService from '../services/BlypCoinService';
import GemService from '../services/GemService';
import { COLORS } from '../styles/theme';
import BlypHeaderFlow from '../components/BlypHeaderFlow';

const GamesScreen = ({ navigation }) => {
  const [menuVisible, setMenuVisible] = useState(false);
  const [coinBalance, setCoinBalance] = useState(0);
  const [gemBalance, setGemBalance] = useState(0);
  const [selectedTab, setSelectedTab] = useState('browse');
  const [availableGames, setAvailableGames] = useState([]);
  const [myGames, setMyGames] = useState([]);
  const [userStats, setUserStats] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGamePopup, setShowGamePopup] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [matchmakingQueue, setMatchmakingQueue] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const currentUser = auth.currentUser;
  const { uid, authReady, isAuthenticated } = useAuth();
  const walletUid = uid || currentUser?.uid || null;

  const tabs = [
    { id: 'browse', label: 'Browse', icon: 'game-controller-outline' },
    { id: 'my-games', label: 'My Games', icon: 'trophy-outline' },
    { id: 'live', label: 'Live', icon: 'radio-outline' },
  ];

  const gameTypes = [
    {
      type: 'rock-paper-scissors',
      name: 'Rock Paper Scissors',
      icon: '✊',
      emoji: '✊🖐️✌️',
      players: '2 players',
      description: 'Classic hand game with rock, paper, and scissors',
      gradient: ['#FF6B6B', '#FF8E53'],
      difficulty: 'Easy',
      playTime: '2 min'
    },
    {
      type: 'tic-tac-toe',
      name: 'Tic Tac Toe',
      icon: '⭕',
      emoji: '❌⭕',
      players: '2 players',
      description: 'Get three in a row to win this classic strategy game',
      gradient: ['#4ECDC4', '#44A08D'],
      difficulty: 'Easy',
      playTime: '3 min'
    },
    {
      type: 'word-guess',
      name: 'Word Guess',
      icon: '🔤',
      emoji: '🔤💭',
      players: 'Up to 4',
      description: 'Guess the mystery word before time runs out',
      gradient: ['#A8E6CF', '#7FCDCD'],
      difficulty: 'Medium',
      playTime: '5 min'
    },
    {
      type: 'quick-draw',
      name: 'Quick Draw',
      icon: '🎨',
      emoji: '🎨✏️',
      players: 'Up to 8',
      description: 'Draw and guess in this fast-paced creative game',
      gradient: ['#FFD93D', '#FF6B6B'],
      difficulty: 'Medium',
      playTime: '4 min'
    },
    {
      type: 'trivia',
      name: 'Trivia Quiz',
      icon: '🧠',
      emoji: '🧠❓',
      players: 'Up to 6',
      description: 'Test your knowledge across various categories',
      gradient: ['#A8EDEA', '#FED6E3'],
      difficulty: 'Hard',
      playTime: '8 min'
    },
    {
      type: 'memory-match',
      name: 'Memory Match',
      icon: '🃏',
      emoji: '🃏🧩',
      players: '2-4 players',
      description: 'Match pairs of cards to test your memory skills',
      gradient: ['#D299C2', '#FED6E3'],
      difficulty: 'Medium',
      playTime: '6 min'
    }
  ];

  useEffect(() => {
    loadGameData();
  }, []);

  const loadBalances = async () => {
    if (!walletUid) {
      setCoinBalance(0);
      setGemBalance(0);
      return;
    }
    try {
      if (shouldUseLiveServiceWallet()) {
        if (!authReady || !isAuthenticated) {
          setCoinBalance(0);
          setGemBalance(0);
          return;
        }

        const wallet = await getEconomyWallet();
        const coins = Number(wallet?.coinBalance || 0) + Number(wallet?.bonusCoinBalance || 0);
        const gems = Number(wallet?.gemAvailable || 0) + Number(wallet?.gemPending || 0);
        setCoinBalance(Number.isFinite(coins) ? coins : 0);
        setGemBalance(Number.isFinite(gems) ? gems : 0);
        return;
      }

      const coins = await BlypCoinService.getUserBalance(walletUid);
      const gems = await GemService.getUserGems(walletUid);
      setCoinBalance(Number.isFinite(coins) ? coins : 0);
      setGemBalance(Number.isFinite(gems) ? gems : 0);
    } catch (e) {
      console.warn('[GAMES][BALANCES] failed', e?.message || String(e));
      setCoinBalance(0);
      setGemBalance(0);
    }
  };

  useEffect(() => {
    if (!menuVisible) return;
    loadBalances();
  }, [menuVisible, walletUid, authReady, isAuthenticated]);

  const loadGameData = async () => {
    setLoading(true);

    try {
      // Subscribe to available games
      const unsubscribeAvailable = GameService.subscribeToAvailableGames((snapshot) => {
        const games = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setAvailableGames(games);
      });

      // Subscribe to user's games
      const unsubscribeUserGames = GameService.subscribeToUserGames(currentUser.uid, (snapshot) => {
        const games = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setMyGames(games);
      });

      // Load user stats
      const stats = await GameService.getUserGameStats(currentUser.uid);
      setUserStats(stats);

      setLoading(false);

      return () => {
        unsubscribeAvailable();
        unsubscribeUserGames();
      };
    } catch (error) {
      console.error('Error loading game data:', error);
      setLoading(false);
    }
  };

  const handleCreateGame = async (gameType, isPrivate = false) => {
    try {
      const gameId = await GameService.createGameRoom(gameType, isPrivate);
      setShowCreateModal(false);
      navigation.navigate('GameRoom', { gameId, gameType });
    } catch (error) {
      console.error('Error creating game:', error);
      Alert.alert('Error', 'Failed to create game. Please try again.');
    }
  };

  const handleJoinGame = async (gameId, game) => {
    try {
      if (game.players.length >= game.maxPlayers) {
        Alert.alert('Game Full', 'This game room is already full.');
        return;
      }

      if (game.players.includes(currentUser.uid)) {
        // Already in game, just navigate
        navigation.navigate('GameRoom', { gameId, gameType: game.gameType });
        return;
      }

      await GameService.joinGame(gameId);
      navigation.navigate('GameRoom', { gameId, gameType: game.gameType });
    } catch (error) {
      console.error('Error joining game:', error);
      Alert.alert('Error', 'Failed to join game. Please try again.');
    }
  };

  const handlePlayNow = async (gameType) => {
    try {
      setMatchmakingQueue(true);

      // First check if there's an existing game waiting for players
      const waitingGames = availableGames.filter(
        game => game.gameType === gameType &&
          game.status === 'waiting' &&
          game.players.length < game.maxPlayers &&
          !game.players.includes(currentUser.uid)
      );

      if (waitingGames.length > 0) {
        // Join an existing waiting game
        const gameToJoin = waitingGames[0];
        await GameService.joinGame(gameToJoin.id);
        setMatchmakingQueue(false);
        setShowGamePopup(false);
        navigation.navigate('GameRoom', { gameId: gameToJoin.id, gameType });
      } else {
        // Create a new game room and wait for opponent
        const gameId = await GameService.createGameRoom(gameType, false);
        setMatchmakingQueue(false);
        setShowGamePopup(false);
        navigation.navigate('GameRoom', { gameId, gameType });
      }
    } catch (error) {
      console.error('Error starting matchmaking:', error);
      setMatchmakingQueue(false);
      Alert.alert('Error', 'Failed to find a game. Please try again.');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadGameData();
    setRefreshing(false);
  };

  const renderGameItem = ({ item }) => (
    <TouchableOpacity
      style={styles.gameItem}
      onPress={() => handleJoinGame(item.id, item)}
      activeOpacity={0.8}
    >
      <View style={styles.gameHeader}>
        <View style={styles.gameInfo}>
          <Ionicons
            name={gameTypes.find(gt => gt.type === item.gameType)?.icon || 'game-controller-outline'}
            size={24}
            color="#00D2BE"
          />
          <View style={styles.gameDetails}>
            <Text style={styles.gameTitle}>
              {GameService.getGameDisplayName(item.gameType)}
            </Text>
            <Text style={styles.gameHost}>
              Host: {item.playerData[item.hostId]?.name || 'Unknown'}
            </Text>
            <Text style={styles.gameTime}>
              {item.status === 'waiting' ? 'Waiting for players' : 'In progress'}
            </Text>
          </View>
        </View>
        <View style={styles.playerCount}>
          <Text style={styles.playerCountText}>
            {item.players.length}/{item.maxPlayers}
          </Text>
          <Icon name="people-outline" size={16} color="#9ca3af" />
        </View>
      </View>

      {item.players.length < item.maxPlayers && (
        <LinearGradient colors={[COLORS.gradientStart, COLORS.gradientMiddle]} style={styles.joinButton}>
          <Text style={styles.joinButtonText}>
            {item.players.includes(currentUser.uid) ? 'Rejoin' : 'Join Game'}
          </Text>
        </LinearGradient>
      )}
    </TouchableOpacity>
  );

  const renderMyGameItem = ({ item }) => (
    <TouchableOpacity
      style={styles.gameItem}
      onPress={() => navigation.navigate('GameRoom', { gameId: item.id, gameType: item.gameType })}
      activeOpacity={0.8}
    >
      <View style={styles.gameHeader}>
        <View style={styles.gameInfo}>
          <Ionicons
            name={gameTypes.find(gt => gt.type === item.gameType)?.icon || 'game-controller-outline'}
            size={24}
            color="#00D2BE"
          />
          <View style={styles.gameDetails}>
            <Text style={styles.gameTitle}>
              {GameService.getGameDisplayName(item.gameType)}
            </Text>
            <Text style={styles.gameStatus}>
              Status: {item.status === 'waiting' ? 'Waiting' : item.status === 'active' ? 'Playing' : 'Finished'}
            </Text>
            {item.status === 'finished' && (
              <Text style={styles.gameResult}>
                {item.winner === currentUser.uid ? '🏆 You won!' :
                  item.winner ? '😞 You lost' : '🤝 Draw'}
              </Text>
            )}
          </View>
        </View>
        <View style={styles.playerCount}>
          <Text style={styles.playerCountText}>
            {item.players.length} players
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  const renderStatsContent = () => (
    <View style={styles.statsContainer}>
      {userStats && userStats.totalGames > 0 ? (
        <>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{userStats.totalGames}</Text>
              <Text style={styles.statLabel}>Games Played</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{userStats.wins}</Text>
              <Text style={styles.statLabel}>Wins</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{userStats.winRate.toFixed(1)}%</Text>
              <Text style={styles.statLabel}>Win Rate</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{userStats.draws}</Text>
              <Text style={styles.statLabel}>Draws</Text>
            </View>
          </View>

          <View style={styles.favoriteGameCard}>
            <Text style={styles.favoriteGameTitle}>Favorite Game</Text>
            <Text style={styles.favoriteGameText}>{userStats.favoriteGame}</Text>
          </View>
        </>
      ) : (
        <View style={styles.emptyStats}>
          <Icon name="analytics-outline" size={64} color="#374151" />
          <Text style={styles.emptyStatsTitle}>No Game Stats Yet</Text>
          <Text style={styles.emptyStatsText}>
            Play some games to see your statistics here!
          </Text>
        </View>
      )}
    </View>
  );

  const renderGameTile = ({ item }) => (
    <TouchableOpacity
      style={styles.gameTile}
      onPress={() => {
        setSelectedGame(item);
        setShowGamePopup(true);
      }}
      activeOpacity={0.8}
    >
      <LinearGradient colors={item.gradient} style={styles.gameTileGradient}>
        <View style={styles.gameTileHeader}>
          <Text style={styles.gameEmoji}>{item.emoji}</Text>
          <View style={styles.difficultyBadge}>
            <Text style={styles.difficultyText}>{item.difficulty}</Text>
          </View>
        </View>

        <View style={styles.gameTileContent}>
          <Text style={styles.gameTileName}>{item.name}</Text>
          <Text style={styles.gameTileDescription}>{item.description}</Text>

          <View style={styles.gameTileFooter}>
            <View style={styles.gameMetaInfo}>
              <View style={styles.metaItem}>
                <Icon name="people" size={14} color="rgba(255,255,255,0.9)" />
                <Text style={styles.metaText}>{item.players}</Text>
              </View>
              <View style={styles.metaItem}>
                <Icon name="time" size={14} color="rgba(255,255,255,0.9)" />
                <Text style={styles.metaText}>{item.playTime}</Text>
              </View>
            </View>

            <View style={styles.playButton}>
              <Icon name="play" size={16} color="#fff" />
            </View>
          </View>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );

  const renderTabContent = () => {
    switch (selectedTab) {
      case 'browse':
        return (
          <FlatList
            data={gameTypes}
            renderItem={renderGameTile}
            keyExtractor={(item) => item.type}
            numColumns={2}
            contentContainerStyle={styles.gamesGrid}
            columnWrapperStyle={styles.gridRow}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#00D2BE"
              />
            }
          />
        );
      case 'my-games':
        return (
          <FlatList
            data={myGames}
            renderItem={renderMyGameItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.gamesList}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#00D2BE"
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Icon name="trophy-outline" size={64} color="#374151" />
                <Text style={styles.emptyStateTitle}>No Games Yet</Text>
                <Text style={styles.emptyStateText}>
                  Join or create games to see them here!
                </Text>
              </View>
            }
          />
        );
      case 'stats':
        return renderStatsContent();
      default:
        return null;
    }
  };

  const GamePopupModal = () => (
    <Modal
      visible={showGamePopup}
      transparent={true}
      animationType="fade"
      onRequestClose={() => setShowGamePopup(false)}
    >
      <View style={styles.popupOverlay}>
        <View style={styles.popupContent}>
          {selectedGame && (
            <>
              <TouchableOpacity
                style={styles.popupClose}
                onPress={() => setShowGamePopup(false)}
              >
                <Icon name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>

              <LinearGradient colors={selectedGame.gradient} style={styles.popupHeader}>
                <Text style={styles.popupGameEmoji}>{selectedGame.emoji}</Text>
                <Text style={styles.popupGameName}>{selectedGame.name}</Text>
                <Text style={styles.popupGameDescription}>{selectedGame.description}</Text>
              </LinearGradient>

              <View style={styles.popupInfo}>
                <View style={styles.popupMetaGrid}>
                  <View style={styles.popupMetaItem}>
                    <Icon name="people" size={20} color="#00D2BE" />
                    <Text style={styles.popupMetaLabel}>Players</Text>
                    <Text style={styles.popupMetaValue}>{selectedGame.players}</Text>
                  </View>
                  <View style={styles.popupMetaItem}>
                    <Icon name="time" size={20} color="#00D2BE" />
                    <Text style={styles.popupMetaLabel}>Duration</Text>
                    <Text style={styles.popupMetaValue}>{selectedGame.playTime}</Text>
                  </View>
                  <View style={styles.popupMetaItem}>
                    <Icon name="star" size={20} color="#00D2BE" />
                    <Text style={styles.popupMetaLabel}>Difficulty</Text>
                    <Text style={styles.popupMetaValue}>{selectedGame.difficulty}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.playNowButton, matchmakingQueue && styles.playNowButtonDisabled]}
                  onPress={() => handlePlayNow(selectedGame.type)}
                  disabled={matchmakingQueue}
                >
                  <LinearGradient colors={[COLORS.gradientStart, COLORS.gradientMiddle]} style={styles.playNowGradient}>
                    {matchmakingQueue ? (
                      <>
                        <Text style={styles.playNowText}>Finding Player...</Text>
                        <View style={styles.loadingDots}>
                          <View style={[styles.dot, styles.dot1]} />
                          <View style={[styles.dot, styles.dot2]} />
                          <View style={[styles.dot, styles.dot3]} />
                        </View>
                      </>
                    ) : (
                      <>
                        <Icon name="play" size={20} color="#fff" />
                        <Text style={styles.playNowText}>Play Now</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  const CreateGameModal = () => (
    <Modal
      visible={showCreateModal}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setShowCreateModal(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Create Private Room</Text>
            <TouchableOpacity
              onPress={() => setShowCreateModal(false)}
              style={styles.closeButton}
            >
              <Icon name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <FlatList
            data={gameTypes}
            keyExtractor={(item) => item.type}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.gameOption}
                onPress={() => handleCreateGame(item.type)}
              >
                <Text style={styles.gameOptionEmoji}>{item.emoji}</Text>
                <View style={styles.gameOptionInfo}>
                  <Text style={styles.gameOptionText}>{item.name}</Text>
                  <Text style={styles.gameOptionPlayers}>{item.players}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </Modal>
  );

  const useSectionGradient = selectedTab !== 'live';

  return (
    <BlueScreen>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#0A0A0C" translucent={true} />
        {/* Header – FLOW layout via BlypHeaderFlow */}
        <BlypHeaderFlow
          tabs={[
            { key: 'browse', label: 'Browse' },
            { key: 'my-games', label: 'My Games' },
            { key: 'live', label: 'Live' },
          ]}
          matchHomePadding={true}
          activeKey={selectedTab}
          onTabChange={setSelectedTab}
          onMenuPress={() => setMenuVisible(true)}
          rightAction={
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => setShowCreateModal(true)}
            >
              <LinearGradient colors={[COLORS.gradientStart, COLORS.gradientMiddle]} style={styles.createButtonGradient}>
                <Icon name="add" size={20} color={COLORS.white} />
                <Text style={styles.createButtonText}>Create</Text>
              </LinearGradient>
            </TouchableOpacity>
          }
        />

        {/* Content */}
        <View style={styles.content}>
          {useSectionGradient && (
            <LinearGradient
              pointerEvents="none"
              colors={[COLORS.pageBackground, COLORS.pageBackground, COLORS.pageBackground]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sectionGradientBackground}
            />
          )}
          {renderTabContent()}
        </View>

        <GamePopupModal />
        <CreateGameModal />

        {/* Menu Overlay */}
        <Modal
          visible={menuVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setMenuVisible(false)}
        >
          <TouchableOpacity
            style={styles.menuOverlay}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          >
            <View style={styles.menuContainer}>
              <TouchableOpacity
                style={styles.menuCloseButton}
                onPress={() => setMenuVisible(false)}
              >
                <Icon name="close" size={24} color="#d1d5db" />
              </TouchableOpacity>
              <Text style={styles.menuTitle}>Menu</Text>

              <TouchableOpacity
                style={styles.codeButton}
                onPress={() => {
                  setMenuVisible(false);
                  navigation.navigate('HowBlypWorks', { mode: 'review' });
                }}
              >
                <Text style={styles.menuButtonText}>Help</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuLogoutButton}
                onPress={() => {
                  setMenuVisible(false);
                  hardLogout();
                }}
              >
                <Text style={styles.menuLogoutText}>Log out</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </BlueScreen>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    backgroundColor: COLORS.background,
    paddingTop: 8,
    paddingBottom: 1,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  menuButton: {
    padding: 8,
  },
  headerBalances: {
    position: 'absolute',
    left: 56,
    height: '100%',
    justifyContent: 'center',
  },
  logoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  createButton: {
    borderRadius: 20,
  },
  createButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  createButtonText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 20,
    backgroundColor: COLORS.backgroundLight,
    gap: 4,
  },
  activeTabButton: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  activeTabText: {
    color: COLORS.textPrimary,
  },
  content: {
    flex: 1,
    position: 'relative',
  },
  sectionGradientBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  gamesList: {
    padding: 16,
    paddingBottom: 100,
  },
  gameItem: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  gameHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  gameInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
  },
  gameDetails: {
    flex: 1,
  },
  gameTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  gameHost: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginBottom: 2,
  },
  gameTime: {
    color: COLORS.success,
    fontSize: 12,
    fontWeight: '500',
  },
  gameStatus: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginBottom: 2,
  },
  gameResult: {
    color: COLORS.warning,
    fontSize: 12,
    fontWeight: '600',
  },
  playerCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  playerCountText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  joinButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  joinButtonText: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStateTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 8,
  },
  emptyStateText: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  statsContainer: {
    padding: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 20,
  },
  statCard: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 14,
    padding: 16,
    flex: 1,
    minWidth: '45%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statNumber: {
    color: COLORS.primary,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  favoriteGameCard: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  favoriteGameTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  favoriteGameText: {
    color: COLORS.primary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptyStats: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyStatsTitle: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 8,
  },
  emptyStatsText: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },
  gameOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.backgroundCard,
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    gap: 16,
  },
  gameOptionInfo: {
    flex: 1,
  },
  gameOptionText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  gameOptionPlayers: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  gameOptionEmoji: {
    fontSize: 32,
  },

  // App Store Style Game Tiles
  gamesGrid: {
    padding: 16,
    paddingBottom: 100,
  },
  gridRow: {
    justifyContent: 'space-between',
  },
  gameTile: {
    flex: 1,
    marginHorizontal: 4,
    marginVertical: 8,
    borderRadius: 20,
    overflow: 'hidden',
    minHeight: 200,
  },
  gameTileGradient: {
    flex: 1,
    padding: 16,
    justifyContent: 'space-between',
  },
  gameTileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  gameEmoji: {
    fontSize: 32,
  },
  difficultyBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  difficultyText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: 'bold',
  },
  gameTileContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  gameTileName: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  gameTileDescription: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 12,
  },
  gameTileFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  gameMetaInfo: {
    flex: 1,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  metaText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontWeight: '500',
  },
  playButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Game Popup Modal Styles
  popupOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupContent: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 24,
    width: '85%',
    maxWidth: 400,
    overflow: 'hidden',
    position: 'relative',
  },
  popupClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 20,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  popupHeader: {
    padding: 32,
    paddingTop: 8,
    alignItems: 'center',
  },
  popupGameEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  popupGameName: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  popupGameDescription: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  popupInfo: {
    padding: 24,
  },
  popupMetaGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 32,
  },
  popupMetaItem: {
    alignItems: 'center',
    flex: 1,
  },
  popupMetaLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 8,
    marginBottom: 4,
  },
  popupMetaValue: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  playNowButton: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  playNowButtonDisabled: {
    opacity: 0.7,
  },
  playNowGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 32,
    gap: 8,
  },
  playNowText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: 'bold',
  },
  loadingDots: {
    flexDirection: 'row',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.white,
  },
  dot1: {
    opacity: 1,
  },
  dot2: {
    opacity: 0.6,
  },
  dot3: {
    opacity: 0.3,
  },
  // Menu styles
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuContainer: {
    width: '80%',
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: COLORS.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  menuCloseButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 8,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 24,
  },
  balanceItems: {
    width: '100%',
    marginBottom: 24,
  },
  menuBalanceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  balanceIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  balanceLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.textSecondary,
    marginLeft: 8,
  },
  balanceValue: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  codeButton: {
    backgroundColor: '#00D2BE',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  menuButtonText: {
    color: '#0A0A0C',
    fontWeight: '600',
    fontSize: 16,
  },
  menuLogoutButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF5A5F',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 10,
    alignItems: 'center',
  },
  menuLogoutText: { color: '#FF5A5F', fontWeight: '700', fontSize: 16 },
});

export default GamesScreen;

