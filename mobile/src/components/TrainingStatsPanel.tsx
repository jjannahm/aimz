import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { useMyChildren } from '@/src/auth/useMyTeam';
import { AppButton } from '@/src/components/AppButton';
import { FlatCard } from '@/src/components/FlatCard';
import { FormField } from '@/src/components/FormField';
import { StatGrid, type Stat } from '@/src/components/StatGrid';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { showMessage, showToast } from '@/src/lib/platformAlert';
import { metricsForPlayer } from '@/src/lib/trainingMetrics';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AttendanceRequestStatus, AttendanceStatus, TrainingMetric } from '@/src/types/api';

/** What each answer on the register is called, and the colour it wears. */
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent' };
const statusTone = (status: AttendanceStatus, colors: ThemeColors) =>
  status === 'present' ? colors.live : status === 'late' ? colors.warning : colors.error;

/** What has become of an ask, and the colour it is worth saying in. */
const REQUEST_LABEL: Record<AttendanceRequestStatus, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
const requestTone = (status: AttendanceRequestStatus, colors: ThemeColors) =>
  status === 'approved' ? colors.live : status === 'rejected' ? colors.error : colors.warning;

/**
 * Whether this account speaks for the player whose record is open.
 *
 * Only a family may ask for their own register to be corrected — the API
 * refuses anybody else — so the button is only drawn for them. A coach or an
 * administrator reading the same page answers these on the session itself.
 */
function useSpeaksFor(playerId: string): boolean {
  const { user } = useAuth();
  const { children } = useMyChildren();
  if (!user) return false;
  if (user.role === 'player') return user.player_id === playerId;
  if (user.role === 'parent') return children.some((child) => child.id === playerId);
  return false;
}

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
  const speaksFor = useSpeaksFor(playerId);
  const [asking, setAsking] = React.useState<{ sessionId: string; venue: string } | null>(null);
  const query = useQuery({
    queryKey: [...cacheKeys.trainingStats, 'player', playerId],
    queryFn: () => api.playerTrainingStats(playerId),
    enabled: Boolean(playerId),
  });
  // What has already been asked about this player's register, so a session
  // carries the answer rather than the form a second time. Only a family may
  // ask, so only a family reads them here.
  const requests = useQuery({
    queryKey: [...cacheKeys.attendanceRequests, 'player', playerId],
    queryFn: () => api.attendanceRequests(`?player_id=${encodeURIComponent(playerId)}&limit=100`),
    enabled: Boolean(playerId) && speaksFor,
  });

  // `isPending` rather than `isLoading`: a query that has not resolved — held
  // back, or waiting on a first fetch — must not fall through to the figures
  // below, where a record still on its way would be drawn as a record of
  // nothing. An empty panel means the answer came back empty.
  if (query.isPending) return <LoadingState label="Loading training stats" />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as ApiError)?.message ?? 'Training stats not found.'} onRetry={() => query.refetch()} />;
  const { attendance, totals, sessions, metrics, player } = query.data;
  const playerMetrics = metricsForPlayer(metrics, player);

  // A metric nobody has recorded is left out rather than shown as a zero: a
  // nought here would read as a mark given, not as one never given.
  const totalByMetric = new Map(totals.map((total) => [total.metric.id, total]));
  const performanceKeys = ['dribbling', 'shooting', 'passing'];
  const tiles: Stat[] = [
    {
      key: 'attendance',
      label: 'Attended · Attendance',
      value: `${attendance.attended} of ${attendance.expected}`,
      secondary: attendance.pct == null ? '—' : `${attendance.pct}%`,
    },
    { key: 'late', label: 'Late', value: String(attendance.late ?? 0), tone: (attendance.late ?? 0) > 0 ? colors.warning : undefined },
    { key: 'team-average', label: 'Team Average', value: attendance.team_pct == null ? '—' : `${attendance.team_pct}%` },
    ...performanceKeys.map((key) => {
      const metric = playerMetrics.find((item) => item.key === key);
      if (!metric) return { key, label: `${key[0]!.toUpperCase()}${key.slice(1)} avg`, value: '—' };
      const total = totalByMetric.get(metric.id);
      return {
        key: metric.id,
        label: shortLabel(metric),
        value: total?.value === null || total?.value === undefined ? '—' : readTotal(metric, total.value),
      };
    }),
  ];

  return <>
    <StatGrid stats={tiles} />

    <Text accessibilityRole="header" style={styles.heading}>Session breakdown</Text>
    {!sessions.length ? <Text style={styles.empty}>No sessions recorded yet.</Text>
      : sessions.map((session) => {
        const marks = playerMetrics
          .filter((metric) => session.values[metric.id] !== undefined)
          .map((metric) => `${metric.key === 'overall_rating' ? 'Overall' : metric.label} ${readTotal(metric, session.values[metric.id]!)}`);
        // The latest ask about this session, whatever became of it. The API
        // answers newest first, so the first one found is the one that counts.
        const asked = (requests.data?.items ?? []).find((row) => row.training_session_id === session.id);
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
          {/* Marked absent, on a record this account speaks for: the one place
            * to say the register is wrong is the line that says it. An ask
            * already made stands where the button was, which is what the API
            * allows anyway — one open request per player per session. */}
          {speaksFor && session.status === 'absent' ? (asked
            ? <View style={styles.request} testID={`attendance-request-state-${session.id}`}>
              <Text style={[styles.requestState, { color: requestTone(asked.status, colors) }]}>
                {REQUEST_LABEL[asked.status]}{asked.status === 'pending' ? ' · waiting for a coach' : ''}
              </Text>
              {asked.status === 'rejected' && asked.decision_reason ? <Text style={styles.requestReason}>“{asked.decision_reason}”</Text> : null}
            </View>
            : <AppButton
              compact
              label="Request Present"
              onPress={() => setAsking({ sessionId: session.id, venue: session.venue })}
              style={styles.requestButton}
              variant="secondary"
            />) : null}
        </FlatCard>;
      })}

    {asking ? <RequestPresent
      onClose={() => setAsking(null)}
      playerId={playerId}
      sessionId={asking.sessionId}
      venue={asking.venue}
    /> : null}
  </>;
}

