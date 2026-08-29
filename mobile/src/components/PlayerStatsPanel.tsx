import { useQuery } from '@tanstack/react-query';
import { Image, StyleSheet, Text, View } from 'react-native';

import { GlassSurface } from '@/src/components/GlassSurface';
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
  return <>
    <GlassSurface radius={22} style={styles.profile}>{query.data.player.photo_url ? <Image accessibilityLabel={`${query.data.player.name} profile photo`} source={{ uri: mediaUrl(query.data.player.photo_url) }} style={styles.profilePhoto} /> : <View style={styles.number}><Text style={styles.numberText}>{query.data.player.jersey_number ?? '–'}</Text></View>}<View><Text style={styles.name}>{query.data.player.name}</Text><Text style={styles.position}>{query.data.player.position}</Text><Text style={styles.season}>{query.data.season ?? 'All recorded seasons'}</Text></View></GlassSurface>
    <View style={styles.grid}>{[{ label: 'Appearances', value: query.data.appearances }, { label: 'Minutes', value: query.data.minutes_played }, { label: 'Goals', value: query.data.goals }, { label: 'Assists', value: query.data.assists }, { label: 'Yellow cards', value: query.data.yellow_cards }, { label: 'Red cards', value: query.data.red_cards }].map((item) => <GlassSurface key={item.label} radius={16} style={styles.stat}><Text style={styles.value}>{item.value}</Text><Text style={styles.label}>{item.label}</Text></GlassSurface>)}</View>
    <Text style={styles.heading}>Match breakdown</Text>
    {query.data.matches.length === 0 ? <Text style={styles.empty}>No finished-match statistics yet.</Text> : query.data.matches.map((item) => {
      const match = byId.get(item.match_id);
      const opponent = match?.home_team_id === query.data.player.team_id ? match.away_team : match?.home_team;
      return <GlassSurface key={item.id} radius={16} style={styles.match}><Text style={styles.matchTitle}>{opponent ? `vs ${opponent.name}` : `${item.minutes_played} minutes`}</Text>{match ? <Text style={styles.matchDate}>{formatEgyptDateTime(match.kickoff_datetime)}</Text> : null}<Text style={styles.matchMeta}>{item.minutes_played} min · {item.goals} goals · {item.assists} assists · {item.yellow_cards + item.red_cards} cards</Text></GlassSurface>;
    })}
  </>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ empty: { color: colors.textMuted }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }, heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, label: { color: colors.textMuted, marginTop: 2 }, match: { paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs }, matchDate: { color: colors.textSecondary, fontSize: theme.type.caption, marginTop: 3 }, matchMeta: { color: colors.textMuted, marginTop: 4 }, matchTitle: { color: colors.textPrimary, fontWeight: '800' }, name: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, number: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 32, height: 64, justifyContent: 'center', width: 64 }, numberText: { color: colors.onAccent, fontSize: theme.type.display, fontWeight: '900' }, position: { color: colors.textSecondary, marginTop: 2 }, profile: { alignItems: 'center', borderRadius: theme.radius.lg, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.sm }, profilePhoto: { borderRadius: 32, height: 64, width: 64 }, season: { color: colors.textMuted, marginTop: 4 }, // Three to a row rather than two, and the tile only as tall as its
  // number and name need: twice as much fits before a scroll.
  stat: { flexBasis: '31%', flexGrow: 1, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs }, value: { color: colors.textPrimary, fontSize: theme.type.score, fontVariant: ['tabular-nums'], fontWeight: '900' } });
