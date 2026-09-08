import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { TrainingMetric } from '@/src/types/api';

/** How a total reads: a mark carries its scale, a count stands alone. */
const readTotal = (metric: TrainingMetric, value: number) =>
  metric.kind === 'rating' ? `${value}/${metric.max_value ?? 10}` : String(value);

/** Short enough to sit on one line under its own figure. */
const shortLabel = (metric: TrainingMetric) => metric.kind === 'rating' ? `${metric.label} avg` : metric.label;

/**
 * What a player did at training, as against what they did in matches.
 *
 * The tallies are one panel divided by hairlines rather than six cards with
 * their own borders: six outlines at reading distance are six things to look
 * at before any number is read, and the figures are what somebody came for.
 * Three across, so the whole record is taken in without scrolling.
 */
export function TrainingStatsPanel({ playerId }: { playerId: string }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const query = useQuery({
    queryKey: [...cacheKeys.trainingStats, 'player', playerId],
    queryFn: () => api.playerTrainingStats(playerId),
    enabled: Boolean(playerId),
  });

  if (query.isLoading) return <LoadingState label="Loading training stats" />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as ApiError)?.message ?? 'Training stats not found.'} onRetry={() => query.refetch()} />;
  const { attendance, totals, sessions, metrics } = query.data;
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));

  // A metric nobody has recorded is left out rather than shown as a zero: a
  // nought here would read as a mark given, not as one never given.
  const tiles = [
    ...(attendance.expected > 0 ? [
      { key: 'attended', label: 'Attended', value: `${attendance.attended} of ${attendance.expected}` },
      { key: 'attendance', label: 'Attendance', value: `${attendance.pct}%`, tone: colors.accentSoft },
    ] : []),
    ...totals.filter((total) => total.value !== null).map((total) => ({
      key: total.metric.id,
      label: shortLabel(total.metric),
      value: readTotal(total.metric, total.value!),
      tone: undefined,
    })),
  ];

  if (!tiles.length && !sessions.length) {
    return <Text style={styles.empty}>Nothing has been recorded for this player at training yet.</Text>;
  }

  return <>
    {tiles.length ? <FlatCard radius={theme.radius.md} style={styles.summary}>
      <View style={styles.grid}>{tiles.map((tile, index) => <View
        key={tile.key}
        // Hairlines between the cells rather than around them: a border only
        // where two figures meet, and none at the edges of the panel.
        style={[styles.cell, index % 3 !== 0 && styles.dividerLeft, index >= 3 && styles.dividerTop]}
      >
        <Text numberOfLines={1} style={[styles.value, tile.tone ? { color: tile.tone } : null]}>{tile.value}</Text>
        <Text numberOfLines={1} style={styles.label}>{tile.label}</Text>
      </View>)}</View>
    </FlatCard> : null}

    <Text accessibilityRole="header" style={styles.heading}>Session breakdown</Text>
    {!sessions.length ? <Text style={styles.empty}>No sessions recorded yet.</Text>
      : sessions.map((session) => {
        const marks = Object.entries(session.values)
          .map(([metricId, value]) => { const metric = byId.get(metricId); return metric ? `${metric.label} ${readTotal(metric, value)}` : null; })
          .filter((line): line is string => line !== null);
        return <FlatCard key={session.id} radius={theme.radius.md} style={styles.session}>
          <View style={styles.sessionHead}>
            <Text style={styles.sessionTitle}>{session.venue}</Text>
            {session.status ? <View style={[styles.chip, { borderColor: session.status === 'present' ? colors.live : colors.error }]}>
              <Text style={[styles.chipText, { color: session.status === 'present' ? colors.live : colors.error }]}>{session.status === 'present' ? 'Present' : 'Absent'}</Text>
            </View> : null}
          </View>
          <Text style={styles.sessionDate}>{formatEgyptDateTime(session.starts_at)}</Text>
          {/* A session somebody was marked absent at is still worth listing: it
            * is why the attendance figure is what it is. */}
          <Text style={styles.sessionMeta}>{marks.length ? marks.join(' · ') : 'Nothing recorded'}</Text>
        </FlatCard>;
      })}
  </>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  summary: { overflow: 'hidden', padding: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // Exactly a third, so the two rows line up column for column.
  cell: { alignItems: 'center', flexBasis: '33.33%', gap: 2, minWidth: 0, paddingHorizontal: theme.spacing.xs, paddingVertical: theme.spacing.md },
  dividerLeft: { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth },
  dividerTop: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  // Dominant, but not so large that "10/10" cannot sit on one line in a third
  // of a phone. `numberOfLines` holds it there whatever the figure turns out
  // to be; the scale is the metric's to change.
  value: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.heading, fontVariant: ['tabular-nums'] },
  label: { color: colors.textMuted, fontSize: theme.type.caption, textAlign: 'center' },

  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  session: { padding: theme.spacing.md },
  sessionHead: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  sessionTitle: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  sessionDate: { color: colors.textSecondary, fontFamily: theme.font.mono, fontSize: theme.type.caption, marginTop: 3 },
  sessionMeta: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 4 },

  chip: { borderRadius: theme.radius.pill, borderWidth: 1, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  chipText: { fontFamily: theme.font.bold, fontSize: theme.type.caption },
  empty: { color: colors.textMuted, fontFamily: theme.font.regular },
});
