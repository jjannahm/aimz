import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { CompetitionGroup } from '@/src/components/CompetitionGroup';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { DateSectionHeader } from '@/src/components/DateSectionHeader';
import { Screen } from '@/src/components/Screen';
import { StandingsSection } from '@/src/components/StandingsSection';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { groupMatches } from '@/src/lib/matchGroups';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';
import type { MatchStatus } from '@/src/types/api';

/**
 * What the page is showing. The table reads as the end of the same sequence —
 * what is being played, what is coming, what was played, and where that leaves
 * everyone — so it is a segment here rather than a tab of its own.
 */
type Segment = MatchStatus | 'standings';

const filters: { label: string; value: Segment }[] = [
  { label: 'Live', value: 'live' }, { label: 'Upcoming', value: 'scheduled' }, { label: 'Results', value: 'finished' }, { label: 'Standings', value: 'standings' },
];

export default function MatchesScreen() {
  const styles = useThemedStyles(stylesheet);
  const [status, setStatus] = useState<Segment>('live');
  // Saving a drawn-up competition in Manage sends the admin here to see it, and
  // what they have come for is the table, not the fixtures. Set in an effect
  // rather than as the initial state because arriving is a press away from a
  // page that is already mounted, which no initialiser would run again for.
  const { competition } = useLocalSearchParams<{ competition?: string }>();
  useEffect(() => { if (competition) setStatus('standings'); }, [competition]);
  const table = status === 'standings';
  // Nothing to ask the matches endpoint for while the table is up, so the
  // twelve-second poll stops with it rather than running behind the page.
  const query = useQuery({ queryKey: ['matches', status], queryFn: () => api.matches(`?match_status=${status}&limit=50`), enabled: !table, refetchInterval: table || status === 'finished' ? false : 12_000 });
  const matches = useMemo(() => query.data?.items ?? [], [query.data]);
  const dateGroups = useMemo(() => groupMatches(matches, table ? 'finished' : status), [matches, status, table]);
  return <Screen title="Match Centre">
    <SegmentedControl label="Which matches to show" onChange={setStatus} options={filters} value={status} />
    {table ? <StandingsSection /> : query.isLoading ? <LoadingState label="Loading matches" /> : query.isError ? <ErrorState message={query.error instanceof ApiError ? query.error.message : copy.offline} onRetry={() => query.refetch()} /> : matches.length === 0 ? <EmptyState body={copy.emptyMatches} icon="calendar-outline" title={`No ${filters.find((item) => item.value === status)?.label.toLowerCase()} matches`} /> : <View style={styles.listContent}>{dateGroups.map((item) => <View key={item.dateKey} style={styles.dateSection}>{status === 'live' ? null : <DateSectionHeader date={item.date} isToday={item.isToday} matchCount={item.matchesCount} />}<View style={styles.competitions}>{item.competitions.map((competition) => <CompetitionGroup group={competition} key={competition.competitionId} />)}</View></View>)}</View>}
  </Screen>;
}
const stylesheet = (_colors: ThemeColors) => StyleSheet.create({ pressed: { opacity: 0.72 }, listContent: { gap: theme.spacing.lg }, dateSection: { gap: theme.spacing.sm }, competitions: { gap: theme.spacing.sm } });
