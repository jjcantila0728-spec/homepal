import type { Config } from 'tailwindcss';

// Theme colors mirror the CSS variables in app/globals.css so utilities like
// `text-emerald-500` and the design's arbitrary `bg-[var(--bg2)]` values both work.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './store/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
