import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { FormField } from '@/src/components/FormField';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AvailabilityStatus, TrainingSession } from '@/src/types/api';

/**
 * Each answer carries its own colour: green for going, amber for maybe, red for
 * not going. The tone names a palette entry rather than a hex, so a pill and the
 * tally heading underneath it are the same colour by construction, in both
 * modes, and neither can drift from the other.
 */
const options: { label: string; tone: 'live' | 'warning' | 'error'; value: AvailabilityStatus }[] = [{ label: 'Going', tone: 'live', value: 'going' }, { label: 'Maybe', tone: 'warning', value: 'maybe' }, { label: 'Not going', tone: 'error', value: 'not_going' }];

export function AvailabilityPanel({ session }: { session: TrainingSession }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const { user } = useAuth();
  const client = useQueryClient();
  const availability = useQuery({ queryKey: ['training-availability', session.id], queryFn: () => api.trainingAvailability(session.id) });
  const players = useQuery({ // One squad's players, so not the shared ['players'] list: same key,
    // different rows would have each overwrite the other's cache.
    queryKey: [...cacheKeys.players, 'team', session.team_id], queryFn: () => api.players(`?team_id=${encodeURIComponent(session.team_id)}&limit=100`), enabled: user?.role === 'admin' });
  const [adminPlayer, setAdminPlayer] = React.useState('');
  const [note, setNote] = React.useState('');
  const target = user?.role === 'admin' ? adminPlayer : user?.player_id ?? '';
  const mine = availability.data?.find((row) => row.player_id === target);
  // The note is written back on every save, so it has to be loaded first —
  // leaving it empty would put a null over a note already on the record. Keyed
  // on the row and the chosen player rather than on the note itself, so a
  // background refetch cannot wipe out what is half-typed, and an admin moving
  // between players gets that player's note instead of the last one they saw.
  React.useEffect(() => { setNote(mine?.note ?? ''); }, [mine?.id, target]);
  const noteChanged = (mine?.note ?? '') !== note;
  const save = useMutation({ mutationFn: (status: AvailabilityStatus) => api.setTrainingAvailability(session.id, status, note || null, user?.role === 'admin' ? adminPlayer : undefined), onError: (error) => showMessage('Availability not saved', (error as ApiError).message), onSuccess: async () => { await invalidateAfterWrite(client, 'availability'); } });
  if (availability.isLoading) return <LoadingState label="Loading availability" />;
  if (availability.isError) return <ErrorState message={(availability.error as ApiError).message} onRetry={() => availability.refetch()} />;
  return <View style={styles.panel}>
    <Text style={styles.heading}>Availability</Text>
    {user?.role === 'admin' ? <ChoiceField label="Player" onChange={setAdminPlayer} options={(players.data?.items ?? []).map((player) => ({ label: player.name, value: player.id }))} placeholder="Choose a player" value={adminPlayer} /> : null}
    <FormField hint={mine ? undefined : 'Saved with your answer.'} label="Note (optional)" maxLength={500} onChangeText={setNote} value={note} />
    {mine ? <AppButton compact disabled={!noteChanged || save.isPending} label="Save note" loading={save.isPending} onPress={() => save.mutate(mine.status)} variant="secondary" /> : null}
    <View accessibilityRole="radiogroup" style={styles.segments}>{options.map((option) => { const tone = colors[option.tone]; const chosen = mine?.status === option.value; return <Pressable accessibilityRole="radio" accessibilityState={{ checked: chosen, disabled: !target || save.isPending }} disabled={!target || save.isPending} key={option.value} onPress={() => save.mutate(option.value)} style={({ pressed }) => [styles.segment, { borderColor: tone }, chosen && { backgroundColor: tone }, pressed && styles.pressed]}><Text style={[styles.segmentText, { color: chosen ? colors.onStatus : tone }, chosen && styles.chosenText]}>{option.label}</Text></Pressable>; })}</View>
    {options.map((option) => { const rows = availability.data?.filter((row) => row.status === option.value) ?? []; return <View key={option.value} style={styles.group}><Text style={[styles.groupTitle, { color: colors[option.tone] }]}>{option.label} · {rows.length}</Text>{rows.length ? rows.map((row) => <Text key={row.id} style={styles.person}>{row.player.name}{row.note ? ` — ${row.note}` : ''}</Text>) : <Text style={styles.empty}>No responses</Text>}</View>; })}
  </View>;
}

// The pill borders, the pill labels and the group titles are all coloured from
// the option's own tone, so they are set where the option is in hand rather
// than here. An unanswered pill is filled in `surface` rather than left clear:
// light mode's background is a saturated blue that a dark green or red label
// cannot hold contrast against, and the fill also matches the tally cards.
const stylesheet = (colors: ThemeColors) => StyleSheet.create({ chosenText: { fontWeight: '900' }, empty: { color: colors.textMuted }, group: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.md }, groupTitle: { fontWeight: '900' }, heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, panel: { gap: theme.spacing.sm }, person: { color: colors.textSecondary }, pressed: { opacity: 0.7 }, segment: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: theme.radius.pill, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.xs }, segmentText: { fontSize: theme.type.caption, fontWeight: '800', textAlign: 'center' }, segments: { flexDirection: 'row', gap: theme.spacing.xs } });
