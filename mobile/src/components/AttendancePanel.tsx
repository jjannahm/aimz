import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AttendanceStatus, TrainingSession } from '@/src/types/api';

/**
 * Present, late and absent, in the same green and red the availability answers
 * use with amber between them.
 *
 * A register and a set of replies are different questions about the same
 * session — what was said beforehand against what happened — so reading one
 * should not mean learning a second colour scheme. Late sits in the middle
 * because that is what it is: she came, but not at the start.
 */
const CHOICES: { label: string; tone: 'live' | 'warning' | 'error'; value: AttendanceStatus }[] = [
  { label: 'Present', tone: 'live', value: 'present' },
  { label: 'Late', tone: 'warning', value: 'late' },
  { label: 'Absent', tone: 'error', value: 'absent' },
];

/**
 * The register for one training session.
 *
 * The squad comes from the roster the session's team already has, so there is
 * no attendance roster to keep in step. A mark saves as it is made rather than
 * behind a Save button: a coach reads a register down a line of players, and a
 * screen that loses the lot because the last name was never confirmed is worse
 * than one that writes each name as it goes.
 */
export function AttendancePanel({ session }: { session: TrainingSession }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const client = useQueryClient();
  const register = useQuery({
    queryKey: [...cacheKeys.attendance, session.id],
    queryFn: () => api.trainingAttendance(session.id),
  });
  // Which row is being written, so only that row shows it rather than the page
  // greying out under a coach halfway down a squad.
  const [saving, setSaving] = React.useState<string | null>(null);
  const mark = useMutation({
    mutationFn: ({ playerId, status }: { playerId: string; status: AttendanceStatus | null }) =>
      api.setTrainingAttendance(session.id, [{ player_id: playerId, status }]),
    onMutate: ({ playerId }) => setSaving(playerId),
    onSettled: () => setSaving(null),
    onError: (error) => showMessage('Attendance not saved', (error as ApiError).message),
    // The percentage on every profile is worked out from these rows, so the
    // stats built on them are cleared alongside the register itself.
    onSuccess: async () => { await invalidateAfterWrite(client, 'attendance'); },
  });

  // Marking a full squad one name at a time is the common case at a session
  // everybody came to, so the exception is offered as a single write.
  const markRest = useMutation({
    mutationFn: (playerIds: string[]) => api.setTrainingAttendance(session.id, playerIds.map((player_id) => ({ player_id, status: 'present' as const }))),
    onError: (error) => showMessage('Attendance not saved', (error as ApiError).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'attendance'); },
  });

  if (register.isLoading) return <LoadingState label="Loading attendance" />;
  if (register.isError) return <ErrorState message={(register.error as ApiError).message} onRetry={() => register.refetch()} />;
  const items = register.data?.items ?? [];
  const present = register.data?.present ?? 0;
  const late = register.data?.late ?? 0;
  const absent = register.data?.absent ?? 0;
  const unmarked = register.data?.unmarked ?? 0;

  return <View style={styles.panel}>
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.heading}>Attendance</Text>
      {items.length > 0 && unmarked > 0 ? <AppButton
        compact
        disabled={markRest.isPending}
        label="Rest present"
        loading={markRest.isPending}
        onPress={() => markRest.mutate(items.filter((row) => row.status === null).map((row) => row.player.id))}
        variant="secondary"
      /> : null}
    </View>

    {/* The tally first, because it is what a coach standing on the pitch wants
      * and the list below is only how it is arrived at. */}
    <View accessibilityLabel={`Present ${present}, late ${late}, absent ${absent}${unmarked > 0 ? `, ${unmarked} not marked` : ''}`} style={styles.summary}>
      <View style={styles.tally}><Text style={[styles.count, { color: colors.live }]}>{present}</Text><Text style={styles.countLabel}>Present</Text></View>
      <View style={styles.tally}><Text style={[styles.count, { color: colors.warning }]}>{late}</Text><Text style={styles.countLabel}>Late</Text></View>
      <View style={styles.tally}><Text style={[styles.count, { color: colors.error }]}>{absent}</Text><Text style={styles.countLabel}>Absent</Text></View>
      {unmarked > 0 ? <View style={styles.tally}><Text style={[styles.count, { color: colors.textMuted }]}>{unmarked}</Text><Text style={styles.countLabel}>Not marked</Text></View> : null}
    </View>

    {!items.length ? <Text style={styles.empty}>This squad has no players on it yet.</Text> : <View style={styles.list}>
      {items.map((row) => <View key={row.player.id} style={styles.row}>
        <Text numberOfLines={1} style={styles.name}>{row.player.name}</Text>
        <View accessibilityRole="radiogroup" style={styles.choices}>{CHOICES.map((choice) => {
          const tone = colors[choice.tone];
          const chosen = row.status === choice.value;
          return <Pressable
            accessibilityLabel={`${row.player.name} ${choice.label.toLowerCase()}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: chosen, disabled: saving === row.player.id }}
            disabled={saving === row.player.id}
            key={choice.value}
            // Pressing the mark a player already has takes it off again, so a
            // name marked by mistake can be put back to unmarked.
            onPress={() => mark.mutate({ playerId: row.player.id, status: chosen ? null : choice.value })}
            style={({ pressed }) => [styles.choice, { borderColor: tone }, chosen && { backgroundColor: tone }, pressed && styles.pressed]}
          >
            <Text style={[styles.choiceText, { color: chosen ? colors.onStatus : tone }, chosen && styles.chosenText]}>{choice.label}</Text>
          </Pressable>;
        })}</View>
      </View>)}
    </View>}
    <Text style={styles.note}>A mark saves as you make it, and can be changed afterwards. Pressing the mark a player already has takes it off again.</Text>
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  panel: { gap: theme.spacing.sm },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },

  summary: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', padding: theme.spacing.md },
  tally: { alignItems: 'center', flex: 1, gap: 2 },
  count: { fontFamily: theme.font.monoBold, fontSize: theme.type.score, fontVariant: ['tabular-nums'] },
  countLabel: { color: colors.textMuted, fontSize: theme.type.caption },

  list: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, paddingHorizontal: theme.spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.size.listRow, paddingVertical: theme.spacing.xs },
  name: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.semibold },
  choices: { flexDirection: 'row', gap: theme.spacing.xs },
  // Wide enough that the touch height does not squeeze the word into an oval,
  // and a fixed width so the two columns line up down the whole register.
  choice: { alignItems: 'center', borderRadius: theme.radius.pill, borderWidth: 1, justifyContent: 'center', minHeight: theme.touch.minimum, width: 76 },
  choiceText: { fontSize: theme.type.caption, fontFamily: theme.font.semibold },
  chosenText: { fontFamily: theme.font.bold },
  pressed: { opacity: 0.6 },

  empty: { color: colors.textMuted },
  note: { color: colors.textMuted, fontSize: theme.type.label, lineHeight: 18 },
});
