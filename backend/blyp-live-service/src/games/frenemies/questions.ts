/** Simple v1 question bank for empty-box quiz challenges. */

export type QuizQuestion = {
  question: string;
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
};

export const QUIZ_BANK: QuizQuestion[] = [
  { question: 'What is 7 × 8?', choices: ['54', '56', '64', '48'], correctIndex: 1 },
  { question: 'What is 12 + 15?', choices: ['25', '27', '28', '26'], correctIndex: 1 },
  { question: 'What is 9 × 9?', choices: ['72', '81', '99', '89'], correctIndex: 1 },
  { question: 'Capital of France?', choices: ['Berlin', 'Madrid', 'Paris', 'Rome'], correctIndex: 2 },
  { question: 'How many continents?', choices: ['5', '6', '7', '8'], correctIndex: 2 },
  { question: 'Largest planet in our solar system?', choices: ['Earth', 'Saturn', 'Jupiter', 'Neptune'], correctIndex: 2 },
  { question: 'What is 100 − 37?', choices: ['63', '73', '67', '53'], correctIndex: 0 },
  { question: 'Water freezes at (°C)?', choices: ['0', '10', '32', '100'], correctIndex: 0 },
  { question: 'How many sides does a hexagon have?', choices: ['5', '6', '7', '8'], correctIndex: 1 },
  { question: 'Primary colors of light (RGB)?', choices: ['Red Green Blue', 'Red Yellow Blue', 'Cyan Magenta Yellow', 'Black White Grey'], correctIndex: 0 },
  { question: 'What is 5²?', choices: ['10', '20', '25', '15'], correctIndex: 2 },
  { question: 'Which animal is a mammal?', choices: ['Shark', 'Dolphin', 'Octopus', 'Crocodile'], correctIndex: 1 },
];

export const CHAT_PHRASES = [
  'blyp',
  'frenemies',
  'house coins',
  'spin me',
  'throw out',
  'box party',
  'live vibes',
  'go blyp',
] as const;

export function pickQuiz(seed: number): QuizQuestion {
  const i = Math.abs(seed) % QUIZ_BANK.length;
  return QUIZ_BANK[i];
}

export function pickPhrase(seed: number): string {
  const i = Math.abs(seed) % CHAT_PHRASES.length;
  return CHAT_PHRASES[i];
}
