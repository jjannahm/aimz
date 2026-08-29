import { StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = { date: Date; isToday: boolean; matchCount: number };

export function DateSectionHeader({ date, isToday, matchCount }: Props) {
  const styles = useThemedStyles(stylesheet);
  const label = new Intl.DateTimeFormat('en-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return (
    <View accessibilityRole="header" style={styles.container}>
      {!isToday ? <View style={styles.labelRow}>
        <View style={styles.rule} />
        <View style={styles.labelContainer}>
          <Text style={styles.label}>{label}</Text>
        </View>
        <View style={styles.rule} />
      </View> : null}
      <Text style={styles.count}>{matchCount} {matchCount === 1 ? 'Match' : 'Matches'}</Text>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  container: { alignItems: 'center', gap: theme.spacing.xs },
  labelRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, width: '100%' },
  rule: { backgroundColor: colors.border, flex: 1, height: StyleSheet.hairlineWidth },
  labelContainer: { paddingHorizontal: theme.spacing.sm, paddingVertical: 4 },
  label: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.label, letterSpacing: 1, textTransform: 'uppercase' },
  count: { color: colors.textMuted, fontFamily: theme.font.mono, fontSize: theme.type.caption },
});
