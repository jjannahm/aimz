import type { TextStyle, ViewStyle } from 'react-native';

export const palette = {
  ink: '#08080C',
  paper: '#F5F2EA',
  blue: '#3B82F6',
  skyBlue: '#0EA2E7',
  deepBlue: '#1E40AF',
  magenta: '#E1306C',
  orange: '#F77737',
  yellow: '#FCAF45',
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#EF4444',
  gold: '#FFC53D',
  deepGold: '#A16207',
} as const;

/** AIMZ editorial dark mode: warm ink, flat cards, and the academy blue. */
const dark = {
  background: '#08080C',
  surface: '#121216',
  surfaceRaised: '#1A1A20',
  border: '#2C2B32',
  accent: palette.blue,
  accentSoft: palette.skyBlue,
  selectionSurface: '#1A1A20',
  onAccent: '#08080C',
  textPrimary: '#F5F2EA',
  textSecondary: '#C4C0C8',
  textMuted: '#94909A',
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
  // A label printed on top of `live`, `warning` or `error` used as a fill. Those
  // three are bright here and dark in light mode, so the label has to flip with
  // the palette and can follow neither `onAccent` nor `onError` on its own.
  onStatus: '#08080C',
  leaderSurface: '#1A1A20',
  leaderAccent: palette.blue,
  // The trophy is the one thing in the app that is won rather than shown, and
  // it was reading as another blue glyph among many. `trophyGlow` is the halo
  // burnt around the glyph rather than a second fill: warmer and more saturated
  // than the gold itself, so the spread reads as light and not as a fat outline.
  trophy: palette.gold,
  trophyGlow: '#FFAA00',
  progressTrack: '#2C2B32',
  highlightedSurface: '#1A1A20',
} as const;

export type ThemeColors = Record<keyof typeof dark, string>;

export const darkColors: ThemeColors = dark;

/** The original AIMZ light-blue atmosphere, applied to the compact flat UI. */
export const lightColors: ThemeColors = {
  background: '#A6C4E8',
  surface: '#F9FCFF',
  surfaceRaised: '#E7EDF6',
  border: '#D8DFE9',
  accent: palette.blue,
  accentSoft: palette.deepBlue,
  selectionSurface: '#E7EDF6',
  onAccent: '#08080C',
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
  onStatus: '#FFFFFF',
  leaderSurface: '#E7EDF6',
  leaderAccent: palette.deepBlue,
  // Bright gold on a near-white card is barely there, so light mode wins its
  // contrast back by going down to the deeper end of the same metal, and glows
  // in amber rather than in white light nobody would see.
  trophy: palette.deepGold,
  trophyGlow: palette.amber,
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
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
    xxxl: 48,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 18,
    pill: 999,
  },
  type: {
    caption: 12,
    label: 14,
    body: 16,
    heading: 22,
    display: 28,
    score: 34,
  },
  font: {
    regular: 'Roboto_400Regular',
    medium: 'Roboto_500Medium',
    semibold: 'Roboto_600SemiBold',
    bold: 'Roboto_700Bold',
    // Roboto Mono is tabular at both weights, so the score and standings
    // columns keep the alignment `fontVariant: ['tabular-nums']` asks for.
    mono: 'RobotoMono_500Medium',
    monoBold: 'RobotoMono_700Bold',
  },
  typography: {
    caption: { fontFamily: 'Roboto_500Medium', fontSize: 12, lineHeight: 16 },
    label: { fontFamily: 'Roboto_600SemiBold', fontSize: 14, lineHeight: 18 },
    body: { fontFamily: 'Roboto_400Regular', fontSize: 16, lineHeight: 24 },
    heading: { fontFamily: 'Roboto_700Bold', fontSize: 22, lineHeight: 27 },
    display: { fontFamily: 'Roboto_700Bold', fontSize: 28, lineHeight: 34 },
    numeric: { fontFamily: 'RobotoMono_500Medium', fontVariant: ['tabular-nums'] },
    numericBold: { fontFamily: 'RobotoMono_700Bold', fontVariant: ['tabular-nums'] },
  },
  size: {
    cardPadding: 12,
    field: 48,
    listRow: 60,
    phoneGutter: 16,
    tabletGutter: 24,
    sectionGap: 16,
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

/** The same suppression for a text input, whose style is a `TextStyle`. */
export const noFocusRingText: TextStyle = { outlineStyle: 'solid', outlineWidth: 0 };
