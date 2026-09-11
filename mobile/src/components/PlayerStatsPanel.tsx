import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { FlatCard } from '@/src/components/FlatCard';
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
  // `isPending` rather than `isLoading`: a query that has not resolved must not
  // fall through to the figures below, where a record still on its way would be
  // drawn as a record of nothing.
  if (query.isPending) return <LoadingState label="Loading player stats" />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as ApiError)?.message ?? 'Player not found.'} onRetry={() => query.refetch()} />;
  const columns = ['App', 'Min', 'G', 'A', 'YC', 'RC'];
  const total = [query.data.appearances, query.data.minutes_played, query.data.goals, query.data.assists, query.data.yellow_cards, query.data.red_cards];
  return <>
    <FlatCard radius={theme.radius.md} style={styles.table}>
      <Text style={styles.tableTitle}>{query.data.season ?? 'Career'} totals</Text>
      <View accessibilityRole="header" style={styles.tableRow}>
        <Text style={[styles.competition, styles.columnLabel]}>Competition</Text>
        {columns.map((column) => <Text key={column} style={[styles.numberColumn, styles.columnLabel]}>{column}</Text>)}
      </View>
      {(query.data.competitions ?? []).map((competition) => <View key={competition.competition_id} style={[styles.tableRow, styles.tableDivider]}>
        <View style={styles.competition}><Text numberOfLines={1} style={styles.competitionName}>{competition.competition_name}</Text>{!query.data.season ? <Text style={styles.competitionSeason}>{competition.season}</Text> : null}</View>
        {[competition.appearances, competition.minutes_played, competition.goals, competition.assists, competition.yellow_cards, competition.red_cards].map((value, index) => <Text key={columns[index]} style={styles.numberColumn}>{value}</Text>)}
      </View>)}
      <View style={[styles.tableRow, styles.tableDivider]}><Text style={[styles.competition, styles.totalLabel]}>Total</Text>{total.map((value, index) => <Text key={columns[index]} style={[styles.numberColumn, styles.totalValue]}>{value}</Text>)}</View>
    </FlatCard>
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
  table: { overflow: 'hidden', padding: 0 },
  tableTitle: { color: colors.textPrimary, fontFamily: theme.font.bold, padding: theme.spacing.md },
  tableRow: { alignItems: 'center', flexDirection: 'row', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.sm },
  tableDivider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  competition: { flex: 1, minWidth: 0, paddingRight: theme.spacing.xs },
  competitionName: { color: colors.textPrimary, fontFamily: theme.font.semibold, fontSize: theme.type.label },
  competitionSeason: { color: colors.textMuted, fontSize: theme.type.caption },
  numberColumn: { color: colors.textPrimary, fontFamily: theme.font.mono, fontSize: theme.type.caption, textAlign: 'center', width: 38 },
  columnLabel: { color: colors.textMuted, fontFamily: theme.font.semibold },
  totalLabel: { color: colors.textPrimary, fontFamily: theme.font.bold },
  totalValue: { fontFamily: theme.font.monoBold },
});
