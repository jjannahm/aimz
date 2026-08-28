import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompetitionGroup } from '@/src/components/CompetitionGroup';
import { SegmentedTabs } from '@/src/components/SegmentedTabs';
import { DateSectionHeader } from '@/src/components/DateSectionHeader';
import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { groupMatches } from '@/src/lib/matchGroups';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { MatchStatus } from '@/src/types/api';

const filters: { label: string; value: MatchStatus }[] = [
  { label: 'Live', value: 'live' }, { label: 'Upcoming', value: 'scheduled' }, { label: 'Results', value: 'finished' },
];

export default function MatchesScreen() {
  const styles = useThemedStyles(stylesheet);
  const [status, setStatus] = useState<MatchStatus>('live');
  const query = useQuery({ queryKey: ['matches', status], queryFn: () => api.matches(`?match_status=${status}&limit=50`), refetchInterval: status === 'finished' ? false : 12_000 });
  const matches = useMemo(() => query.data?.items ?? [], [query.data]);
  const dateGroups = useMemo(() => groupMatches(matches, status), [matches, status]);
  return <Screen title="Match centre">
    <SegmentedTabs label="Which matches to show" onChange={setStatus} options={filters} value={status} />
    {query.isLoading ? <LoadingState label="Loading matches" /> : query.isError ? <ErrorState message={query.error instanceof ApiError ? query.error.message : copy.offline} onRetry={() => query.refetch()} /> : matches.length === 0 ? <EmptyState body={copy.emptyMatches} title={`No ${filters.find((item) => item.value === status)?.label.toLowerCase()} matches`} /> : <View style={styles.listContent}>{dateGroups.map((item) => <View key={item.dateKey} style={styles.dateSection}>{status === 'live' ? null : <DateSectionHeader date={item.date} isToday={item.isToday} matchCount={item.matchesCount} />}<View style={styles.competitions}>{item.competitions.map((competition) => <CompetitionGroup group={competition} key={competition.competitionId} />)}</View></View>)}</View>}
  </Screen>;
}
const stylesheet = (colors: ThemeColors) => StyleSheet.create({ pressed: { opacity: 0.72 }, listContent: { gap: theme.spacing.xl }, dateSection: { gap: theme.spacing.md }, competitions: { gap: theme.spacing.md } });
