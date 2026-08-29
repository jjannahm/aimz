import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { ChoiceField } from '@/src/components/ChoiceField';
import { FormField } from '@/src/components/FormField';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys, invalidateAfterWrite } from '@/src/lib/cache';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AvailabilityStatus, TrainingSession } from '@/src/types/api';

const options: { label: string; value: AvailabilityStatus }[] = [{ label: 'Going', value: 'going' }, { label: 'Maybe', value: 'maybe' }, { label: 'Not going', value: 'not_going' }];

export function AvailabilityPanel({ session }: { session: TrainingSession }) {
  const styles = useThemedStyles(stylesheet);
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
  const save = useMutation({ mutationFn: (status: AvailabilityStatus) => api.setTrainingAvailability(session.id, status, note || null, user?.role === 'admin' ? adminPlayer : undefined), onError: (error) => showMessage('Availability not saved', (error as ApiError).message), onSuccess: async () => { await invalidateAfterWrite(client, 'availability'); } });
  if (availability.isLoading) return <LoadingState label="Loading availability" />;
  if (availability.isError) return <ErrorState message={(availability.error as ApiError).message} onRetry={() => availability.refetch()} />;
  return <View style={styles.panel}>
    <Text style={styles.heading}>Availability</Text>
    {user?.role === 'admin' ? <ChoiceField label="Player" onChange={setAdminPlayer} options={(players.data?.items ?? []).map((player) => ({ label: player.name, value: player.id }))} placeholder="Choose a player" value={adminPlayer} /> : null}
    <FormField label="Note (optional)" onChangeText={setNote} value={note} />
    <View accessibilityRole="radiogroup" style={styles.segments}>{options.map((option) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: mine?.status === option.value, disabled: !target || save.isPending }} disabled={!target || save.isPending} key={option.value} onPress={() => save.mutate(option.value)} style={({ pressed }) => [styles.segment, mine?.status === option.value && styles.active, pressed && styles.pressed]}><Text style={[styles.segmentText, mine?.status === option.value && styles.activeText]}>{option.label}</Text></Pressable>)}</View>
    {options.map((option) => { const rows = availability.data?.filter((row) => row.status === option.value) ?? []; return <View key={option.value} style={styles.group}><Text style={styles.groupTitle}>{option.label} · {rows.length}</Text>{rows.length ? rows.map((row) => <Text key={row.id} style={styles.person}>{row.player.name}{row.note ? ` — ${row.note}` : ''}</Text>) : <Text style={styles.empty}>No responses</Text>}</View>; })}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ active: { backgroundColor: colors.accent, borderColor: colors.accent }, activeText: { color: colors.onAccent, fontWeight: '900' }, empty: { color: colors.textMuted }, group: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, padding: theme.spacing.md }, groupTitle: { color: colors.textPrimary, fontWeight: '900' }, heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, panel: { gap: theme.spacing.sm }, person: { color: colors.textSecondary }, pressed: { opacity: 0.7 }, segment: { alignItems: 'center', borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.xs }, segmentText: { color: colors.textSecondary, fontSize: theme.type.caption, fontWeight: '800', textAlign: 'center' }, segments: { flexDirection: 'row', gap: theme.spacing.xs } });
