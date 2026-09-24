/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      screens: {
        xs: '440px',
      },
      colors: {
        // Dark mode surfaces
        dark: {
          950: '#05080F',
          900: '#080D1A',
          800: '#0D1526',
          700: '#141F36',
          600: '#1E2D4D',
        },
        // Light mode surfaces
        light: {
          50:  '#F8FAFF',
          100: '#F0F4FF',
          200: '#E4EAFF',
          300: '#C7D2FE',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } }
      },
      zIndex: {
        '60': '60',
        '70': '70',
        '80': '80',
        '90': '90',
        '100': '100',
      }
    },
  },
  plugins: [],
}
