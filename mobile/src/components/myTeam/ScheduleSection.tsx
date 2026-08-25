import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useMyTeam } from '@/src/auth/useMyTeam';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { groupSessionsByDate } from '@/src/lib/trainingSchedule';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export function ScheduleSection() {
  const styles = useThemedStyles(stylesheet);
  const mine = useMyTeam();
  const query = useQuery({ queryKey: ['training', mine.teamId, 'upcoming'], queryFn: () => api.trainingSessions(`?team_id=${encodeURIComponent(mine.teamId!)}&from=${encodeURIComponent(new Date().toISOString())}&limit=100`), enabled: Boolean(mine.teamId) });
  if (!mine.playerId) return <EmptyState body="Ask an AIMZ administrator to link your account to your squad player." title="Account not linked" />;
  if (mine.isLoading) return <LoadingState label="Loading your squad" />;
  if (mine.isError) return <ErrorState message="Your linked squad could not be loaded." onRetry={mine.refetch} />;
  if (query.isLoading) return <LoadingState label="Loading training schedule" />;
  if (query.isError) return <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} />;
  if (!query.data?.items.length) return <EmptyState body="Your coach has not scheduled an upcoming training session." title="No training scheduled" />;
  return <View style={styles.groups}>{groupSessionsByDate(query.data.items).map((group) => <View key={group.dateKey} style={styles.group}><Text accessibilityRole="header" style={styles.date}>{group.isToday ? 'Today' : new Intl.DateTimeFormat('en-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' }).format(group.date)}</Text>{group.sessions.map((session) => <Pressable accessibilityLabel={`Training at ${session.venue}, ${formatEgyptDateTime(session.starts_at)}`} accessibilityRole="button" key={session.id} onPress={() => router.push({ pathname: '/training/[id]', params: { id: session.id } })} style={({ pressed }) => [styles.card, pressed && styles.pressed]}><Text style={styles.time}>{formatEgyptDateTime(session.starts_at)}</Text><Text style={styles.venue}>{session.venue}</Text><Text style={styles.meta}>{session.duration_minutes} minutes{session.notes ? ` · ${session.notes}` : ''}</Text></Pressable>)}</View>)}</View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.xs, minHeight: theme.touch.minimum, padding: theme.spacing.md }, date: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, group: { gap: theme.spacing.sm }, groups: { gap: theme.spacing.lg }, meta: { color: colors.textMuted }, pressed: { opacity: 0.7 }, time: { color: colors.accentSoft, fontWeight: '900' }, venue: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' } });
