import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { GlassCard } from '@/src/components/GlassCard';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { groupSessionsByDate } from '@/src/lib/trainingSchedule';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export function ScheduleSection() {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  // A parent has children rather than a player record of their own.
  const linked = user?.role === 'parent' || Boolean(user?.player_id);
  // No team is named: the server answers with the squad this account is on, or
  // with every squad a parent's children are on.
  const query = useQuery({ queryKey: ['training', 'mine', 'upcoming'], queryFn: () => api.trainingSessions(`?from=${encodeURIComponent(new Date().toISOString())}&limit=100`), enabled: linked });
  if (!linked) return <EmptyState body="Ask an AIMZ administrator to link your account to your squad player." title="Account not linked" />;
  if (query.isLoading) return <LoadingState label="Loading training schedule" />;
  if (query.isError) return <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} />;
  if (!query.data?.items.length) return <EmptyState body="Your coach has not scheduled an upcoming training session." title="No training scheduled" />;
  return <View style={styles.groups}>{groupSessionsByDate(query.data.items).map((group) => <View key={group.dateKey} style={styles.group}><Text accessibilityRole="header" style={styles.date}>{group.isToday ? 'Today' : new Intl.DateTimeFormat('en-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long' }).format(group.date)}</Text>{group.sessions.map((session) => <Pressable accessibilityLabel={`Training at ${session.venue}, ${formatEgyptDateTime(session.starts_at)}`} accessibilityRole="button" key={session.id} onPress={() => router.push({ pathname: '/training/[id]', params: { id: session.id } })} style={({ pressed }) => [pressed && styles.pressed]}><GlassCard style={styles.card}><Text style={styles.time}>{formatEgyptDateTime(session.starts_at)}</Text><Text style={styles.venue}>{session.venue}</Text><Text style={styles.meta}>{session.duration_minutes} minutes{session.notes ? ` · ${session.notes}` : ''}</Text></GlassCard></Pressable>)}</View>)}</View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ // Tighter than the app's usual card: more of the week fits before a scroll.
  card: { gap: 2, minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs }, date: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, group: { gap: theme.spacing.xs }, groups: { gap: theme.spacing.md }, meta: { color: colors.textMuted }, pressed: { opacity: 0.7 }, time: { color: colors.accentSoft, fontWeight: '900' }, venue: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' } });
