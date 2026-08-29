import { useQuery } from '@tanstack/react-query';
import { Image, StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
import { isGoalkeeper } from '@/src/lib/positions';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { mediaUrl } from '@/src/lib/mediaUrl';
import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

export function PlayerStatsPanel({ playerId }: { playerId: string }) {
  const styles = useThemedStyles(stylesheet);
  const query = useQuery({ queryKey: ['player-stats', playerId], queryFn: () => api.playerStats(playerId), enabled: Boolean(playerId) });
  const matches = useQuery({ queryKey: ['matches', 'player-stats', query.data?.player.team_id], queryFn: () => api.matches(`?team_id=${encodeURIComponent(query.data!.player.team_id)}&match_status=finished&limit=100`), enabled: Boolean(query.data?.player.team_id) });
  if (query.isLoading) return <LoadingState label="Loading player stats" />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as ApiError)?.message ?? 'Player not found.'} onRetry={() => query.refetch()} />;
  const byId = new Map(matches.data?.items.map((match) => [match.id, match]));
  // Goalkeeping is only shown to a keeper. On an outfielder these are three
  // zeroes that say nothing, and they would crowd out the tallies that do.
  const keeping = { clean_sheets: query.data.clean_sheets ?? 0, goals_conceded: query.data.goals_conceded ?? 0, penalties_saved: query.data.penalties_saved ?? 0 };
  const keeps = isGoalkeeper(query.data.player.position) || keeping.clean_sheets > 0 || keeping.penalties_saved > 0 || keeping.goals_conceded > 0;
  const tiles = [
    { label: 'Appearances', value: query.data.appearances },
    { label: 'Minutes', value: query.data.minutes_played },
    { label: 'Goals', value: query.data.goals },
    { label: 'Assists', value: query.data.assists },
    { label: 'Yellow cards', value: query.data.yellow_cards },
    { label: 'Red cards', value: query.data.red_cards },
    ...(keeps ? [
      { label: 'Clean sheets', value: keeping.clean_sheets },
      { label: 'Goals conceded', value: keeping.goals_conceded },
      { label: 'Penalties saved', value: keeping.penalties_saved },
    ] : []),
  ];
  return <>
    <FlatCard radius={theme.radius.lg} style={styles.profile}>{query.data.player.photo_url ? <Image accessibilityLabel={`${query.data.player.name} profile photo`} source={{ uri: mediaUrl(query.data.player.photo_url) }} style={styles.profilePhoto} /> : <View style={styles.number}><Text style={styles.numberText}>{query.data.player.jersey_number ?? '–'}</Text></View>}<View><Text style={styles.name}>{query.data.player.name}</Text><Text style={styles.position}>{query.data.player.position}</Text><Text style={styles.season}>{query.data.season ?? 'All recorded seasons'}</Text></View></FlatCard>
    <View style={styles.grid}>{tiles.map((item) => <FlatCard key={item.label} radius={theme.radius.md} style={styles.stat}><Text style={styles.value}>{item.value}</Text><Text style={styles.label}>{item.label}</Text></FlatCard>)}</View>
    <Text style={styles.heading}>Match breakdown</Text>
    {query.data.matches.length === 0 ? <Text style={styles.empty}>No finished-match statistics yet.</Text> : query.data.matches.map((item) => {
      const match = byId.get(item.match_id);
      const opponent = match?.home_team_id === query.data.player.team_id ? match.away_team : match?.home_team;
      return <FlatCard key={item.id} radius={theme.radius.md} style={styles.match}><Text style={styles.matchTitle}>{opponent ? `vs ${opponent.name}` : `${item.minutes_played} minutes`}</Text>{match ? <Text style={styles.matchDate}>{formatEgyptDateTime(match.kickoff_datetime)}</Text> : null}<Text style={styles.matchMeta}>{item.minutes_played} min · {item.goals} goals · {item.assists} assists · {item.yellow_cards + item.red_cards} cards</Text></FlatCard>;
    })}
  </>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ empty: { color: colors.textMuted, fontFamily: theme.font.regular }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }, heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading }, label: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 2 }, match: { padding: theme.spacing.md }, matchDate: { color: colors.textSecondary, fontFamily: theme.font.mono, fontSize: theme.type.caption, marginTop: 3 }, matchMeta: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 4 }, matchTitle: { color: colors.textPrimary, fontFamily: theme.font.semibold }, name: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading }, number: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 28, height: 56, justifyContent: 'center', width: 56 }, numberText: { color: colors.onAccent, fontFamily: theme.font.monoBold, fontSize: theme.type.display }, position: { color: colors.textSecondary, fontFamily: theme.font.regular, marginTop: 2 }, profile: { alignItems: 'center', borderRadius: theme.radius.lg, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md }, profilePhoto: { borderRadius: 28, height: 56, width: 56 }, season: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 4 }, // Three to a row rather than two, and the tile only as tall as its
  // number and name need: twice as much fits before a scroll.
  stat: { flexBasis: '31%', flexGrow: 1, padding: theme.spacing.sm }, value: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.score, fontVariant: ['tabular-nums'] } });
