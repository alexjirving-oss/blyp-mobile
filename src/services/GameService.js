import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  onSnapshot, 
  query, 
  where, 
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  getDoc,
  limit
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';

class GameService {
  // Create a new game room
  static async createGameRoom(gameType, isPrivate = false, invitedUsers = []) {
    const currentUser = auth.currentUser;
    
    const initialGameState = this.getInitialGameState(gameType);
    
    const gameData = {
      gameType,
      hostId: currentUser.uid,
      players: [currentUser.uid],
      invitedUsers: invitedUsers,
      status: 'waiting', // waiting, active, finished
      isPrivate,
      createdAt: serverTimestamp(),
      maxPlayers: this.getMaxPlayers(gameType),
      gameState: initialGameState.gameState || {},
      currentRound: initialGameState.currentRound || 1,
      scores: { [currentUser.uid]: 0 },
      playerData: {
        [currentUser.uid]: {
          name: currentUser.displayName || 'Player',
          avatar: currentUser.photoURL || '',
          score: 0,
          ready: false,
          joinedAt: serverTimestamp()
        }
      },
      winner: null,
      completedAt: null
    };

    const gameRef = await addDoc(collection(db, 'gameRooms'), gameData);
    
    // Create game activity post for social feed (optional)
    if (!isPrivate) {
      try {
        await this.createGamePost(gameRef.id, gameType, 'created');
      } catch (error) {
        console.log('Game post creation skipped - posts collection may not exist yet');
      }
    }
    
    return gameRef.id;
  }

  // Subscribe to available public games - simplified to avoid index requirements
  static subscribeToAvailableGames(callback) {
    const gamesQuery = query(
      collection(db, 'gameRooms'),
      where('status', '==', 'waiting'),
      limit(20)
    );
    
    return onSnapshot(gamesQuery, (snapshot) => {
      // Filter out private games on client side to avoid compound index
      const games = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(game => !game.isPrivate)
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      
      // Transform back to snapshot-like format for existing code compatibility
      const mockSnapshot = {
        docs: games.map(game => ({
          id: game.id,
          data: () => game
        }))
      };
      callback(mockSnapshot);
    });
  }

  // Subscribe to user's games - simplified to avoid index requirements
  static subscribeToUserGames(userId, callback) {
    const gamesQuery = query(
      collection(db, 'gameRooms'),
      where('players', 'array-contains', userId),
      limit(50)
    );
    
    return onSnapshot(gamesQuery, (snapshot) => {
      // Sort on client side to avoid compound index
      const games = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      
      // Transform back to snapshot-like format for existing code compatibility
      const mockSnapshot = {
        docs: games.map(game => ({
          id: game.id,
          data: () => game
        }))
      };
      callback(mockSnapshot);
    });
  }

  // Join an existing game
  static async joinGame(gameId) {
    const currentUser = auth.currentUser;
    const gameRef = doc(db, 'gameRooms', gameId);
    
    await updateDoc(gameRef, {
      players: arrayUnion(currentUser.uid),
      [`playerData.${currentUser.uid}`]: {
        name: currentUser.displayName || 'Player',
        avatar: currentUser.photoURL || '',
        score: 0,
        ready: false,
        joinedAt: serverTimestamp()
      },
      [`scores.${currentUser.uid}`]: 0
    });
  }

  // Subscribe to game updates
  static subscribeToGame(gameId, callback) {
    const gameRef = doc(db, 'gameRooms', gameId);
    return onSnapshot(gameRef, callback);
  }

  // Start game (host only)
  static async startGame(gameId) {
    const gameRef = doc(db, 'gameRooms', gameId);
    
    await updateDoc(gameRef, {
      status: 'active',
      startedAt: serverTimestamp()
    });
  }

  // Make game move (Rock Paper Scissors)
  static async makeMove(gameId, playerId, round, choice) {
    const gameRef = doc(db, 'gameRooms', gameId);
    
    // Get current game state
    const gameDoc = await getDoc(gameRef);
    if (!gameDoc.exists()) {
      throw new Error('Game not found');
    }
    
    const gameData = gameDoc.data();
    const roundKey = `round_${round}`;
    const currentGameState = gameData.gameState || {};
    
    // Update the specific round with player's choice
    const updatedGameState = {
      ...currentGameState,
      [roundKey]: {
        ...currentGameState[roundKey],
        [playerId]: choice
      }
    };
    
    // Check if round is complete (both players made moves)
    const roundData = updatedGameState[roundKey];
    const playerIds = Object.keys(roundData);
    
    if (playerIds.length === 2) {
      // Round complete, determine winner and update scores
      const [player1, player2] = playerIds;
      const choice1 = roundData[player1];
      const choice2 = roundData[player2];
      
      const roundWinner = this.determineRockPaperScissorsWinner(choice1, choice2, player1, player2);
      
      // Update scores
      const currentScores = gameData.scores || {};
      if (roundWinner) {
        currentScores[roundWinner] = (currentScores[roundWinner] || 0) + 1;
      }
      
      // Check if game is complete (5 rounds)
      const maxRounds = 5;
      let gameWinner = null;
      if (round >= maxRounds) {
        // Determine game winner based on score
        const player1Score = currentScores[player1] || 0;
        const player2Score = currentScores[player2] || 0;
        
        if (player1Score > player2Score) gameWinner = player1;
        else if (player2Score > player1Score) gameWinner = player2;
        // If tied, gameWinner remains null
      }
      
      await updateDoc(gameRef, {
        gameState: updatedGameState,
        scores: currentScores,
        currentRound: round,
        ...(gameWinner !== undefined && {
          status: 'finished',
          winner: gameWinner,
          completedAt: serverTimestamp()
        })
      });
    } else {
      // Just update the move
      await updateDoc(gameRef, {
        gameState: updatedGameState,
        currentRound: round
      });
    }
  }

