import { StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Props = { date: Date; isToday: boolean; matchCount: number };

export function DateSectionHeader({ date, isToday, matchCount }: Props) {
  const styles = useThemedStyles(stylesheet);
  const label = isToday
    ? 'Today'
    : new Intl.DateTimeFormat('en-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return (
    <View accessibilityRole="header" style={styles.container}>
      <View style={styles.labelRow}>
        {!isToday ? <View style={styles.rule} /> : null}
        <View style={[styles.labelContainer, isToday && styles.todayPill]}>
          <Text style={[styles.label, isToday && styles.todayLabel]}>{label}</Text>
        </View>
        {!isToday ? <View style={styles.rule} /> : null}
      </View>
      <Text style={styles.count}>{matchCount} {matchCount === 1 ? 'Match' : 'Matches'}</Text>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  container: { alignItems: 'center', gap: 6 },
  labelRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, width: '100%' },
  rule: { backgroundColor: colors.border, flex: 1, height: StyleSheet.hairlineWidth },
  labelContainer: { paddingHorizontal: theme.spacing.sm, paddingVertical: 4 },
  todayPill: { backgroundColor: colors.highlightedSurface, borderColor: colors.accent, borderRadius: theme.radius.pill, borderWidth: 1, paddingHorizontal: theme.spacing.md, paddingVertical: 7 },
  label: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '800' },
  todayLabel: { color: colors.accentSoft },
  count: { color: colors.textMuted, fontSize: theme.type.caption },
});
