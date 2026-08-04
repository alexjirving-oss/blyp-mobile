import React, { useState, useEffect } from 'react';
import Icon from '../components/Icon';
import ScreenContainer from '../components/ScreenContainer';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  FlatList,
  ScrollView
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import GameService from '../services/GameService';
import { auth } from '../config/firebase';
import RockPaperScissorsGame from '../components/RockPaperScissorsGame';
import { COLORS } from '../styles/theme';

const GameRoomScreen = ({ navigation, route }) => {
  const { gameId, gameType } = route.params;
  const [gameData, setGameData] = useState(null);
  const [loading, setLoading] = useState(true);
  const currentUser = auth.currentUser;

  useEffect(() => {
    const unsubscribe = GameService.subscribeToGame(gameId, (doc) => {
      if (doc.exists()) {
        setGameData({ id: doc.id, ...doc.data() });
      } else {
        Alert.alert('Game Not Found', 'This game room no longer exists.', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [gameId]);

  const handleStartGame = async () => {
    try {
      if (gameData.players.length < 2) {
        Alert.alert('Not Enough Players', 'You need at least 2 players to start the game.');
        return;
      }
      await GameService.startGame(gameId);
    } catch (error) {
      console.error('Error starting game:', error);
      Alert.alert('Error', 'Failed to start game.');
    }
  };

  const handleLeaveGame = () => {
    Alert.alert(
      'Leave Game',
      'Are you sure you want to leave this game?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Leave', 
          style: 'destructive',
          onPress: () => navigation.goBack()
        }
      ]
    );
  };

  const handleInviteFriends = () => {
    Alert.alert('Invite Friends', 'Game invitations will be sent via social feed posts!');
  };

  const renderPlayer = ({ item: playerId }) => {
    const player = gameData.playerData[playerId];
    const isHost = playerId === gameData.hostId;
    const isCurrentUser = playerId === currentUser.uid;
    
    return (
      <View style={styles.playerItem}>
        <View style={styles.playerInfo}>
          <View style={styles.playerAvatar}>
            <Text style={styles.playerAvatarText}>
              {player.name?.charAt(0)?.toUpperCase() || 'P'}
            </Text>
          </View>
          <View style={styles.playerDetails}>
            <Text style={styles.playerName}>
              {player.name || 'Player'} {isCurrentUser && '(You)'}
            </Text>
            {isHost && <Text style={styles.hostBadge}>👑 Host</Text>}
            <Text style={styles.playerScore}>Score: {player.score || 0}</Text>
          </View>
        </View>
        <View style={styles.playerStatus}>
          {gameData.status === 'active' && (
            <View style={[
              styles.statusDot,
              { backgroundColor: '#10b981' }
            ]} />
          )}
        </View>
      </View>
    );
  };

  const renderGameContent = () => {
    if (gameData.status === 'waiting') {
      return (
        <View style={styles.waitingContainer}>
          <Icon  name="hourglass-outline" size={64} color="#00D2BE"  />
          <Text style={styles.waitingTitle}>Waiting for Players</Text>
          <Text style={styles.waitingText}>
            {gameData.players.length}/{gameData.maxPlayers} players joined
          </Text>
          
          {gameData.hostId === currentUser.uid && gameData.players.length >= 2 && (
            <TouchableOpacity style={styles.startButton} onPress={handleStartGame}>
              <LinearGradient colors={['#10b981', '#059669']} style={styles.startButtonGradient}>
                <Icon  name="play" size={20} color="#fff"  />
                <Text style={styles.startButtonText}>Start Game</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.inviteButton} onPress={handleInviteFriends}>
            <Text style={styles.inviteButtonText}>📤 Invite Friends via Feed</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (gameData.status === 'active') {
      // Render specific game based on gameType
      if (gameType === 'rock-paper-scissors') {
        return (
          <RockPaperScissorsGame
            gameData={gameData}
            gameId={gameId}
            currentUser={currentUser}
            onGameUpdate={(updatedData) => setGameData({ id: gameId, ...updatedData })}
          />
        );
      }
      
      // Fallback for other games not yet implemented
      return (
        <View style={styles.comingSoonContainer}>
          <Icon  name="construct-outline" size={64} color="#374151"  />
          <Text style={styles.comingSoonTitle}>Game Coming Soon!</Text>
          <Text style={styles.comingSoonText}>
            {GameService.getGameDisplayName(gameType)} gameplay is still being developed. 
            For now, you can create and join game rooms!
          </Text>
          
          {gameData.hostId === currentUser.uid && (
            <TouchableOpacity 
              style={styles.endGameButton} 
              onPress={async () => {
                try {
                  await GameService.endGame(gameId, currentUser.uid);
                } catch (error) {
                  console.error('Error ending game:', error);
                }
              }}
            >
              <LinearGradient colors={['#ef4444', '#dc2626']} style={styles.endGameGradient}>
                <Text style={styles.endGameText}>End Game (Demo)</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    if (gameData.status === 'finished') {
      const winner = gameData.winner;
      const winnerName = winner ? gameData.playerData[winner]?.name || 'Unknown' : null;
      
      return (
        <View style={styles.finishedContainer}>
          <Icon  
            name={winner ? "trophy" : "handshake"} 
            size={64} 
            color={winner ? "#fbbf24" : "#00D2BE"} 
           />
          <Text style={styles.finishedTitle}>Game Over!</Text>
          <Text style={styles.finishedResult}>
            {winner ? 
              (winner === currentUser.uid ? '🎉 You won!' : `🏆 ${winnerName} won!`) :
              '🤝 It\'s a draw!'
            }
          </Text>
          
          <TouchableOpacity 
            style={styles.playAgainButton} 
            onPress={() => navigation.navigate('Games')}
          >
            <LinearGradient colors={['#00D2BE', '#00A89E']} style={styles.playAgainGradient}>
              <Icon  name="refresh" size={20} color="#0A0A0C"  />
              <Text style={styles.playAgainText}>Play Again</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  if (loading || !gameData) {
    return (
      <ScreenContainer noSafeArea={true} style={styles.screenContainer}>
        <View style={[styles.container, styles.centered]}>
          <Text style={styles.loadingText}>Loading game...</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer noSafeArea={true} style={styles.screenContainer}>
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon  name="chevron-back" size={24} color="#fff"  />
        </TouchableOpacity>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {GameService.getGameDisplayName(gameType)}
          </Text>
          <Text style={styles.headerSubtitle}>
            {gameData.status === 'waiting' ? 'Setting up...' :
             gameData.status === 'active' ? 'Playing now' : 'Game over'}
          </Text>
        </View>

        <TouchableOpacity onPress={handleLeaveGame} style={styles.leaveButton}>
          <Icon  name="exit-outline" size={24} color="#ef4444"  />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Players Section */}
        <View style={styles.playersSection}>
          <Text style={styles.sectionTitle}>
            Players ({gameData.players.length}/{gameData.maxPlayers})
          </Text>
          <FlatList
            data={gameData.players}
            renderItem={renderPlayer}
            keyExtractor={(item) => item}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.playersListContent}
          />
        </View>

        {/* Game Content */}
        <View style={styles.gameSection}>
          {renderGameContent()}
        </View>
      </ScrollView>
    </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  screenContainer: {
    paddingTop: 0,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 50,
    borderBottomWidth: 1,
    borderBottomColor: '#141418',
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
  },
  leaveButton: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  playersSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#141418',
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  playersListContent: {
    paddingRight: 16,
  },
  playerItem: {
    backgroundColor: '#141418',
    borderRadius: 12,
    padding: 12,
    marginRight: 12,
    width: 120,
    borderWidth: 1,
    borderColor: '#27272E',
  },
  playerInfo: {
    alignItems: 'center',
  },
  playerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#00D2BE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  playerAvatarText: {
    color: '#0A0A0C',
    fontSize: 16,
    fontWeight: 'bold',
  },
  playerDetails: {
    alignItems: 'center',
  },
  playerName: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 2,
  },
  hostBadge: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 2,
  },
  playerScore: {
    color: '#9ca3af',
    fontSize: 10,
  },
  playerStatus: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gameSection: {
    flex: 1,
    padding: 16,
  },
  waitingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  waitingTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  waitingText: {
    color: '#9ca3af',
    fontSize: 16,
    marginBottom: 30,
  },
  startButton: {
    borderRadius: 25,
    marginBottom: 16,
  },
  startButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  inviteButton: {
    backgroundColor: '#141418',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#27272E',
  },
  inviteButtonText: {
    color: '#00D2BE',
    fontSize: 14,
    fontWeight: '600',
  },
  comingSoonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  comingSoonTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  comingSoonText: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 30,
  },
  endGameButton: {
    borderRadius: 25,
  },
  endGameGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  endGameText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  finishedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  finishedTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 8,
  },
  finishedResult: {
    color: '#00D2BE',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 30,
    textAlign: 'center',
  },
  playAgainButton: {
    borderRadius: 25,
  },
  playAgainGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  playAgainText: {
    color: '#0A0A0C',
    fontSize: 16,
    fontWeight: '800',
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
  },
});

export default GameRoomScreen;