  // Determine Rock Paper Scissors winner
  static determineRockPaperScissorsWinner(choice1, choice2, player1, player2) {
    if (choice1 === choice2) return null; // Draw
    
    const winConditions = {
      rock: 'scissors',
      scissors: 'paper', 
      paper: 'rock'
    };
    
    return winConditions[choice1] === choice2 ? player1 : player2;
  }

  // End game and update scores
  static async endGame(gameId, winnerId = null) {
    const gameRef = doc(db, 'gameRooms', gameId);
    
    const updateData = {
      status: 'finished',
      completedAt: serverTimestamp(),
      winner: winnerId
    };

    // Update winner's score
    if (winnerId) {
      updateData[`playerData.${winnerId}.score`] = 1;
    }

    await updateDoc(gameRef, updateData);

    // Create completion post for social feed (optional)
    try {
      const gameDoc = await getDoc(gameRef);
      if (gameDoc.exists() && !gameDoc.data().isPrivate) {
        await this.createGamePost(gameId, gameDoc.data().gameType, 'finished', winnerId);
      }
    } catch (error) {
      console.log('Game completion post skipped');
    }
  }

  // Create social media post for game activities (optional feature)
  static async createGamePost(gameId, gameType, action, winnerId = null) {
    try {
      const currentUser = auth.currentUser;
      
      let content = '';
      if (action === 'created') {
        content = `🎮 Started a new ${this.getGameDisplayName(gameType)} game! Join me!`;
      } else if (action === 'finished' && winnerId) {
        const winnerDoc = await getDoc(doc(db, 'users', winnerId));
        const winnerName = winnerDoc.exists() ? winnerDoc.data().displayName : 'Someone';
        content = `🏆 ${winnerName} won our ${this.getGameDisplayName(gameType)} game!`;
      }

      if (content) {
        const post = {
          userId: currentUser.uid,
          username: currentUser.displayName || 'User',
          userAvatar: currentUser.photoURL || '',
          content: content,
          type: 'game',
          gameId: gameId,
          gameType: gameType,
          timestamp: serverTimestamp(),
          likes: [],
          comments: []
        };

        await addDoc(collection(db, 'posts'), post);
      }
    } catch (error) {
      console.log('Game post creation skipped - posts collection may not exist');
    }
  }

  // Get game statistics for user
  static async getUserGameStats(userId) {
    return new Promise((resolve) => {
      const gamesQuery = query(
        collection(db, 'gameRooms'),
        where('players', 'array-contains', userId),
        where('status', '==', 'finished'),
        limit(100)
      );

      onSnapshot(gamesQuery, (snapshot) => {
        const games = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        const stats = {
          totalGames: games.length,
          wins: games.filter(game => game.winner === userId).length,
          losses: games.filter(game => game.winner && game.winner !== userId).length,
          draws: games.filter(game => !game.winner).length,
          favoriteGame: this.getMostPlayedGame(games),
          winRate: 0
        };

        stats.winRate = stats.totalGames > 0 ? (stats.wins / stats.totalGames) * 100 : 0;
        resolve(stats);
      });
    });
  }

  // Helper methods
  static getMaxPlayers(gameType) {
    const maxPlayers = {
      'tic-tac-toe': 2,
      'rock-paper-scissors': 2,
      'word-guess': 4,
      'quick-draw': 8,
      'trivia': 6
    };
    return maxPlayers[gameType] || 2;
  }

  static getGameDisplayName(gameType) {
    const names = {
      'tic-tac-toe': 'Tic Tac Toe',
      'rock-paper-scissors': 'Rock Paper Scissors',
      'word-guess': 'Word Guess',
      'quick-draw': 'Quick Draw',
      'trivia': 'Trivia Quiz'
    };
    return names[gameType] || gameType;
  }

  static getInitialGameState(gameType) {
    switch (gameType) {
      case 'tic-tac-toe':
        return {
          board: Array(9).fill(null),
          currentPlayer: 0,
          winner: null,
          moves: []
        };
      case 'rock-paper-scissors':
        return {
          currentRound: 1,
          maxRounds: 5,
          scores: {},
          gameState: {},
          moves: []
        };
      case 'word-guess':
        return {
          currentWord: '',
          guesses: [],
          currentGuesser: 0,
          round: 1,
          maxRounds: 5,
          moves: []
        };
      case 'quick-draw':
        return {
          currentPrompt: '',
          drawings: {},
          round: 1,
          maxRounds: 3,
          votes: {},
          moves: []
        };
      case 'trivia':
        return {
          currentQuestion: null,
          questionIndex: 0,
          playerAnswers: {},
          scores: {},
          round: 1,
          maxRounds: 10,
          moves: []
        };
      default:
        return { moves: [] };
    }
  }

  static getMostPlayedGame(games) {
    if (games.length === 0) return 'None';
    
    const gameTypeCounts = {};
    games.forEach(game => {
      gameTypeCounts[game.gameType] = (gameTypeCounts[game.gameType] || 0) + 1;
    });
    
    const mostPlayed = Object.keys(gameTypeCounts).reduce((a, b) => 
      gameTypeCounts[a] > gameTypeCounts[b] ? a : b
    );
    
    return this.getGameDisplayName(mostPlayed);
  }
}

export default GameService;