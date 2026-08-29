import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

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

type Props = {
  /** Narrow the trail to one match. Omitted reads the whole academy. */
  matchId?: string;
  /** Settings shows a recent slice; the full screen shows everything fetched. */
  limit?: number;
};

/**
 * The admin activity trail. Shared so the Settings card and the full screen
 * render the same rows from one place.
 */
export function AuditTrail({ matchId, limit }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const trail = useQuery({
    queryKey: ['audit-log', matchId ?? 'all'],
    queryFn: () => api.auditLog(matchId),
  });

  if (trail.isLoading) return <LoadingState label="Loading activity" />;
  if (trail.isError) return <ErrorState message={(trail.error as ApiError).message} onRetry={() => trail.refetch()} />;
  const all = trail.data?.items ?? [];
  if (!all.length) {
    return <EmptyState body="Scoring a match, saving a lineup or correcting an event will show up here." title="Nothing recorded yet" />;
  }
  const entries = limit === undefined ? all : all.slice(0, limit);
  const total = trail.data?.total ?? all.length;
  return <View style={styles.list}>
    <Text style={styles.count}>
      {entries.length < total ? `Latest ${entries.length} of ${total} actions` : `${total} ${total === 1 ? 'action' : 'actions'} recorded`}
    </Text>
    {entries.map((entry: AuditEntry) => <View key={entry.id} style={styles.entry}>
      <View style={styles.icon}>
        <Ionicons accessibilityElementsHidden color={colors.accentSoft} name={actionIcon[entry.action] ?? 'ellipse-outline'} size={18} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.summary}>{entry.summary}</Text>
        <Text style={styles.meta}>{entry.actor_name} · {when(entry.created_at)}</Text>
      </View>
    </View>)}
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  list: { gap: theme.spacing.sm },
  count: { color: colors.textMuted, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 0.8, textTransform: 'uppercase' },
  entry: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 64, padding: theme.spacing.md },
  icon: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  copy: { flex: 1 },
  summary: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  meta: { color: colors.textMuted, fontSize: theme.type.label, marginTop: 3 },
});
