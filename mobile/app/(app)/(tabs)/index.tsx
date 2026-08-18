import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { MatchCard } from '@/src/components/MatchCard';
import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { theme } from '@/src/theme';
import type { MatchStatus } from '@/src/types/api';

const filters: { label: string; value: MatchStatus }[] = [
  { label: 'Live', value: 'live' }, { label: 'Upcoming', value: 'scheduled' }, { label: 'Results', value: 'finished' },
];

export default function MatchesScreen() {
  const [status, setStatus] = useState<MatchStatus>('live');
  const query = useQuery({ queryKey: ['matches', status], queryFn: () => api.matches(`?match_status=${status}&limit=50`), refetchInterval: status === 'live' ? 12_000 : false });
  const matches = useMemo(() => query.data?.items ?? [], [query.data]);
  return <Screen eyebrow="AIMZ girls' football" scroll={false} title="Match centre">
    <View accessibilityRole="tablist" style={styles.tabs}>{filters.map((filter) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: filter.value === status }} key={filter.value} onPress={() => setStatus(filter.value)} style={({ pressed }) => [styles.tab, filter.value === status && styles.activeTab, pressed && styles.pressed]}><Text style={[styles.tabLabel, filter.value === status && styles.activeLabel]}>{filter.label}</Text></Pressable>)}</View>
    {query.isLoading ? <LoadingState label="Loading matches" /> : query.isError ? <ErrorState message={query.error instanceof ApiError ? query.error.message : copy.offline} onRetry={() => query.refetch()} /> : matches.length === 0 ? <EmptyState body={copy.emptyMatches} title={`No ${filters.find((item) => item.value === status)?.label.toLowerCase()} matches`} /> : <FlatList contentContainerStyle={styles.listContent} data={matches} keyExtractor={(match) => match.id} renderItem={({ item }) => <MatchCard match={item} />} showsVerticalScrollIndicator={false} style={styles.list} />}
  </Screen>;
}
const styles = StyleSheet.create({ tabs: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', padding: theme.spacing.xs }, tab: { alignItems: 'center', borderRadius: theme.radius.sm, flex: 1, justifyContent: 'center', minHeight: theme.touch.minimum }, activeTab: { backgroundColor: theme.colors.accent }, tabLabel: { color: theme.colors.textSecondary, fontWeight: '800' }, activeLabel: { color: theme.colors.onAccent }, pressed: { opacity: 0.72 }, list: { flex: 1 }, listContent: { gap: theme.spacing.md, paddingBottom: theme.spacing.xl } });
