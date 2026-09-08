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

/** How a total reads: a mark carries its scale, a count carries its unit. */
function readTotal(metric: TrainingMetric, value: number): string {
  if (metric.kind === 'rating') return `${value}/${metric.max_value ?? 10}`;
  return String(value);
}

/**
 * What a player did at training, as against what they did in matches.
 *
 * The same shape as the match panel — tallies, then a breakdown — because they
 * answer the same question about a different half of the week, and a reader
 * moving between the two tabs should not have to learn a second layout.
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
  const recorded = totals.filter((total) => total.value !== null);
  const tiles = [
    ...(attendance.expected > 0 ? [
      { label: 'Attended', value: `${attendance.attended} of ${attendance.expected}` },
      { label: 'Attendance', value: `${attendance.pct}%`, tone: colors.accentSoft },
    ] : []),
    ...recorded.map((total) => ({
      label: total.metric.kind === 'rating' ? `${total.metric.label} · average` : total.metric.label,
      value: readTotal(total.metric, total.value!),
      tone: undefined,
    })),
  ];

  if (!tiles.length && !sessions.length) {
    return <Text style={styles.empty}>Nothing has been recorded for this player at training yet.</Text>;
  }

  return <>
    <View style={styles.grid}>{tiles.map((tile) => <FlatCard key={tile.label} radius={theme.radius.md} style={styles.stat}>
      <Text style={[styles.value, tile.tone ? { color: tile.tone } : null]}>{tile.value}</Text>
      <Text style={styles.label}>{tile.label}</Text>
    </FlatCard>)}</View>

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
          {/* A session somebody attended but was not marked at is still worth
            * listing: it is why the attendance figure is what it is. */}
          <Text style={styles.sessionMeta}>{marks.length ? marks.join(' · ') : 'Nothing recorded'}</Text>
        </FlatCard>;
      })}
  </>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  // The tallies, three to a row, the way the match panel sets its own.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs },
  stat: { flexBasis: '31%', flexGrow: 1, padding: theme.spacing.sm },
  value: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.score, fontVariant: ['tabular-nums'] },
  label: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 2 },

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
