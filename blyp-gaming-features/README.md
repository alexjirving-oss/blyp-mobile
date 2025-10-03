# Blyp Gaming Features

This project implements gaming features for the Blyp social media app, enhancing user engagement through multiplayer functionality and game integration.

## Features

- **Game Browsing**: Users can browse a variety of games available to play.
- **Game Lobby**: Players can join or create game lobbies, view available games, and see current players.
- **Game Invitations**: Users can send invitations to friends to join games.
- **Leaderboard**: Displays top players and their scores, updating in real-time.
- **Multiplayer Support**: Real-time multiplayer functionality using WebSocket connections.
- **Game History**: Users can view their past games, including scores and outcomes.

## Project Structure

The project is organized into several directories:

- **src/components**: Contains reusable components like `GameCard`, `GameLobby`, `GameInvite`, and `Leaderboard`.
- **src/screens**: Contains screens for the app, including `GamesScreen`, `GameDetailScreen`, `MultiplayerLobbyScreen`, and `GameHistoryScreen`.
- **src/services**: Contains services for game and multiplayer functionalities.
- **src/types**: Contains TypeScript interfaces for game and multiplayer objects.
- **src/hooks**: Contains custom hooks for managing game and multiplayer state.
- **src/utils**: Contains utility functions for game logic and scoring.
- **src/config**: Contains configuration settings for games.

## Setup Instructions

1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```
   cd blyp-gaming-features
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Start the development server:
   ```
   npm start
   ```

## Development Commands

- `npm start`: Start the development server.
- `npm run android`: Run the app on an Android device.
- `npm run ios`: Run the app on an iOS device.

## Contributing

Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.