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
import { useAuth } from '@/src/auth/AuthProvider';
import { useHasCompetition } from '@/src/lib/squad';

/**
 * What the page is showing. The table reads as the end of the same sequence —
 * what is being played, what is coming, what was played, and where that leaves
 * everyone — so it is a segment here rather than a tab of its own.
 */
type Segment = MatchStatus | 'standings';

const MATCH_SEGMENTS: { label: string; value: Segment }[] = [
  { label: 'Live', value: 'live' }, { label: 'Upcoming', value: 'scheduled' }, { label: 'Results', value: 'finished' },
];
const STANDINGS: { label: string; value: Segment } = { label: 'Standings', value: 'standings' };

export default function MatchesScreen() {
  const styles = useThemedStyles(stylesheet);
  const [status, setStatus] = useState<Segment>('live');
  // Saving a drawn-up competition in Manage sends the admin here to see it, and
  // what they have come for is the table, not the fixtures. Set in an effect
  // rather than as the initial state because arriving is a press away from a
  // page that is already mounted, which no initialiser would run again for.
  const { competition } = useLocalSearchParams<{ competition?: string }>();
  useEffect(() => { if (competition) setStatus('standings'); }, [competition]);
  // A squad entered in no competition has no table, and an empty Standings
  // segment is worse than no segment. An administrator keeps it whatever the
  // answer: they are the one who enters a squad in a competition, and would
  // otherwise have no way back to the screen after a season closed.
  const { hasCompetition, isLoading: askingCompetitions } = useHasCompetition();
  const { user } = useAuth();
  // Kept while the answer is still coming: a segment that appears a moment
  // after the page reads as the page changing shape under the reader, and it
  // is only dropped once there is something that says to.
  const showStandings = user?.role === 'admin' || hasCompetition || askingCompetitions;
  const filters = showStandings ? [...MATCH_SEGMENTS, STANDINGS] : MATCH_SEGMENTS;
  // The segment can go while it is the one being read — the last season of a
  // squad's only competition closing does it — and the page falls back to the
  // fixtures rather than to a segment that is no longer on the control.
  useEffect(() => { if (!showStandings && status === 'standings') setStatus('live'); }, [showStandings, status]);
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
