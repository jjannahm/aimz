import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { StatGrid, type Stat } from '@/src/components/StatGrid';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { metricsForPlayer } from '@/src/lib/trainingMetrics';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AttendanceStatus, TrainingMetric } from '@/src/types/api';

/** What each answer on the register is called, and the colour it wears. */
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent' };
const statusTone = (status: AttendanceStatus, colors: ThemeColors) =>
  status === 'present' ? colors.live : status === 'late' ? colors.warning : colors.error;

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
  const { attendance, totals, sessions, metrics, player } = query.data;
  const playerMetrics = metricsForPlayer(metrics, player);
  const sits = standing(attendance.pct, attendance.team_pct);
  const verdict = { above: 'Above average', average: 'Average', below: 'Below average' } as const;
  // Above in the same green a present mark carries. Below in amber rather than
  // the red beside it: this is a child's attendance read by her own family, and
  // red states a failure where the figure only shows a gap.
  const verdictTone = { above: colors.live, average: colors.textMuted, below: colors.warning } as const;

  // A metric nobody has recorded is left out rather than shown as a zero: a
  // nought here would read as a mark given, not as one never given.
  const totalByMetric = new Map(totals.map((total) => [total.metric.id, total]));
  // Exactly six equal cells: attendance carries its percentage in the same
  // cell, then late, then the four ratings for this player's position. The
  // squad comparison stays attached to attendance instead of becoming a
  // seventh, uneven cell.
  const tiles: Stat[] = [
    {
      key: 'attendance',
      label: 'Attended · Attendance',
      value: `${attendance.attended} of ${attendance.expected}`,
      secondary: attendance.pct == null ? '—' : `${attendance.pct}%`,
      ...(attendance.team_pct == null ? {} : {
        note: `Team avg ${attendance.team_pct}%${sits ? ` · ${verdict[sits]}` : ''}`,
        ...(sits ? { noteTone: verdictTone[sits] } : {}),
      }),
    },
    { key: 'late', label: 'Late', value: String(attendance.late ?? 0), tone: (attendance.late ?? 0) > 0 ? colors.warning : undefined },
    ...playerMetrics.map((metric) => {
      const total = totalByMetric.get(metric.id);
      return {
        key: metric.id,
        label: shortLabel(metric),
        value: total?.value === null || total?.value === undefined ? '—' : readTotal(metric, total.value),
      };
    }),
  ];

  if (!tiles.length && !sessions.length) {
    return <Text style={styles.empty}>Nothing has been recorded for this player at training yet.</Text>;
  }

  return <>
    <StatGrid stats={tiles} />

    <Text accessibilityRole="header" style={styles.heading}>Session breakdown</Text>
    {!sessions.length ? <Text style={styles.empty}>No sessions recorded yet.</Text>
      : sessions.map((session) => {
        const marks = playerMetrics
          .filter((metric) => session.values[metric.id] !== undefined)
          .map((metric) => `${metric.key === 'overall_rating' ? 'Overall' : metric.label} ${readTotal(metric, session.values[metric.id]!)}`);
        return <FlatCard key={session.id} radius={theme.radius.md} style={styles.session}>
          <View style={styles.sessionHead}>
            <Text style={styles.sessionTitle}>{session.venue}</Text>
            {session.status ? <View style={[styles.chip, { borderColor: statusTone(session.status, colors) }]}>
              <Text style={[styles.chipText, { color: statusTone(session.status, colors) }]}>{STATUS_LABEL[session.status]}</Text>
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
