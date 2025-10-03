import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  Dimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import GameService from '../services/GameService';

const { width } = Dimensions.get('window');

const CHOICES = [
  { id: 'rock', emoji: '✊', name: 'Rock', color: '#8B5A3C' },
  { id: 'paper', emoji: '✋', name: 'Paper', color: '#4A90E2' },
  { id: 'scissors', emoji: '✌️', name: 'Scissors', color: '#E94B3C' }
];

const RockPaperScissorsGame = ({ gameData, gameId, currentUser, onGameUpdate }) => {
  const [myChoice, setMyChoice] = useState(null);
  const [opponentChoice, setOpponentChoice] = useState(null);
  const [gameState, setGameState] = useState(gameData.gameState || {});
  const [currentRound, setCurrentRound] = useState(gameData.currentRound || 1);
  const [scores, setScores] = useState(gameData.scores || {});
  const [roundResult, setRoundResult] = useState(null);
  const [isWaitingForOpponent, setIsWaitingForOpponent] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [showResult, setShowResult] = useState(false);
  
  // Animation values
  const choiceScale = new Animated.Value(1);
  const resultOpacity = new Animated.Value(0);
  const countdownScale = new Animated.Value(1);

  const opponent = gameData.players.find(p => p !== currentUser.uid);
  const maxRounds = 5;

  useEffect(() => {
    // Subscribe to game updates
    const unsubscribe = GameService.subscribeToGame(gameId, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setGameState(data.gameState || {});
        setCurrentRound(data.currentRound || 1);
        setScores(data.scores || {});
        
        // Check if opponent made a choice
        const opponentMove = data.gameState?.[`round_${data.currentRound || 1}`]?.[opponent];
        if (opponentMove && !myChoice) {
          setOpponentChoice(opponentMove);
          setIsWaitingForOpponent(false);
        }
        
        // Check if round is complete
        if (data.gameState?.[`round_${data.currentRound || 1}`]) {
          const roundData = data.gameState[`round_${data.currentRound || 1}`];
          if (roundData[currentUser.uid] && roundData[opponent]) {
            processRoundResult(roundData);
          }
        }

        onGameUpdate(data);
      }
    });

    return unsubscribe;
  }, [gameId, currentRound, opponent]);

  const makeChoice = async (choice) => {
    if (myChoice) return; // Already made choice this round
    
    setMyChoice(choice);
    setIsWaitingForOpponent(true);
    
    // Animate choice selection
    Animated.sequence([
      Animated.timing(choiceScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true
      }),
      Animated.timing(choiceScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true
      })
    ]).start();

    try {
      await GameService.makeMove(gameId, currentUser.uid, currentRound, choice.id);
    } catch (error) {
      console.error('Error making move:', error);
      Alert.alert('Error', 'Failed to make move. Please try again.');
      setMyChoice(null);
      setIsWaitingForOpponent(false);
    }
  };

  const processRoundResult = (roundData) => {
    const myMove = roundData[currentUser.uid];
    const opponentMove = roundData[opponent];
    
    setMyChoice(CHOICES.find(c => c.id === myMove));
    setOpponentChoice(CHOICES.find(c => c.id === opponentMove));
    
    const result = determineWinner(myMove, opponentMove);
    setRoundResult(result);
    setShowResult(true);
    
    // Animate result display
    Animated.timing(resultOpacity, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true
    }).start();
    
    // Auto-advance to next round after 3 seconds
    setTimeout(() => {
      nextRound();
    }, 3000);
  };

  const determineWinner = (choice1, choice2) => {
    if (choice1 === choice2) return 'draw';
    
    const winConditions = {
      rock: 'scissors',
      scissors: 'paper',
      paper: 'rock'
    };
    
    return winConditions[choice1] === choice2 ? 'win' : 'lose';
  };

  const nextRound = () => {
    if (currentRound >= maxRounds) {
      endGame();
      return;
    }

    setMyChoice(null);
    setOpponentChoice(null);
    setRoundResult(null);
    setShowResult(false);
    setIsWaitingForOpponent(false);
    
    // Reset animations
    resultOpacity.setValue(0);
    
    setCurrentRound(prev => prev + 1);
  };

  const endGame = async () => {
    const myScore = scores[currentUser.uid] || 0;
    const opponentScore = scores[opponent] || 0;
    
    let winner = null;
    if (myScore > opponentScore) winner = currentUser.uid;
    else if (opponentScore > myScore) winner = opponent;
    
    try {
      await GameService.endGame(gameId, winner);
    } catch (error) {
      console.error('Error ending game:', error);
    }
  };

  const startCountdown = () => {
    let count = 3;
    setCountdown(count);
    
    const countInterval = setInterval(() => {
      count--;
      if (count > 0) {
        setCountdown(count);
        // Animate countdown
        Animated.sequence([
          Animated.timing(countdownScale, {
            toValue: 1.5,
            duration: 200,
            useNativeDriver: true
          }),
          Animated.timing(countdownScale, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true
          })
        ]).start();
      } else {
        setCountdown(null);
        clearInterval(countInterval);
      }
    }, 1000);
  };

  const renderChoice = (choice, isSelected = false, isOpponent = false) => {
    const scale = isSelected ? choiceScale : new Animated.Value(1);
    
    return (
      <Animated.View
        style={[
          styles.choiceContainer,
          { transform: [{ scale }] },
          isSelected && styles.selectedChoice,
          isOpponent && styles.opponentChoice
        ]}
      >
        <LinearGradient
          colors={isSelected ? [choice.color, choice.color + '80'] : ['#374151', '#4B5563']}
          style={styles.choiceGradient}
        >
          <Text style={styles.choiceEmoji}>{choice.emoji}</Text>
          <Text style={styles.choiceName}>{choice.name}</Text>
        </LinearGradient>
      </Animated.View>
    );
  };

  const renderGameArea = () => {
    if (countdown) {
      return (
        <View style={styles.countdownContainer}>
          <Animated.Text
            style={[
              styles.countdownText,
              { transform: [{ scale: countdownScale }] }
            ]}
          >
            {countdown}
          </Animated.Text>
          <Text style={styles.countdownLabel}>Get Ready!</Text>
        </View>
      );
    }

    if (showResult && myChoice && opponentChoice) {
      return (
        <Animated.View
          style={[styles.resultContainer, { opacity: resultOpacity }]}
        >
          <View style={styles.choicesDisplay}>
            <View style={styles.playerChoice}>
              <Text style={styles.playerLabel}>You</Text>
              {renderChoice(myChoice, true)}
            </View>
            
            <View style={styles.vsContainer}>
              <Text style={styles.vsText}>VS</Text>
            </View>
            
            <View style={styles.playerChoice}>
              <Text style={styles.playerLabel}>Opponent</Text>
              {renderChoice(opponentChoice, true, true)}
            </View>
          </View>
          
          <View style={styles.roundResultContainer}>
            <Text style={[
              styles.roundResultText,
              roundResult === 'win' && styles.winText,
              roundResult === 'lose' && styles.loseText,
              roundResult === 'draw' && styles.drawText
            ]}>
              {roundResult === 'win' && '🎉 You Win!'}
              {roundResult === 'lose' && '😞 You Lose!'}
              {roundResult === 'draw' && '🤝 Draw!'}
            </Text>
          </View>
        </Animated.View>
      );
    }

    if (myChoice && isWaitingForOpponent) {
      return (
        <View style={styles.waitingContainer}>
          <View style={styles.myChoiceDisplay}>
            <Text style={styles.choiceLabel}>Your Choice:</Text>
            {renderChoice(myChoice, true)}
          </View>
          <Text style={styles.waitingText}>Waiting for opponent...</Text>
          <View style={styles.loadingDots}>
            <View style={[styles.dot, styles.dot1]} />
            <View style={[styles.dot, styles.dot2]} />
            <View style={[styles.dot, styles.dot3]} />
          </View>
        </View>
      );
    }

    return (
      <View style={styles.choiceSelection}>
        <Text style={styles.instructionText}>Choose your move:</Text>
        <View style={styles.choicesGrid}>
          {CHOICES.map((choice) => (
            <TouchableOpacity
              key={choice.id}
              style={styles.choiceButton}
              onPress={() => makeChoice(choice)}
              activeOpacity={0.8}
            >
              {renderChoice(choice)}
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header with scores and round info */}
      <View style={styles.header}>
        <View style={styles.scoreContainer}>
          <View style={styles.playerScore}>
            <Text style={styles.scoreLabel}>You</Text>
            <Text style={styles.scoreValue}>{scores[currentUser.uid] || 0}</Text>
          </View>
          
          <View style={styles.roundInfo}>
            <Text style={styles.roundText}>Round {currentRound}/{maxRounds}</Text>
          </View>
          
          <View style={styles.playerScore}>
            <Text style={styles.scoreLabel}>Opponent</Text>
            <Text style={styles.scoreValue}>{scores[opponent] || 0}</Text>
          </View>
        </View>
      </View>

      {/* Game Area */}
      <View style={styles.gameArea}>
        {renderGameArea()}
      </View>

      {/* Game Rules */}
      {!myChoice && !showResult && (
        <View style={styles.rulesContainer}>
          <Text style={styles.rulesTitle}>How to Play:</Text>
          <Text style={styles.rulesText}>
            • Rock crushes Scissors{'\n'}
            • Scissors cuts Paper{'\n'}
            • Paper covers Rock{'\n'}
            • Best of {maxRounds} rounds wins!
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  scoreContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  playerScore: {
    alignItems: 'center',
  },
  scoreLabel: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 4,
  },
  scoreValue: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  roundInfo: {
    alignItems: 'center',
  },
  roundText: {
    color: '#a855f7',
    fontSize: 16,
    fontWeight: '600',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  countdownContainer: {
    alignItems: 'center',
  },
  countdownText: {
    color: '#a855f7',
    fontSize: 80,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  countdownLabel: {
    color: '#fff',
    fontSize: 20,
    marginTop: 10,
  },
  choiceSelection: {
    alignItems: 'center',
    width: '100%',
  },
  instructionText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 30,
    textAlign: 'center',
  },
  choicesGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 20,
  },
  choiceButton: {
    flex: 1,
    marginHorizontal: 8,
  },
  choiceContainer: {
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
  },
  selectedChoice: {
    borderWidth: 3,
    borderColor: '#a855f7',
  },
  opponentChoice: {
    borderWidth: 3,
    borderColor: '#ef4444',
  },
  choiceGradient: {
    padding: 20,
    alignItems: 'center',
    minHeight: 100,
    justifyContent: 'center',
  },
  choiceEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  choiceName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  waitingContainer: {
    alignItems: 'center',
  },
  myChoiceDisplay: {
    alignItems: 'center',
    marginBottom: 30,
  },
  choiceLabel: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 15,
  },
  waitingText: {
    color: '#9ca3af',
    fontSize: 16,
    marginBottom: 20,
  },
  loadingDots: {
    flexDirection: 'row',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#a855f7',
  },
  dot1: { opacity: 1 },
  dot2: { opacity: 0.6 },
  dot3: { opacity: 0.3 },
  resultContainer: {
    alignItems: 'center',
    width: '100%',
  },
  choicesDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 30,
  },
  playerChoice: {
    alignItems: 'center',
    flex: 1,
  },
  playerLabel: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 10,
  },
  vsContainer: {
    alignItems: 'center',
    marginHorizontal: 20,
  },
  vsText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  roundResultContainer: {
    alignItems: 'center',
  },
  roundResultText: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  winText: {
    color: '#10b981',
  },
  loseText: {
    color: '#ef4444',
  },
  drawText: {
    color: '#fbbf24',
  },
  rulesContainer: {
    padding: 20,
    backgroundColor: '#1e293b',
    margin: 20,
    borderRadius: 16,
  },
  rulesTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  rulesText: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 20,
  },
});

export default RockPaperScissorsGame;