/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Fondos
        base: '#0F1117',
        card: '#1A1D26',
        border: '#2A2D36',
        // Acento
        accent: '#F2FE54',
        // Texto
        'text-primary': '#FFFFFF',
        'text-secondary': '#9CA3AF',
        // Estados
        positive: '#22C55E',
        negative: '#EF4444',
        // Colores de plataforma
        meta: '#0081FB',
        google: '#34A853',
        tiktok: '#FF004F',
        instagram: '#E1306C',
        facebook: '#1877F2',
        youtube: '#FF0000',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '12px',
        control: '8px',
      },
      maxWidth: {
        content: '1440px',
      },
    },
  },
  plugins: [],
}
