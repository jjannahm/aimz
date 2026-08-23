import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * The club's own gold, for the ring that keeps two AIMZ squads apart.
 *
 * Fixed rather than a theme role for the same reason `cardPalette` is: a crest
 * is the club's colours whatever the app's theme is doing.
 */
const CREST_EDGE = '#C9A227';

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

  return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-aimz">
    <Image
      resizeMode="cover"
      source={require('../../assets/branding/aimz-crest.jpg')}
      style={[
        { borderRadius: size / 2, height: size, width: size },
        // Two AIMZ squads meeting would wear the same crest, so one side takes
        // the club's gold ring to tell them apart.
        tone === 'light' ? { borderColor: CREST_EDGE, borderWidth: Math.max(1, Math.round(size * 0.06)) } : null,
      ]}
    />
  </View>;
}

const stylesheet = (unused: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
