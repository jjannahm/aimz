import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

export function AnnouncementsSection() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  // A parent has children rather than a player record of their own.
  const linked = user?.role === 'parent' || Boolean(user?.player_id);
  // No team is named: the server answers with the squad this account is on, or
  // with every squad a parent's children are on.
  const query = useQuery({ queryKey: ['announcements', 'mine'], queryFn: () => api.announcements('?limit=100'), enabled: linked });
  if (!linked) return <EmptyState body="Ask an AIMZ administrator to link your account to your squad player." title="Account not linked" />;
  if (query.isLoading) return <LoadingState label="Loading announcements" />;
  if (query.isError) return <ErrorState message={(query.error as ApiError).message} onRetry={() => query.refetch()} />;
  if (!query.data?.items.length) return <EmptyState body="Coach announcements will appear here." title="No announcements" />;
  return <View style={styles.list}>{query.data.items.map((item) => <View key={item.id} style={[styles.card, item.priority === 'urgent' && styles.urgentCard]}>
      {/* Urgent says so before the words do: a red rule and a badge, in the red
        * the rest of the app keeps for something being wrong. */}
      {item.priority === 'urgent' ? <View accessibilityLabel="Urgent announcement" style={styles.urgentBadge}><Text style={styles.urgentText}>URGENT</Text></View> : null}
      <View style={styles.header}><Text style={[styles.title, item.priority === 'urgent' && styles.urgentTitle]}>{item.title}</Text>{item.priority === 'pinned' ? <View accessibilityLabel="Pinned announcement" style={styles.pin}><Ionicons accessibilityElementsHidden color={colors.accentSoft} name="pin-outline" size={16} /><Text style={styles.pinText}>Pinned</Text></View> : null}</View><Text style={styles.body}>{item.body}</Text><Text style={styles.meta}>{item.author_name ?? 'AIMZ coach'} · {formatEgyptDateTime(item.created_at)}{item.team ? ` · ${item.team.name}` : ' · Whole academy'}</Text></View>)}</View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ body: { color: colors.textSecondary, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 23 }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.size.cardPadding }, header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' }, list: { gap: theme.spacing.sm }, meta: { color: colors.textMuted, fontFamily: theme.font.mono, fontSize: theme.type.caption }, pin: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs }, pinText: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.caption }, title: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.bold, fontSize: theme.type.heading }, urgentCard: { borderColor: colors.error }, urgentBadge: { alignSelf: 'flex-start', backgroundColor: colors.error, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.sm, paddingVertical: 2 }, urgentText: { color: colors.onStatus, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1 }, urgentTitle: { color: colors.error } });
