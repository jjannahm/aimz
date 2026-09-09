import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

/** One figure in the summary. */
export interface Stat {
  key: string;
  label: string;
  value: string | number;
  /** A colour for the figure, where one carries meaning. */
  tone?: string;
}

/**
 * A summary of figures, as one panel divided by hairlines.
 *
 * A border only where two figures meet and none around them: separate outlines
 * at reading distance are things to look at before a number is read, and the
 * numbers are what somebody came for. Shared by the match and training halves
 * of a player's record so the two are one layout rather than two that drift.
 *
 * Three across, wrapping, so the rows line up column for column however many
 * figures there turn out to be.
 */
export function StatGrid({ stats }: { stats: Stat[] }) {
  const styles = useThemedStyles(stylesheet);
  if (!stats.length) return null;
  return <FlatCard radius={theme.radius.md} style={styles.card}>
    <View style={styles.row}>{stats.map((stat, index) => <View
      key={stat.key}
      style={[styles.cell, index % 3 !== 0 && styles.dividerLeft, index >= 3 && styles.dividerTop]}
    >
      {/* Held to one line whatever the figure is: a scale is the metric's to
        * change, and "10/10" should not break in half when it does. */}
      <Text numberOfLines={1} style={[styles.value, stat.tone ? { color: stat.tone } : null]}>{stat.value}</Text>
      <Text numberOfLines={2} style={styles.label}>{stat.label}</Text>
    </View>)}</View>
  </FlatCard>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  // The dividers are drawn inside, so the card keeps its own rounded edge.
  card: { overflow: 'hidden', padding: 0 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { alignItems: 'center', flexBasis: '33.33%', gap: 2, minWidth: 0, paddingHorizontal: theme.spacing.xs, paddingVertical: theme.spacing.md },
  dividerLeft: { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth },
  dividerTop: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  value: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.heading, fontVariant: ['tabular-nums'] },
  label: { color: colors.textMuted, fontSize: theme.type.caption, textAlign: 'center' },
});
