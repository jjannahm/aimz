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
  return <View style={styles.list}>{query.data.items.map((item) => <View key={item.id} style={styles.card}><View style={styles.header}><Text style={styles.title}>{item.title}</Text>{item.pinned ? <View accessibilityLabel="Pinned announcement" style={styles.pin}><Ionicons accessibilityElementsHidden color={colors.accentSoft} name="pin-outline" size={16} /><Text style={styles.pinText}>Pinned</Text></View> : null}</View><Text style={styles.body}>{item.body}</Text><Text style={styles.meta}>{item.author_name ?? 'AIMZ coach'} · {formatEgyptDateTime(item.created_at)}{item.team ? ` · ${item.team.name}` : ' · Whole academy'}</Text></View>)}</View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ body: { color: colors.textSecondary, fontFamily: theme.font.regular, fontSize: theme.type.body, lineHeight: 23 }, card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.size.cardPadding }, header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' }, list: { gap: theme.spacing.sm }, meta: { color: colors.textMuted, fontFamily: theme.font.mono, fontSize: theme.type.caption }, pin: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs }, pinText: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.caption }, title: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.bold, fontSize: theme.type.heading } });
