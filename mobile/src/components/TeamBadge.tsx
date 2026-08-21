import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * The club navy and the stripe blues, taken from the AIMZ artwork.
 *
 * These are fixed rather than theme roles for the same reason `cardPalette` is:
 * a club crest is the club's colours whatever the app's theme is doing, and the
 * light theme would wash the navy out.
 */
const CREST_NAVY = '#1E2A5A';
const CREST_EDGE = '#C9A227';
const STRIPES = ['#2F6FB5', '#4E92CF', '#7FB6E3'];

/** Below this the stripes and wordmark are mud, so the crest goes plain. */
const DETAIL_FROM = 40;

type Props = {
  /** AIMZ squads wear the club crest; everyone else gets the neutral shield. */
  isAimz?: boolean;
  size?: number;
  /** Tints the AIMZ crest so home and away stay apart in an all-AIMZ fixture. */
  tone?: 'accent' | 'light';
};

/**
 * A team's badge: the club crest for AIMZ squads, a plain shield with a ball
 * for everyone else.
 *
 * Drawn from Views and an Ionicon rather than SVG, which this project does not
 * carry — the same approach as `CardIcon` and `JerseyIcon`. Every dimension is
 * a fraction of `size` so it holds together from 34px in a table row up to the
 * 48px squad list.
 */
export function TeamBadge({ isAimz = false, size = 44, tone }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);

  if (!isAimz) {
    // The ball sits slightly high because the shield tapers to a point.
    return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-opponent">
      <Ionicons color={colors.textSecondary} name="shield-outline" size={size} />
      <Ionicons color={colors.textSecondary} name="football" size={Math.round(size * 0.38)} style={{ position: 'absolute', top: Math.round(size * 0.26) }} />
    </View>;
  }

  const detailed = size >= DETAIL_FROM;
  const stripeWidth = Math.max(2, Math.round(size * 0.075));
  return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-aimz">
    <Ionicons color={tone === 'light' ? CREST_EDGE : CREST_NAVY} name="shield" size={size} />
    {detailed ? <>
      <View style={[styles.stripes, { gap: Math.max(1, Math.round(size * 0.03)), top: Math.round(size * 0.2) }]}>
        {STRIPES.map((stripe) => <View key={stripe} style={{ backgroundColor: stripe, borderRadius: stripeWidth / 2, height: Math.round(size * 0.3), width: stripeWidth }} />)}
      </View>
      <Text allowFontScaling={false} style={[styles.mark, { fontSize: Math.round(size * 0.19), top: Math.round(size * 0.53) }]}>aimz</Text>
    </> : null}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  stripes: { flexDirection: 'row', position: 'absolute' },
  mark: { color: colors.onAccent, fontWeight: '900', letterSpacing: 0.2, position: 'absolute' },
});
