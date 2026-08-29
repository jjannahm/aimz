import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * What frosts the panel. Blurring what sits behind a view is a web platform
 * feature; on native it takes a module this app does not carry, so there the
 * card is a tint, a rim and a highlight and no blur. Same as the dock.
 */
const frosting = Platform.OS === 'web' ? ({ backdropFilter: 'blur(18px) saturate(140%)' } as ViewStyle) : null;

type Props = PropsWithChildren<{ style?: StyleProp<ViewStyle> }>;

/**
 * A card the page shows through, rather than one laid opaquely over it.
 *
 * Three things carry the glass: a tint thin enough to read the page behind,
 * a pale rim, and a hairline along the top edge standing in for light catching
 * the near side. Deliberately not applied app-wide — only where the look has
 * been asked for.
 */
export function GlassCard({ style, children }: Props) {
  const styles = useThemedStyles(stylesheet);
  return (
    <View style={[styles.card, frosting, style]}>
      {/* The lit edge. A plain hairline rather than a gradient, which would
        * cost a dependency for something this faint. */}
      <View pointerEvents="none" style={styles.highlight} />
      {children}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor: colors.glassSurface,
    borderColor: colors.glassBorder,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    padding: theme.spacing.sm,
  },
  highlight: { backgroundColor: colors.glassHighlight, height: 1, left: 0, position: 'absolute', right: 0, top: 0 },
});
