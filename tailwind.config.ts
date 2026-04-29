/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
      },
      colors: {
        ink: {
          50: '#f5f0eb',
          100: '#e8ddd0',
          200: '#c9b8a0',
          300: '#a89070',
          400: '#8a6e4e',
          500: '#6d4f32',
          600: '#573d24',
          700: '#402c18',
          800: '#2a1c0e',
          900: '#150e06',
        },
        paper: {
          50: '#fdfaf6',
          100: '#f9f3ea',
          200: '#f0e4ce',
          300: '#e5d0ad',
        },
        accent: '#c0392b',
        'accent-light': '#e74c3c',
      },
    },
  },
  plugins: [],
};
