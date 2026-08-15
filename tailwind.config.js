/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/games/grid9/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};
