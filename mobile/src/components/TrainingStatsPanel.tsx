import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { StatGrid, type Stat } from '@/src/components/StatGrid';
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
 * How far from the squad's average still counts as being at it.
 *
 * Landing exactly on the average is rare, so without a band almost everybody
 * reads as above or below it, and one missed session flips a player from one to
 * the other. Five points either way is wide enough to be steady.
 */
const SAME_AS_SQUAD = 5;

/** Where this player sits against her squad, in a word. */
function standing(pct: number | null, teamPct: number | null) {
  if (pct === null || teamPct === null) return null;
  const gap = pct - teamPct;
  if (Math.abs(gap) <= SAME_AS_SQUAD) return 'average' as const;
  return gap > 0 ? 'above' as const : 'below' as const;
}

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
  const sits = standing(attendance.pct, attendance.team_pct);
  const verdict = { above: 'Above average', average: 'Average', below: 'Below average' } as const;
  // Above in the same green a present mark carries. Below in amber rather than
  // the red beside it: this is a child's attendance read by her own family, and
  // red states a failure where the figure only shows a gap.
  const verdictTone = { above: colors.live, average: colors.textMuted, below: colors.warning } as const;

  // A metric nobody has recorded is left out rather than shown as a zero: a
  // nought here would read as a mark given, not as one never given.
  const tiles: Stat[] = [
    ...(attendance.expected > 0 ? [
      { key: 'attended', label: 'Attended', value: `${attendance.attended} of ${attendance.expected}` },
      { key: 'attendance', label: 'Attendance', value: `${attendance.pct}%`, tone: colors.accentSoft },
      // Her own percentage says nothing on its own — 80% in a squad averaging
      // 95 is not 80% in one averaging 60 — so the squad's figure sits beside
      // it with where she falls against it underneath. Inside this block on
      // purpose: a squad average with no personal figure next to it is a number
      // with nothing to compare.
      ...(attendance.team_pct === null ? [] : [{
        key: 'team-attendance',
        label: 'Team average',
        value: `${attendance.team_pct}%`,
        ...(sits ? { note: verdict[sits], noteTone: verdictTone[sits] } : {}),
      }]),
    ] : []),
    // Ratings only. A season's worth of minutes is a total rather than a mark
    // against a scale, and it is still on every session row below.
    ...totals.filter((total) => total.value !== null && total.metric.kind === 'rating').map((total) => ({
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
    <StatGrid stats={tiles} />

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
