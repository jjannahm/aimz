import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AttendancePanel } from '@/src/components/AttendancePanel';
import { AttendanceRequestPanel } from '@/src/components/AttendanceRequestPanel';
import { AvailabilityPanel } from '@/src/components/AvailabilityPanel';
import { CloseButton } from '@/src/components/CloseButton';
import { useAuth } from '@/src/auth/AuthProvider';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export default function TrainingDetailScreen() {
  const styles = useThemedStyles(stylesheet);
  const { id } = useLocalSearchParams<{ id: string }>();
  // Taking the register is the coach's job — an administrator's or the squad
  // coach's — and a family reads the replies below it, with a way to say the
  // register has them wrong.
  const { user } = useAuth();
  const marksRegister = user?.role === 'admin' || user?.role === 'coach';
  const query = useQuery({ queryKey: ['training', id], queryFn: () => api.trainingSession(id), enabled: Boolean(id) });
  return <Screen action={<CloseButton />} title="Training">
    {query.isLoading ? <LoadingState label="Loading training session" /> : query.isError || !query.data ? <ErrorState message={(query.error as ApiError)?.message ?? 'Training session not found.'} onRetry={() => query.refetch()} /> : <><View style={styles.hero}><Text style={styles.team}>{query.data.team.name}</Text><Text style={styles.time}>{formatEgyptDateTime(query.data.starts_at)}</Text><Text style={styles.meta}>{query.data.duration_minutes} minutes · {query.data.venue}</Text>{query.data.notes ? <Text style={styles.notes}>{query.data.notes}</Text> : null}</View>{/* The corrections come before the register for whoever answers them. They
        * used to sit under it, which on a squad of twenty is a screen and a half
        * below the fold — a coach had to scroll past every player to find out
        * anybody had asked, so in practice nobody ever did. A family still meets
        * the ask where it always was, under the roster it is about. */}
      {marksRegister
        ? <><AttendanceRequestPanel session={query.data} /><AttendancePanel session={query.data} /></>
        : <AttendanceRequestPanel session={query.data} />}<AvailabilityPanel session={query.data} /></>}
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ hero: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.sm, padding: theme.size.cardPadding }, meta: { color: colors.textSecondary, fontFamily: theme.font.regular }, notes: { color: colors.textMuted, fontFamily: theme.font.regular, lineHeight: 22 }, team: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading }, time: { color: colors.accentSoft, fontFamily: theme.font.monoBold, fontSize: theme.type.body } });
