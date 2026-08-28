import type { ViewStyle } from 'react-native';

export const palette = {
  navy: '#16225A',
  deepNavy: '#0F1A45',
  accentBlue: '#3D9BE9',
  lightBlue: '#6FC5F0',
  white: '#FFFFFF',
  magenta: '#E1306C',
  orange: '#F77737',
  yellow: '#FCAF45',
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#EF4444',
} as const;

/**
 * Azure Pro, the app's dark theme.
 *
 * Values are the theme's own shadcn tokens converted to sRGB. `surface` matching
 * `background` is deliberate: Azure Pro sets `--card` equal to `--background`, so
 * its cards read as outlined rather than raised. Where a role has no token in the
 * theme — the status colours, mostly — the AIMZ hue is kept and checked for
 * contrast against this background.
 */
const dark = {
  background: '#020817',
  surface: '#020817',
  surfaceRaised: '#1E293B',
  // `surfaceRaised` with the page left showing through, for a surface that is
  // frosted rather than laid on top. Only the web build blurs what is behind it.
  surfaceGlass: 'rgba(30, 41, 59, 0.72)',
  border: '#1E293B',
  accent: '#3B82F6',
  accentSoft: '#0EA2E7',
  // The accent laid *over* a surface rather than replacing it, so whatever sits
  // on top keeps reading the way it did off it, and the halo it throws.
  selectionSurface: 'rgba(59, 130, 246, 0.75)',
  selectionGlow: 'rgba(59, 130, 246, 0.9)',
  onAccent: '#0F172A',
  textPrimary: '#F8FAFC',
  textSecondary: '#CBD5E1',
  textMuted: '#94A3B8',
  live: '#22C55E',
  liveSurface: '#14532D',
  liveText: '#86EFAC',
  warning: '#F59E0B',
  warningSurface: '#78350F',
  warningText: '#FCD34D',
  error: '#EF4444',
  errorSurface: '#7F1D1D',
  errorText: '#FCA5A5',
  onError: '#F8FAFC',
  leaderSurface: '#4A3A12',
  leaderAccent: '#FCAF45',
  progressTrack: '#1E293B',
  highlightedSurface: '#1E293B',
} as const;

export type ThemeColors = Record<keyof typeof dark, string>;

export const darkColors: ThemeColors = dark;

/**
 * Vercel remix, the app's light theme.
 *
 * The saturated pale blue really is the theme's `--background`; near-white is its
 * `--card`, so screens sit on blue and cards float on top. Text and status hues
 * are darkened from the published tokens where the raw value could not clear
 * WCAG AA against that blue — `textMuted` most of all, which the theme leaves at
 * 3.07:1.
 */
export const lightColors: ThemeColors = {
  background: '#A6C4E8',
  surface: '#F9FCFF',
  surfaceRaised: '#E7EDF6',
  surfaceGlass: 'rgba(231, 237, 246, 0.72)',
  border: '#D8DFE9',
  accent: '#101723',
  accentSoft: '#1E40AF',
  // This theme's own accent is near-black, so the selection takes its blue from
  // `accentSoft` — a wash of the accent itself would read as grey.
  selectionSurface: 'rgba(30, 64, 175, 0.6)',
  selectionGlow: 'rgba(30, 64, 175, 0.55)',
  onAccent: '#FAFAFA',
  textPrimary: '#060A12',
  textSecondary: '#334155',
  textMuted: '#4B5563',
  live: '#166534',
  liveSurface: '#DCFCE7',
  liveText: '#14532D',
  warning: '#92400E',
  warningSurface: '#FEF3C7',
  warningText: '#78350F',
  error: '#B91C1C',
  errorSurface: '#E7000A',
  errorText: '#991B1B',
  onError: '#FFFFFF',
  leaderSurface: '#FEF3C7',
  leaderAccent: '#A16207',
  progressTrack: '#D8DFE9',
  highlightedSurface: '#E7EDF6',
};

export type ThemeMode = 'light' | 'dark';
export type ThemePreference = ThemeMode | 'system';

export const themeColors: Record<ThemeMode, ThemeColors> = {
  dark: darkColors,
  light: lightColors,
};

/**
 * Everything that does not change with the colour scheme.
 *
 * Colours live in `themeColors` and reach components through `useColors`, so a
 * module-scope constant built from this object stays correct in both modes.
 */
export const theme = {
  gradient: [palette.magenta, palette.orange, palette.yellow] as const,
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    xxxl: 64,
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 20,
    pill: 999,
  },
  type: {
    caption: 12,
    label: 14,
    body: 16,
    heading: 22,
    display: 30,
    score: 36,
  },
  touch: {
    minimum: 44,
  },
  motion: {
    quick: 160,
    standard: 240,
  },
} as const;

export type Theme = typeof theme;

/**
 * Switches off the focus ring a browser draws on a pressable.
 *
 * React Native Web renders `accessibilityRole="button"` as a `<button>` and
 * resets that element for us, but a `role="tab"` pressable is a plain div and
 * keeps the platform ring — a pale halo outside the pill that reads as a stray
 * second border for as long as the tab holds focus after a tap. A width of zero
 * will not do it on its own: the ring is drawn with `outline-style: auto`,
 * which ignores both a width and a colour, so the style has to be overruled
 * too. Naming a drawn style at no width says that in terms React Native's own
 * outline props take as well, which keeps this silent on iOS and Android —
 * they parse `outlineStyle`, and know only `solid`, `dotted` and `dashed`.
 */
export const noFocusRing: ViewStyle = { outlineStyle: 'solid', outlineWidth: 0 };
