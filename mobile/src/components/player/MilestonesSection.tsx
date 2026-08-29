import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { formatEgyptDate } from '@/src/lib/egyptTime';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { MilestoneSummary } from '@/src/types/api';

/**
 * What a player has reached, what she is on a run of, and what is next.
 *
 * The next mark comes first deliberately: for a fourteen-year-old, two more
 * appearances to fifty is a reason to turn up on Saturday, and what she already
 * did is the reward for having done it.
 */
export function MilestonesSection({ milestones }: { milestones: MilestoneSummary }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { reached, streaks, next } = milestones;
  if (!reached.length && !streaks.length && !next.length) return null;

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>Milestones</Text>

    {next.map((item) => <FlatCard key={item.id} radius={theme.radius.md} style={styles.next} testID={`milestone-next-${item.id}`}>
      <View style={styles.nextCopy}>
        <Text style={styles.nextLabel}>{item.label}</Text>
        <Text style={styles.nextMeta}>{item.current} of {item.target}</Text>
      </View>
      <View accessibilityElementsHidden style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, Math.round((item.current / item.target) * 100))}%` }]} />
      </View>
    </FlatCard>)}

    {streaks.length ? <View style={styles.streaks}>{streaks.map((item) => <FlatCard key={item.id} radius={theme.radius.sm} style={styles.streak} testID={`milestone-streak-${item.id}`}>
      <Ionicons accessibilityElementsHidden color={colors.leaderAccent} name="flame" size={16} />
      <Text style={styles.streakText}>{item.label}</Text>
    </FlatCard>)}</View> : null}

    {reached.length ? <FlatCard radius={theme.radius.md} style={styles.list}>
      {reached.map((item, index) => <View key={item.id} style={[styles.row, index > 0 && styles.rowDivider]} testID={`milestone-${item.id}`}>
        <Ionicons accessibilityElementsHidden color={colors.accentSoft} name="ribbon" size={18} />
        <Text style={styles.rowLabel}>{item.label}</Text>
        <Text style={styles.rowDate}>{formatEgyptDate(item.kickoff_datetime)}</Text>
      </View>)}
    </FlatCard> : null}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  section: { gap: theme.spacing.sm },
  heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontFamily: theme.font.bold },
  next: { gap: theme.spacing.xs, padding: theme.spacing.md },
  nextCopy: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  nextLabel: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  nextMeta: { color: colors.textMuted, fontSize: theme.type.caption, fontVariant: ['tabular-nums'] },
  track: { backgroundColor: colors.surface, borderRadius: 999, height: 6, overflow: 'hidden' },
  fill: { backgroundColor: colors.accent, height: 6 },
  streaks: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  streak: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  streakText: { color: colors.textPrimary, fontSize: theme.type.label, fontFamily: theme.font.semibold },
  list: { paddingHorizontal: theme.spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum, paddingVertical: theme.spacing.xs },
  rowDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  rowLabel: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.semibold },
  rowDate: { color: colors.textMuted, fontSize: theme.type.caption },
});
