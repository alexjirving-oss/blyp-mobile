import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import DrawingCanvas from './DrawingCanvas';
import QuickDrawLogic from './QuickDrawLogic';

class QuickDrawGame extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      players: [],
      currentPlayer: null,
      drawing: null,
      score: {},
      gameStatus: 'waiting', // waiting, in-progress, finished
    };
  }

  componentDidMount() {
    this.initializeGame();
  }

  initializeGame = () => {
    // Initialize game state and players
    const { players } = this.props;
    this.setState({
      players,
      currentPlayer: players[0],
      gameStatus: 'in-progress',
    });
  };

  handleDrawing = (drawing) => {
    this.setState({ drawing });
  };

  evaluateDrawing = () => {
    const { drawing } = this.state;
    const score = QuickDrawLogic.evaluateDrawing(drawing);
    this.updateScore(this.state.currentPlayer, score);
    this.nextTurn();
  };

  updateScore = (player, score) => {
    this.setState((prevState) => ({
      score: {
        ...prevState.score,
        [player]: (prevState.score[player] || 0) + score,
      },
    }));
  };

  nextTurn = () => {
    const { players, currentPlayer } = this.state;
    const currentIndex = players.indexOf(currentPlayer);
    const nextIndex = (currentIndex + 1) % players.length;
    this.setState({
      currentPlayer: players[nextIndex],
      drawing: null,
    });
  };

  render() {
    const { currentPlayer, drawing, score, gameStatus } = this.state;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Quick Draw Game</Text>
        <Text style={styles.currentPlayer}>Current Player: {currentPlayer}</Text>
        <DrawingCanvas onDraw={this.handleDrawing} />
        <Text style={styles.score}>Score: {JSON.stringify(score)}</Text>
        {gameStatus === 'in-progress' && (
          <Text style={styles.instructions}>Draw something!</Text>
        )}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  title: {
    fontSize: 24,
    color: '#ffffff',
    marginBottom: 20,
  },
  currentPlayer: {
    fontSize: 18,
    color: '#d1d5db',
    marginBottom: 10,
  },
  score: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 20,
  },
  instructions: {
    fontSize: 16,
    color: '#ffffff',
    marginTop: 10,
  },
});

export default QuickDrawGame;