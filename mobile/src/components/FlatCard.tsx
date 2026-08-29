import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = PropsWithChildren<{
  radius?: number;
  raised?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Passed through so a test can find the card itself, not just its contents. */
  testID?: string;
}>;

/** A compact, opaque editorial surface shared across the app. */
export function FlatCard({ children, radius = theme.radius.md, raised = false, style, testID }: Props) {
  const styles = useThemedStyles(stylesheet);
  return <View style={[styles.base, raised && styles.raised, { borderRadius: radius }, style]} testID={testID}>{children}</View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  raised: { backgroundColor: colors.surfaceRaised },
});