/**
 * Asking for an absence to be corrected.
 *
 * It says what the register says now and what is being asked for, because those
 * are the two halves of the ask and neither is the family's to write: this
 * records a request, and a coach or an administrator writes the register. The
 * reason is required — whoever answers it has only those words to go on.
 */
function RequestPresent({ playerId, sessionId, venue, onClose }: { playerId: string; sessionId: string; venue: string; onClose: () => void }) {
  const styles = useThemedStyles(stylesheet);
  const client = useQueryClient();
  const [reason, setReason] = React.useState('');
  const send = useMutation({
    mutationFn: () => api.requestAttendanceChange(sessionId, { player_id: playerId, requested_status: 'present', reason: reason.trim() }),
    onError: (error) => showMessage('Request not sent', (error as ApiError).message),
    onSuccess: async () => {
      await invalidateAfterWrite(client, 'attendance-request');
      showToast('Request sent');
      onClose();
    },
  });

  return <Modal animationType="fade" onRequestClose={onClose} transparent visible>
    <View style={styles.backdrop}>
      {/* The way out sits behind the card rather than around it, and answers to
        * nothing but a press: a dismiss layer wrapping the form is a button on
        * the web with a text field inside it, and the space bar in that field
        * presses the button. Hence a childless sheet, the way every other
        * picker in the app dismisses itself. */}
      <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} testID="request-present-backdrop" />
      <View style={styles.modal}>
        <Text accessibilityRole="header" style={styles.modalTitle}>Request Present</Text>
        <Text style={styles.modalMeta}>{venue}</Text>
        <View style={styles.change}>
          <Text style={styles.changeLine}>Current status: <Text style={styles.changeFrom}>Absent</Text></Text>
          <Text style={styles.changeLine}>Requested status: <Text style={styles.changeTo}>Present</Text></Text>
        </View>
        <FormField
          hint="Whoever answers this has only your words to go on"
          label="Reason"
          multiline
          onChangeText={setReason}
          placeholder="I attended but was marked absent."
          value={reason}
        />
        <Text style={styles.modalNote}>A coach or an administrator decides. The register does not change until they do.</Text>
        <AppButton disabled={!reason.trim() || send.isPending} label="Submit Request" loading={send.isPending} onPress={() => send.mutate()} />
        <AppButton label="Cancel" onPress={onClose} variant="ghost" />
      </View>
    </View>
  </Modal>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({

  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  session: { padding: theme.spacing.md },
  sessionHead: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  sessionTitle: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  sessionDate: { color: colors.textSecondary, fontFamily: theme.font.mono, fontSize: theme.type.caption, marginTop: 3 },
  sessionMeta: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 4 },

  requestButton: { alignSelf: 'flex-start', marginTop: theme.spacing.sm },
  request: { marginTop: theme.spacing.sm },
  requestState: { fontFamily: theme.font.bold, fontSize: theme.type.caption },
  requestReason: { color: colors.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.label, marginTop: 2 },

  backdrop: { alignItems: 'center', backgroundColor: 'rgba(8, 8, 12, 0.72)', flex: 1, justifyContent: 'center', padding: theme.spacing.lg },
  modal: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.sm, maxWidth: 440, padding: theme.size.cardPadding, width: '100%' },
  modalTitle: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  modalMeta: { color: colors.textMuted, fontFamily: theme.font.mono, fontSize: theme.type.caption },
  modalNote: { color: colors.textMuted, fontFamily: theme.font.regular, fontSize: theme.type.label, lineHeight: 20 },
  change: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 2, padding: theme.spacing.md },
  changeLine: { color: colors.textSecondary, fontFamily: theme.font.regular },
  changeFrom: { color: colors.error, fontFamily: theme.font.bold },
  changeTo: { color: colors.live, fontFamily: theme.font.bold },

  chip: { borderRadius: theme.radius.pill, borderWidth: 1, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 },
  chipText: { fontFamily: theme.font.bold, fontSize: theme.type.caption },
  empty: { color: colors.textMuted, fontFamily: theme.font.regular },
});
