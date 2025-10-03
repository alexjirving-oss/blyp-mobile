export const gameConfig = {
  defaultGameSettings: {
    maxPlayers: 4,
    minPlayers: 2,
    gameDuration: 30, // in minutes
  },
  gameTypes: [
    {
      id: '1',
      title: 'Trivia',
      description: 'A fun trivia game where players answer questions to score points.',
      rules: 'Players take turns answering questions. The player with the most points wins.',
    },
    {
      id: '2',
      title: 'Pictionary',
      description: 'A drawing game where players guess what is being drawn.',
      rules: 'One player draws a word while others guess. Points are awarded for correct guesses.',
    },
    {
      id: '3',
      title: 'Chess',
      description: 'A classic strategy game played on an 8x8 board.',
      rules: 'Players take turns moving pieces. The objective is to checkmate the opponent\'s king.',
    },
  ],
};