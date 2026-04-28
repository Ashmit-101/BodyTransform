/**
 * BodyTransform — Premium Dark Theme
 * 
 * Centralized design tokens for the entire app.
 */

export const colors = {
  // Backgrounds
  background: '#0A0A0F',
  surface: '#13131A',
  surfaceLight: '#1C1C28',
  card: 'rgba(255, 255, 255, 0.05)',
  cardBorder: 'rgba(255, 255, 255, 0.08)',

  // Accents
  primary: '#6C63FF',       // vibrant purple
  primaryLight: '#8B83FF',
  primaryDark: '#4A42D4',
  secondary: '#00D9FF',     // electric cyan
  secondaryDark: '#00A8C6',

  // Feedback
  success: '#00E676',
  warning: '#FFB74D',
  danger: '#FF5252',

  // Text
  text: '#F0F0F5',
  textSecondary: '#8888A0',
  textMuted: '#555568',

  // Overlays
  overlay: 'rgba(0, 0, 0, 0.6)',
  overlayLight: 'rgba(0, 0, 0, 0.3)',
  glass: 'rgba(255, 255, 255, 0.04)',
  glassBorder: 'rgba(255, 255, 255, 0.1)',

  // Camera
  shutter: '#FFFFFF',
  shutterGlow: 'rgba(108, 99, 255, 0.5)',
};

export const typography = {
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  heading: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: colors.text,
  },
  bodySmall: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.textSecondary,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  number: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  glow: (color = colors.primary) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  }),
};
