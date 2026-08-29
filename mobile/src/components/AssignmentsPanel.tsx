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
  const isAdmin = user?.role === 'admin';
  const assignments = useQuery({ queryKey: ['assignments', kind, eventId], queryFn: () => kind === 'match' ? api.matchAssignments(eventId) : api.trainingAssignments(eventId), enabled: isAdmin });
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100'), enabled: isAdmin });
  const eligiblePlayers = players.data?.items.filter((player) => eligibleTeamIds.includes(player.team_id)) ?? [];
  const refresh = async () => { await invalidateAfterWrite(client, 'assignment'); };
  const create = useMutation({ mutationFn: () => kind === 'match' ? api.createMatchAssignment(eventId, title, playerId || null) : api.createTrainingAssignment(eventId, title, playerId || null), onError: (error) => showMessage('Assignment not added', (error as ApiError).message), onSuccess: async () => { setTitle(''); setPlayerId(''); await refresh(); } });
  const remove = useMutation({ mutationFn: (assignment: EventAssignment) => kind === 'match' ? api.deleteMatchAssignment(eventId, assignment.id) : api.deleteTrainingAssignment(eventId, assignment.id), onError: (error) => showMessage('Assignment not removed', (error as ApiError).message), onSuccess: refresh });
  // Volunteer tasks are an organiser's business: an admin sees the panel, and
  // nobody else is shown a heading over an empty list.
  if (!isAdmin) return null;
  if (assignments.isLoading) return <LoadingState label="Loading assignments" />;
  if (assignments.isError) return <ErrorState message={(assignments.error as ApiError).message} onRetry={() => assignments.refetch()} />;
  return <View style={styles.panel}>
    <Text style={styles.heading}>Assignments</Text>
    <View style={styles.form}><FormField label="Volunteer task" onChangeText={setTitle} value={title} /><ChoiceField label="Assign now (optional)" onChange={setPlayerId} options={[{ label: 'Leave open', value: '' }, ...eligiblePlayers.map((player) => ({ label: player.name, value: player.id }))]} placeholder="Leave open" value={playerId} /><AppButton disabled={!title.trim() || create.isPending} label="Add assignment" onPress={() => create.mutate()} variant="secondary" /></View>
    {assignments.data?.length ? assignments.data.map((assignment) => <View key={assignment.id} style={styles.row}><View style={styles.copy}><Text style={styles.title}>{assignment.title}</Text><Text style={styles.meta}>{assignment.assigned_player?.name ?? 'Volunteer needed'}</Text></View><AppButton compact disabled={remove.isPending} label="Remove" onPress={() => remove.mutate(assignment)} variant="danger" /></View>) : <Text style={styles.empty}>No volunteer tasks yet.</Text>}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ copy: { flex: 1 }, empty: { color: colors.textMuted, fontFamily: theme.font.regular }, form: { gap: theme.spacing.sm }, heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading }, meta: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 3 }, panel: { gap: theme.spacing.sm }, row: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.size.cardPadding }, title: { color: colors.textPrimary, fontFamily: theme.font.semibold } });
