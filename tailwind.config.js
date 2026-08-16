/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/games/grid9/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        blyp: {
          ink: '#0A0A0C',
          surface: '#141418',
          card: '#121216',
          alt: '#1C1C22',
          primary: '#00D2BE',
          primaryDark: '#00A89E',
          primaryLight: '#7FEDE2',
          text: '#F5F5F7',
          muted: '#A1A1AA',
          faint: '#71717A',
        },
      },
    },
  },
  plugins: [],
};
