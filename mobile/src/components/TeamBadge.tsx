import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';

import type { BadgeStyle } from '@/src/types/api';

/**
 * The shield outline traced from the supplied AIMZ crest. Keeping every badge
 * on this silhouette makes fixtures feel coherent without pretending that an
 * opponent's generated fallback is its official badge.
 */
const SHIELD_PATH = 'M3.8 12.5 L14.0 3.5 L15.9 3.2 L24.8 5.2 L31.2 5.5 L39.5 4.1 L50.3 0.6 L62.4 4.4 L69.4 5.5 L77.1 5.0 L83.4 3.3 L87.3 3.4 L97.5 13.4 L97.6 15.8 L90.4 24.0 L89.2 29.5 L90.0 33.9 L97.7 49.7 L99.8 56.8 L100.0 64.5 L98.0 71.6 L94.0 77.6 L86.6 83.6 L53.8 98.9 L49.7 100.0 L46.5 98.9 L43.2 96.7 L12.8 83.1 L8.9 80.3 L3.0 72.7 L0.8 66.7 L0.8 56.8 L3.2 48.6 L9.4 37.7 L11.5 29.5 L9.6 22.4 L4.2 15.8 L3.3 13.1 Z';

const CREST_NAVY = '#031041';
const CREST_GOLD = '#C9B77C';
const CREST_WHITE = '#FFFFFF';
const BORDER_WIDTH = 4;
const STRIPE_X = [12.5, 26.2, 40.0, 54.0, 68.0, 82.0];
const STRIPE_WIDTH = 6.7;
const STRIPE_Y = 35;
const STRIPE_HEIGHT = 64;
const DETAIL_FROM = 30;
const STRIPES_FROM = 22;

/** Dark fills keep the white monograms above WCAG AA in either app theme. */
export const opponentBadgePalette = [
  { fill: '#1E3A8A', edge: '#93C5FD' },
  { fill: '#155E75', edge: '#67E8F9' },
  { fill: '#166534', edge: '#86EFAC' },
  { fill: '#7C2D12', edge: '#FDBA74' },
  { fill: '#6B21A8', edge: '#D8B4FE' },
  { fill: '#9F1239', edge: '#FDA4AF' },
] as const;

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return '?';
  const letters = words.length === 1
    ? (words[0] ?? '').slice(0, 2)
    : `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`;
  return letters.toUpperCase();
}

export function opponentBadgeColors(name: string) {
  const normalized = name.trim().toLocaleLowerCase('en');
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return opponentBadgePalette[(hash >>> 0) % opponentBadgePalette.length]!;
}

type Props = {
  /** AIMZ squads wear the club crest; everyone else gets a named fallback. */
  isAimz?: boolean;
  /**
   * The team's own badge, when it has been given one. A league of peer clubs
   * has no "our club", so which crest is drawn cannot ride on `isAimz` alone.
   */
  badgeStyle?: BadgeStyle | null;
  name: string;
  size?: number;
};

export function TeamBadge({ badgeStyle, isAimz = false, name, size = 44 }: Props) {
  // A standings table renders many SVGs at once on web, so every clip reference
  // must have a unique DOM-safe id.
  const clipId = `crest-face-${useId().replace(/[^a-zA-Z0-9]/gu, '')}`;

  if (badgeStyle ? badgeStyle === 'generated' : !isAimz) {
    const palette = opponentBadgeColors(name);
    return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-opponent">
      <Svg height={size} viewBox="0 0 100 100" width={size}>
        <Path d={SHIELD_PATH} fill={palette.fill} stroke={palette.edge} strokeLinejoin="round" strokeWidth={BORDER_WIDTH} testID="opponent-shield" />
        <Path d="M13 19 C25 23 37 23 50 18 C63 23 75 23 87 19" fill="none" opacity={0.55} stroke={CREST_WHITE} strokeLinecap="round" strokeWidth={2.4} />
      </Svg>
      <Text allowFontScaling={false} style={[styles.opponentMark, { fontSize: Math.round(size * 0.27), top: Math.round(size * 0.31) }]} testID="opponent-initials">{initialsFor(name)}</Text>
    </View>;
  }

  const detailed = size >= DETAIL_FROM;
  const striped = size >= STRIPES_FROM;
  return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-aimz">
    <Svg height={size} viewBox="0 0 100 100" width={size}>
      {striped ? <Defs><ClipPath id={clipId}><Path d={SHIELD_PATH} /></ClipPath></Defs> : null}
      <Path d={SHIELD_PATH} fill={CREST_NAVY} stroke={CREST_GOLD} strokeLinejoin="round" strokeWidth={BORDER_WIDTH} testID="aimz-shield" />
      {striped ? STRIPE_X.map((x) => (
        <Rect clipPath={`url(#${clipId})`} fill={CREST_WHITE} height={STRIPE_HEIGHT} key={x} testID="crest-stripe" width={STRIPE_WIDTH} x={x} y={STRIPE_Y} />
      )) : null}
      {detailed ? <Path
        clipPath={`url(#${clipId})`}
        d="M13 29 C13 23 16 20 22 20 C25 20 27 21 29 23 L29 20 L34 20 L34 32 L29 32 L29 29 C27 31 25 32 22 32 C16 32 13 30 13 29 Z M18 27 C18 29 20 29 22 29 C26 29 29 27 29 24 C27 23 25 23 23 23 C20 23 18 24 18 27 Z M37 20 L43 20 L43 32 L37 32 Z M37 15 L43 15 L43 19 L37 19 Z M47 20 L52 20 L52 22 C54 20 56 19 59 19 C62 19 64 20 65 23 C67 20 69 19 72 19 C76 19 78 22 78 27 L78 32 L73 32 L73 27 C73 24 72 23 70 23 C67 23 65 25 65 28 L65 32 L60 32 L60 27 C60 24 59 23 57 23 C54 23 52 25 52 28 L52 32 L47 32 Z M80 20 L91 20 L91 23 L84 29 L91 29 L91 32 L79 32 L79 29 L86 23 L80 23 Z"
        fill={CREST_WHITE}
        fillRule="evenodd"
        testID="crest-wordmark"
      /> : null}
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  opponentMark: { color: CREST_WHITE, fontWeight: '900', letterSpacing: 0.5, position: 'absolute', textAlign: 'center', width: '100%' },
});
