import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { FormField } from '@/src/components/FormField';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { EventAssignment } from '@/src/types/api';

export function AssignmentsPanel({ eventId, kind, eligibleTeamIds }: { eventId: string; kind: 'match' | 'training'; eligibleTeamIds: string[] }) {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const client = useQueryClient();
  const [title, setTitle] = React.useState('');
  const [playerId, setPlayerId] = React.useState('');
  const assignments = useQuery({ queryKey: ['assignments', kind, eventId], queryFn: () => kind === 'match' ? api.matchAssignments(eventId) : api.trainingAssignments(eventId) });
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100'), enabled: user?.role === 'admin' });
  const eligiblePlayers = players.data?.items.filter((player) => eligibleTeamIds.includes(player.team_id)) ?? [];
  const refresh = async () => { await invalidateAfterWrite(client, 'assignment'); };
  const create = useMutation({ mutationFn: () => kind === 'match' ? api.createMatchAssignment(eventId, title, playerId || null) : api.createTrainingAssignment(eventId, title, playerId || null), onError: (error) => showMessage('Assignment not added', (error as ApiError).message), onSuccess: async () => { setTitle(''); setPlayerId(''); await refresh(); } });
  const update = useMutation({ mutationFn: ({ assignment, next }: { assignment: EventAssignment; next: string | null }) => api.updateAssignment(assignment.id, next), onError: (error) => showMessage('Assignment not updated', (error as ApiError).message), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (assignment: EventAssignment) => kind === 'match' ? api.deleteMatchAssignment(eventId, assignment.id) : api.deleteTrainingAssignment(eventId, assignment.id), onError: (error) => showMessage('Assignment not removed', (error as ApiError).message), onSuccess: refresh });
  if (assignments.isLoading) return <LoadingState label="Loading assignments" />;
  if (assignments.isError) return <ErrorState message={(assignments.error as ApiError).message} onRetry={() => assignments.refetch()} />;
  return <View style={styles.panel}>
    <Text style={styles.heading}>Assignments</Text>
    {user?.role === 'admin' ? <View style={styles.form}><FormField label="Volunteer task" onChangeText={setTitle} value={title} /><ChoiceField label="Assign now (optional)" onChange={setPlayerId} options={[{ label: 'Leave open', value: '' }, ...eligiblePlayers.map((player) => ({ label: player.name, value: player.id }))]} placeholder="Leave open" value={playerId} /><AppButton disabled={!title.trim() || create.isPending} label="Add assignment" onPress={() => create.mutate()} variant="secondary" /></View> : null}
    {assignments.data?.length ? assignments.data.map((assignment) => {
      const mine = assignment.assigned_player_id === user?.player_id;
      return <View key={assignment.id} style={styles.row}><View style={styles.copy}><Text style={styles.title}>{assignment.title}</Text><Text style={styles.meta}>{assignment.assigned_player?.name ?? 'Volunteer needed'}</Text></View>{user?.role === 'admin' ? <AppButton compact disabled={remove.isPending} label="Remove" onPress={() => remove.mutate(assignment)} variant="danger" /> : assignment.assigned_player_id ? mine ? <AppButton compact disabled={update.isPending} label="Release" onPress={() => update.mutate({ assignment, next: null })} variant="secondary" /> : null : <AppButton compact disabled={update.isPending} label="Sign up" onPress={() => update.mutate({ assignment, next: user?.player_id ?? null })} />}</View>;
    }) : <Text style={styles.empty}>No volunteer tasks yet.</Text>}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ copy: { flex: 1 }, empty: { color: colors.textMuted }, form: { gap: theme.spacing.sm }, heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, meta: { color: colors.textMuted, marginTop: 3 }, panel: { gap: theme.spacing.sm }, row: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md }, title: { color: colors.textPrimary, fontWeight: '800' } });
