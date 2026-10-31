// Tailwind is used by the employees' app (/me) only — the HR app is styled
// with antd. Ionic brings its own base styles, so Tailwind's reset is off.
/** @type {import('tailwindcss').Config} */
export default {
  // Relative to this file, whatever folder the build is started from.
  content: { relative: true, files: ['./me/index.html', './src/me/**/*.{ts,tsx}'] },
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        wine: {
          50: '#FDF2F4',
          100: '#FCE7EB',
          200: '#F9D0D9',
          500: '#BE185D',
          600: '#9F1239',
          700: '#881337',
          900: '#4C0519',
        },
        cocoa: { 700: '#6B3B42', 800: '#4A2E2B', 900: '#2E1F1D' },
        cream: '#FAF9F7',
      },
      fontFamily: {
        lao: ['"Noto Sans Lao"', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
