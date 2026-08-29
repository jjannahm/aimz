import { StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { FormResult } from '@/src/types/api';

/**
 * A run of recent results, newest last.
 *
 * The one place W, D and L are given their colours, so the table, a team's
 * profile and a comparison all read the same run the same way. `small` is the
 * size the standings row has always used and is unchanged.
 */
export function FormStrip({ form, size = 'small' }: { form: FormResult[]; size?: 'small' | 'large' }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  if (!form.length) return null;
  const tint: Record<FormResult, string> = { W: colors.live, D: colors.textMuted, L: colors.error };
  const spoken = form.map((result) => ({ W: 'won', D: 'drew', L: 'lost' })[result]).join(', ');
  return <View accessibilityLabel={`Recent form: ${spoken}`} style={styles.form}>
    {form.map((result, index) => <View key={index} style={[styles.dot, size === 'large' && styles.dotLarge, { backgroundColor: tint[result] }]}>
      <Text accessibilityElementsHidden style={[styles.letter, size === 'large' && styles.letterLarge]}>{result}</Text>
    </View>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  form: { flexDirection: 'row', gap: 3 },
  dot: { alignItems: 'center', borderRadius: 3, height: 14, justifyContent: 'center', width: 14 },
  dotLarge: { borderRadius: 6, height: 26, width: 26 },
  letter: { color: colors.background, fontFamily: theme.font.bold, fontSize: 9 },
  letterLarge: { fontSize: 13 },
});
