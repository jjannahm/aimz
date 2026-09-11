import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { StatGrid, type Stat } from '@/src/components/StatGrid';
import { isGoalkeeper } from '@/src/lib/positions';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export function PlayerStatsPanel({ playerId, season }: { playerId: string; season?: string }) {
  const styles = useThemedStyles(stylesheet);
  // Undefined is the whole career, which is what every caller but the profile's
  // season switcher wants. The key carries it so the two do not share a cache.
  const query = useQuery({ queryKey: ['player-stats', playerId, season ?? null], queryFn: () => api.playerStats(playerId, season), enabled: Boolean(playerId) });
  if (query.isLoading) return <LoadingState label="Loading player stats" />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as ApiError)?.message ?? 'Player not found.'} onRetry={() => query.refetch()} />;
  // Goalkeeping is only shown to a keeper. On an outfielder these are three
  // zeroes that say nothing, and they would crowd out the tallies that do.
  const keeping = { clean_sheets: query.data.clean_sheets ?? 0, goals_conceded: query.data.goals_conceded ?? 0, penalties_saved: query.data.penalties_saved ?? 0 };
  const keeps = isGoalkeeper(query.data.player.position) || keeping.clean_sheets > 0 || keeping.penalties_saved > 0 || keeping.goals_conceded > 0;
  // Training belongs to the other half of the record, and is read there.
  const tiles: Stat[] = [
    { key: 'appearances', label: 'Appearances', value: query.data.appearances },
    { key: 'minutes', label: 'Minutes', value: query.data.minutes_played },
    { key: 'goals', label: 'Goals', value: query.data.goals },
    { key: 'assists', label: 'Assists', value: query.data.assists },
    { key: 'yellow', label: 'Yellow cards', value: query.data.yellow_cards },
    { key: 'red', label: 'Red cards', value: query.data.red_cards },
    ...(keeps ? [
      { key: 'clean-sheets', label: 'Clean sheets', value: keeping.clean_sheets },
      { key: 'conceded', label: 'Goals conceded', value: keeping.goals_conceded },
      { key: 'penalties', label: 'Penalties saved', value: keeping.penalties_saved },
    ] : []),
  ];
  // Who she is is the page's header to say — her name, shirt and position are
  // up there already, and a card repeating them cost a screenful of height
  // before the first figure. The figures open the panel now.
  return <>
    <StatGrid stats={tiles} />
    <Text style={styles.heading}>Match breakdown</Text>
    {query.data.matches.length === 0 ? <Text style={styles.empty}>No finished-match statistics yet.</Text> : query.data.matches.map((item) => <FlatCard key={item.id} radius={theme.radius.md} style={styles.match}>
      <Text style={styles.matchTitle}>{item.opponent ? `vs ${item.opponent.name}` : `${item.minutes_played} minutes`}</Text>
      <Text style={styles.matchDate}>{formatEgyptDateTime(item.kickoff_datetime)}</Text>
      {/* The squad she played for that day, which is not always the squad she is
          on now — worth saying so once she has moved. */}
      <Text style={styles.matchMeta}>{item.team && item.team.id !== query.data.player.team_id ? `${item.team.name} · ` : ''}{item.minutes_played} min · {item.goals} goals · {item.assists} assists · {item.yellow_cards + item.red_cards} cards</Text>
    </FlatCard>)}
  </>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  empty: { color: colors.textMuted, fontFamily: theme.font.regular },
  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  match: { padding: theme.spacing.md },
  matchTitle: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  matchDate: { color: colors.textSecondary, fontFamily: theme.font.mono, fontSize: theme.type.caption, marginTop: 3 },
  matchMeta: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 4 },
});
