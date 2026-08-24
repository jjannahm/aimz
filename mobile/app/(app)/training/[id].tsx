import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AssignmentsPanel } from '@/src/components/AssignmentsPanel';
import { AvailabilityPanel } from '@/src/components/AvailabilityPanel';
import { CloseButton } from '@/src/components/CloseButton';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export default function TrainingDetailScreen() {
  const styles = useThemedStyles(stylesheet);
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({ queryKey: ['training', id], queryFn: () => api.trainingSession(id), enabled: Boolean(id) });
  return <Screen action={<CloseButton />} title="Training">
    {query.isLoading ? <LoadingState label="Loading training session" /> : query.isError || !query.data ? <ErrorState message={(query.error as ApiError)?.message ?? 'Training session not found.'} onRetry={() => query.refetch()} /> : <><View style={styles.hero}><Text style={styles.team}>{query.data.team.name}</Text><Text style={styles.time}>{formatEgyptDateTime(query.data.starts_at)}</Text><Text style={styles.meta}>{query.data.duration_minutes} minutes · {query.data.venue}</Text>{query.data.notes ? <Text style={styles.notes}>{query.data.notes}</Text> : null}</View><AvailabilityPanel session={query.data} /><AssignmentsPanel eligibleTeamIds={[query.data.team_id]} eventId={query.data.id} kind="training" /></>}
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ hero: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.lg }, meta: { color: colors.textSecondary }, notes: { color: colors.textMuted, lineHeight: 22 }, team: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, time: { color: colors.accentSoft, fontSize: theme.type.body, fontWeight: '800' } });
