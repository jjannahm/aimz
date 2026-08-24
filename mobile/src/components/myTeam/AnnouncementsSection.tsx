import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { useMyTeam } from '@/src/auth/useMyTeam';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

export function AnnouncementsSection() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const mine = useMyTeam();
  const query = useQuery({ queryKey: ['announcements', mine.teamId], queryFn: () => api.announcements(`?team_id=${encodeURIComponent(mine.teamId!)}&limit=100`), enabled: Boolean(mine.teamId) });
  if (!mine.playerId) return <EmptyState body="Ask an AIMZ administrator to link your account to your squad player." title="Account not linked" />;
  if (mine.isLoading) return <LoadingState label="Loading your squad" />;
  if (mine.isError) return <ErrorState message="Your linked squad could not be loaded." onRetry={mine.refetch} />;
  if (query.isLoading) return <LoadingState label="Loading announcements" />;
  if (query.isError) return <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} />;
  if (!query.data?.items.length) return <EmptyState body="Coach announcements will appear here." title="No announcements" />;
  return <View style={styles.list}>{query.data.items.map((item) => <View key={item.id} style={styles.card}><View style={styles.header}><Text style={styles.title}>{item.title}</Text>{item.pinned ? <View accessibilityLabel="Pinned announcement" style={styles.pin}><Ionicons accessibilityElementsHidden color={colors.accentSoft} name="pin-outline" size={16} /><Text style={styles.pinText}>Pinned</Text></View> : null}</View><Text style={styles.body}>{item.body}</Text><Text style={styles.meta}>{item.author_name ?? 'AIMZ coach'} · {formatEgyptDateTime(item.created_at)}{item.team ? ` · ${item.team.name}` : ' · Whole academy'}</Text></View>)}</View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ body: { color: colors.textSecondary, fontSize: theme.type.body, lineHeight: 23 }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md }, header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' }, list: { gap: theme.spacing.sm }, meta: { color: colors.textMuted, fontSize: theme.type.caption }, pin: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs }, pinText: { color: colors.accentSoft, fontSize: theme.type.caption, fontWeight: '800' }, title: { color: colors.textPrimary, flex: 1, fontSize: theme.type.heading, fontWeight: '900' } });
