import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * The club crest's own colours: navy face, gold edge, white stripes and
 * wordmark.
 *
 * Fixed rather than theme roles, for the same reason `cardPalette` is: a club
 * crest is the club's colours whatever the app's theme is doing, and the light
 * theme would wash the navy out.
 */
const CREST_NAVY = '#1E2A5A';
const CREST_EDGE = '#C9A227';
const CREST_WHITE = '#FFFFFF';

/** How much of the gold shield behind shows through as a border ring. */
const BORDER_RATIO = 0.88;

/** Below this the stripes and wordmark are mud, so the crest goes plain. */
const DETAIL_FROM = 40;

type Props = {
  /** AIMZ squads wear the club crest; everyone else gets the neutral shield. */
  isAimz?: boolean;
  size?: number;
};

/**
 * A team's badge: the club crest for AIMZ squads, a plain shield with a ball
 * for everyone else.
 *
 * Always the same crest, home or away — there is nothing here that changes
 * with which side of the fixture it is drawn on.
 *
 * Drawn from Views and Ionicons rather than SVG, which this project does not
 * carry — the same approach as `CardIcon` and `JerseyIcon`. The gold edge is
 * faked the way `CardsIcon` fakes an overlap: a larger gold shield sits behind
 * a smaller navy one, and the ring between them reads as a border. Every
 * dimension is a fraction of `size` so it holds together from 34px in a table
 * row up to the 48px squad list.
 */
export function TeamBadge({ isAimz = false, size = 44 }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);

  if (!isAimz) {
    // The ball sits slightly high because the shield tapers to a point.
    return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-opponent">
      <Ionicons color={colors.textSecondary} name="shield-outline" size={size} />
      <Ionicons color={colors.textSecondary} name="football" size={Math.round(size * 0.38)} style={{ position: 'absolute', top: Math.round(size * 0.26) }} />
    </View>;
  }

  const inset = Math.round((size * (1 - BORDER_RATIO)) / 2);
  const detailed = size >= DETAIL_FROM;
  // Five bars nearly spanning the shield's face, the way a paly heraldic
  // pattern does — a few narrow bars centred with wide navy margins either
  // side read as a stripe of stripes rather than the shield's own pattern.
  const stripeWidth = Math.max(1.5, Math.round(size * 0.088));
  return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-aimz">
    <Ionicons color={CREST_EDGE} name="shield" size={size} />
    <Ionicons color={CREST_NAVY} name="shield" size={size - inset * 2} style={{ left: inset, position: 'absolute', top: inset }} />
    {detailed ? <>
      <View style={[styles.stripes, { gap: Math.max(1, Math.round(size * 0.035)), top: Math.round(size * 0.21) }]}>
        {Array.from({ length: 5 }, (_, index) => <View key={index} style={{ backgroundColor: CREST_WHITE, height: Math.round(size * 0.34), width: stripeWidth }} />)}
      </View>
      <Text allowFontScaling={false} style={[styles.mark, { fontSize: Math.round(size * 0.2), top: Math.round(size * 0.565) }]}>aimz</Text>
    </> : null}
  </View>;
}

const stylesheet = (_colors: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  stripes: { flexDirection: 'row', position: 'absolute' },
  mark: { color: CREST_WHITE, fontWeight: '900', letterSpacing: 0.2, position: 'absolute' },
});
