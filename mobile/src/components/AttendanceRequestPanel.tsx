import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { FormField } from '@/src/components/FormField';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AttendanceRequest, AttendanceStatus, TrainingSession } from '@/src/types/api';

/** The three answers, worded and coloured the way the register words them. */
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent' };
const CHOICES = (['present', 'late', 'absent'] as const).map((value) => ({ label: STATUS_LABEL[value], value }));

const said = (status: AttendanceStatus | null) => (status ? STATUS_LABEL[status].toLowerCase() : 'not marked');

/**
 * Asking for a register to be corrected, and answering the ask.
 *
 * Two halves of one thing, on the session they are about. A family sees the
 * mark against them and can say it is wrong; an administrator or the squad's
 * manager sees what has been asked and answers it. Neither is a screen of its
 * own, because the context — which session, which squad, what the register
 * currently says — is all already here.
 *
 * Approving is what writes the register. A request never touches it.
 */
export function AttendanceRequestPanel({ session }: { session: TrainingSession }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const client = useQueryClient();
  const { user } = useAuth();
  const decides = user?.role === 'admin' || user?.role === 'manager';

  const requests = useQuery({
    queryKey: [...cacheKeys.attendanceRequests, session.id],
    queryFn: () => api.attendanceRequests(`?training_session_id=${encodeURIComponent(session.id)}&limit=100`),
    enabled: Boolean(session.id),
  });
  const items = requests.data?.items ?? [];

  if (decides) return <Decisions items={items} />;
  return <Ask items={items} session={session} />;

  /** The queue, for whoever may answer it. Absent entirely when it is empty. */
  function Decisions({ items: rows }: { items: AttendanceRequest[] }) {
    const pending = rows.filter((row) => row.status === 'pending');
    const decide = useMutation({
      mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
        approve ? api.approveAttendanceRequest(id) : api.rejectAttendanceRequest(id, null),
      onError: (error) => showMessage('Request not answered', (error as ApiError).message),
      onSuccess: async () => { await invalidateAfterWrite(client, 'attendance-request'); },
    });
    if (!pending.length) return null;
    return <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>Attendance corrections</Text>
      {pending.map((row) => <View key={row.id} style={styles.card}>
        <Text style={styles.name}>{row.player?.name ?? 'A player'}</Text>
        <Text style={styles.change}>
          <Text style={{ color: colors.textMuted }}>{said(row.current_status)}</Text>
          <Text style={{ color: colors.textMuted }}> → </Text>
          <Text style={{ color: colors.textPrimary }}>{said(row.requested_status)}</Text>
        </Text>
        {row.reason ? <Text style={styles.reason}>“{row.reason}”</Text> : null}
        <View style={styles.actions}>
          <AppButton
            compact
            disabled={decide.isPending}
            label="Approve"
            onPress={() => decide.mutate({ approve: true, id: row.id })}
          />
          <AppButton
            compact
            disabled={decide.isPending}
            label="Reject"
            onPress={() => decide.mutate({ approve: false, id: row.id })}
            variant="danger"
          />
        </View>
      </View>)}
      <Text style={styles.note}>Approving writes the register, and every attendance figure follows from it.</Text>
    </View>;
  }

  /** The ask, for the family whose record it is. */
  function Ask({ items: rows, session: current }: { items: AttendanceRequest[]; session: TrainingSession }) {
    const [status, setStatus] = React.useState<AttendanceStatus>('present');
    const [reason, setReason] = React.useState('');
    // What they have already asked, so a raised request becomes its own answer
    // rather than a form they might fill in twice.
    const open = rows.find((row) => row.status === 'pending');
    const decided = rows.filter((row) => row.status !== 'pending');

    const ask = useMutation({
      mutationFn: () => api.requestAttendanceChange(current.id, { reason: reason.trim() || null, requested_status: status }),
      onError: (error) => showMessage('Request not sent', (error as ApiError).message),
      onSuccess: async () => { setReason(''); await invalidateAfterWrite(client, 'attendance-request'); },
    });

    return <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>Attendance</Text>

      {open ? <View style={styles.card}>
        <Text style={styles.change}>
          <Text style={{ color: colors.textMuted }}>{said(open.current_status)}</Text>
          <Text style={{ color: colors.textMuted }}> → </Text>
          <Text style={{ color: colors.textPrimary }}>{said(open.requested_status)}</Text>
        </Text>
        <Text style={[styles.state, { color: colors.warning }]}>Waiting for a coach to answer</Text>
      </View> : <>
        <Text style={styles.note}>If the register is wrong for this session, ask a coach to correct it. They decide; nothing changes until they do.</Text>
        <SegmentedControl label="What it should say" onChange={setStatus} options={CHOICES} value={status} />
        <FormField
          hint="Optional, but it helps whoever answers"
          label="Why"
          multiline
          onChangeText={setReason}
          placeholder="I was there, twenty minutes in"
          value={reason}
        />
        <AppButton disabled={ask.isPending} label="Ask for a correction" loading={ask.isPending} onPress={() => ask.mutate()} />
      </>}

      {decided.map((row) => <View key={row.id} style={styles.card}>
        <Text style={styles.change}>
          <Text style={{ color: colors.textMuted }}>{said(row.current_status)}</Text>
          <Text style={{ color: colors.textMuted }}> → </Text>
          <Text style={{ color: colors.textPrimary }}>{said(row.requested_status)}</Text>
        </Text>
        <Text style={[styles.state, { color: row.status === 'approved' ? colors.live : colors.error }]}>
          {row.status === 'approved' ? 'Approved' : 'Not approved'}
          {row.decided_at ? ` · ${formatEgyptDateTime(row.decided_at)}` : ''}
        </Text>
        {row.decision_reason ? <Text style={styles.reason}>“{row.decision_reason}”</Text> : null}
      </View>)}
    </View>;
  }
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  panel: { gap: theme.spacing.sm },
  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: 4, padding: theme.size.cardPadding },
  name: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  change: { fontFamily: theme.font.monoBold, fontSize: theme.type.body },
  state: { fontFamily: theme.font.semibold, fontSize: theme.type.caption },
  reason: { color: colors.textMuted, fontFamily: theme.font.regular, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  note: { color: colors.textMuted, fontFamily: theme.font.regular, lineHeight: 21 },
});
