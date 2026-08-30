import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = {
  /** Named for a screen reader where the trophy is the only thing saying it. */
  accessibilityLabel?: string;
  /** A trophy still being played for, drawn cold: nothing is won yet. */
  dimmed?: boolean;
  /** The hollow glyph, which the activity log's row chips are drawn in. */
  outline?: boolean;
  size?: number;
};

/**
 * The trophy, in gold and lit.
 *
 * Everything a trophy marks — first place, man of the match, an award, an
 * honour — is the same thing said in four places, so it is drawn from one
 * component and changes in one place.
 *
 * The halo is a second copy of the glyph sitting under the first. A single text
 * shadow is thin at 16-20px and reads as a soft outline rather than as light;
 * stacking a wide, warm copy beneath a tight, bright one is what makes the gold
 * look lit from within. The two are absolutely positioned in a box the size of
 * the glyph so they land exactly on top of each other, and so the whole thing
 * still occupies one icon's worth of space in a row.
 */
export function TrophyIcon({ accessibilityLabel, dimmed = false, outline = false, size = 20 }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const name = outline ? 'trophy-outline' : 'trophy';
  // Nothing to light up, and a glow on a muted glyph would say the opposite of
  // what the muting is for.
  if (dimmed) {
    return <Ionicons
      accessibilityElementsHidden={!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      color={colors.textMuted}
      name={name}
      size={size}
      testID="trophy-glyph"
    />;
  }
  // The label used to sit on the glyph itself, which VoiceOver reads because a
  // Text is an element in its own right. A View is not one until it is told to
  // be, so "First place" would have gone silent on the way into this wrapper.
  return <View
    accessibilityElementsHidden={!accessibilityLabel}
    accessibilityLabel={accessibilityLabel}
    accessibilityRole={accessibilityLabel ? 'image' : undefined}
    accessible={Boolean(accessibilityLabel)}
    importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    style={[styles.box, { height: size, width: size }]}
    testID="trophy-icon"
  >
    <Ionicons
      accessibilityElementsHidden
      color={colors.trophyGlow}
      name={name}
      size={size}
      style={[styles.layer, styles.halo, { textShadowRadius: size }]}
      testID="trophy-halo"
    />
    <Ionicons
      accessibilityElementsHidden
      color={colors.trophy}
      name={name}
      size={size}
      style={[styles.layer, styles.glyph, { textShadowRadius: size * 0.6 }]}
      testID="trophy-glyph"
    />
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
  layer: { position: 'absolute' },
  halo: { opacity: 0.85, textShadowColor: colors.trophyGlow, textShadowOffset: { height: 0, width: 0 } },
  glyph: { textShadowColor: colors.trophy, textShadowOffset: { height: 0, width: 0 } },
});
