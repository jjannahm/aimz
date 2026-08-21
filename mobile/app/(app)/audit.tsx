import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { CloseButton } from '@/src/components/CloseButton';
import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AuditEntry } from '@/src/types/api';

// Every action the API records, so the trail reads as sentences rather than keys.
const actionIcon: Record<string, keyof typeof Ionicons.glyphMap> = {
  event_added: 'add-circle-outline',
  event_corrected: 'create-outline',
  event_removed: 'trash-outline',
  lineup_saved: 'people-outline',
  minutes_saved: 'stopwatch-outline',
  man_of_the_match_set: 'trophy-outline',
  start_match: 'play-outline',
  halftime: 'pause-outline',
  start_second_half: 'play-outline',
  start_extra_time: 'time-outline',
  finish_match: 'flag-outline',
};

function when(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

export default function AuditLogScreen() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  // Reachable per match as well as whole-academy, so a disputed match can be
  // read on its own.
  const { matchId } = useLocalSearchParams<{ matchId?: string }>();
  const trail = useQuery({
    queryKey: ['audit-log', matchId ?? 'all'],
    queryFn: () => api.auditLog(matchId),
    enabled: user?.role === 'admin',
  });
  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;

  const entries = trail.data?.items ?? [];
  return <Screen
    action={<CloseButton />}
    eyebrow={matchId ? 'This match' : 'Every match'}
    title="Admin activity"
  >
    {trail.isLoading ? <LoadingState label="Loading activity" />
      : trail.isError ? <ErrorState message={(trail.error as ApiError).message} onRetry={() => trail.refetch()} />
        : entries.length === 0 ? <EmptyState body="Scoring a match, saving a lineup or correcting an event will show up here." title="Nothing recorded yet" />
          : <View style={styles.list}>
            <Text style={styles.count}>{trail.data?.total} {trail.data?.total === 1 ? 'action' : 'actions'} recorded</Text>
            {entries.map((entry: AuditEntry) => <View key={entry.id} style={styles.entry}>
              <View style={styles.icon}>
                <Ionicons color={colors.accentSoft} name={actionIcon[entry.action] ?? 'ellipse-outline'} size={18} />
              </View>
              <View style={styles.copy}>
                <Text style={styles.summary}>{entry.summary}</Text>
                <Text style={styles.meta}>{entry.actor_name} · {when(entry.created_at)}</Text>
              </View>
            </View>)}
          </View>}
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  list: { gap: theme.spacing.sm },
  count: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  entry: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 64, padding: theme.spacing.md },
  icon: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  copy: { flex: 1 },
  summary: { color: colors.textPrimary, fontWeight: '800' },
  meta: { color: colors.textMuted, fontSize: theme.type.label, marginTop: 3 },
});
