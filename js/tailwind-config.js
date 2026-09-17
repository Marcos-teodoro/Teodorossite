// Tema e tokens de marca Teodora (Tailwind CDN)
tailwind.config = {
  theme: {
    extend: {
      colors: {
        teodora: {
          white: '#FFFFFF',
          bgLight: '#FCFAF9',
          cream: '#F8F4F1',
          blush: '#F6EDEA',
          page: '#FDFBF8',
          roseSoft: '#E8D4D0',
          roseMedium: '#D5B7B2',
          roseLight: '#F7EFEB',
          gold: '#C5A059',
          goldLight: '#F0E6D8',
          goldDark: '#A6823F',
          text: '#1E1A1A',
          textMuted: '#6E6565',
          border: '#EDE4E0',
          borderSubtle: '#F0E8E5'
        }
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Montserrat"', '-apple-system', 'sans-serif'],
        script: ['"Great Vibes"', 'cursive']
      },
      boxShadow: {
        'subtle': '0 4px 20px -2px rgba(45, 38, 38, 0.04)',
        'card-clean': '0 10px 25px -4px rgba(45, 38, 38, 0.06)',
        'card-hover': '0 20px 35px -8px rgba(197, 160, 89, 0.14)',
        'drawer': '-15px 0 45px rgba(30, 26, 26, 0.12)'
      }
    }
  }
};
