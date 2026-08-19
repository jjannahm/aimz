import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { initialsFor, TeamAvatar } from '@/src/components/TeamAvatar';
import { api, ApiError } from '@/src/lib/api';
import { theme } from '@/src/theme';
import type { Competition } from '@/src/types/api';

function CompetitionHeader({ competition }: { competition: Competition }) {
  return <View accessibilityLabel={`${competition.name}, season ${competition.season}`} style={styles.headerCard}>
    <View accessibilityElementsHidden style={styles.crest}><Text style={styles.crestText}>{initialsFor(competition.name)}</Text></View>
    <View style={styles.headerCopy}>
      <Text numberOfLines={1} style={styles.headerName}>{competition.name}</Text>
      <Text numberOfLines={1} style={styles.headerSeason}>{competition.season}</Text>
    </View>
  </View>;
}

export default function StandingsScreen() {
  const competitions = useQuery({ queryKey: ['competitions'], queryFn: () => api.competitions('?limit=100') });
  const eligible = useMemo(() => competitions.data?.items.filter((item) => item.type !== 'friendly') ?? [], [competitions.data]);
  const [selected, setSelected] = useState<string | null>(null);
  const competition = eligible.find((item) => item.id === selected) ?? eligible[0];
  const competitionId = competition?.id;
  const table = useQuery({ queryKey: ['standings', competitionId], queryFn: () => api.standings(competitionId!), enabled: Boolean(competitionId) });

  return <Screen eyebrow="Computed from final scores" title="Standings">
    {/* Only worth a switcher when more than one competition is running. */}
    {eligible.length > 1 ? <ScrollView contentContainerStyle={styles.tabs} horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
      {eligible.map((item) => {
        const active = item.id === competitionId;
        return <Pressable accessibilityLabel={item.name} accessibilityRole="tab" accessibilityState={{ selected: active }} key={item.id} onPress={() => setSelected(item.id)} style={({ pressed }) => [styles.tab, active && styles.activeTab, pressed && styles.pressed]}>
          <Text style={[styles.tabLabel, active && styles.activeLabel]}>{item.name}</Text>
        </Pressable>;
      })}
    </ScrollView> : null}
    {competition ? <CompetitionHeader competition={competition} /> : null}
    {competitions.isLoading || table.isLoading ? <LoadingState label="Calculating table" /> : competitions.isError || table.isError ? <ErrorState message={(competitions.error as ApiError | null)?.message ?? (table.error as ApiError | null)?.message ?? 'Could not load standings.'} onRetry={() => { competitions.refetch(); table.refetch(); }} /> : !competitionId || !table.data?.length ? <EmptyState body="Finished league and tournament matches will create the table automatically." title="No standings yet" /> : <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={styles.rankHeader}>#</Text>
        <Text style={[styles.team, styles.headerText]}>TEAM</Text>
        <Text style={[styles.stat, styles.headerText]}>P</Text>
        <Text style={[styles.stat, styles.headerText]}>GD</Text>
        <Text style={[styles.stat, styles.headerText]}>PTS</Text>
      </View>
      {table.data.map((row, index) => <View key={row.team.id} style={[styles.row, index % 2 === 1 && styles.altRow, row.team.is_aimz && styles.aimzRow, row.rank === 1 && styles.leaderRow]}>
        <Text style={[styles.rank, row.rank === 1 && styles.leaderRank]}>{row.rank}</Text>
        <View style={styles.teamCell}>
          <TeamAvatar logoUrl={row.team.logo_url} name={row.team.name} size={34} />
          <View style={styles.team}>
            <Text numberOfLines={1} style={styles.teamName}>{row.team.name}</Text>
            {row.team.squad_code ? <Text numberOfLines={1} style={styles.code}>{row.team.squad_code}</Text> : null}
          </View>
        </View>
        <Text style={styles.stat}>{row.played}</Text>
        <Text style={styles.stat}>{row.goal_difference > 0 ? '+' : ''}{row.goal_difference}</Text>
        <Text style={[styles.stat, styles.points]}>{row.points}</Text>
      </View>)}
    </View>}
  </Screen>;
}

const styles = StyleSheet.create({
  tabBar: { flexGrow: 0 },
  tabs: { gap: theme.spacing.sm },
  tab: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md },
  activeTab: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  tabLabel: { color: theme.colors.textSecondary, fontWeight: '800' },
  activeLabel: { color: theme.colors.onAccent, fontWeight: '900' },
  headerCard: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 80, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  crest: { alignItems: 'center', backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.accent, borderRadius: 24, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 },
  crestText: { color: theme.colors.lightBlue, fontSize: theme.type.body, fontWeight: '900', letterSpacing: 0.3 },
  headerCopy: { flex: 1, gap: 2 },
  headerName: { color: theme.colors.textPrimary, fontSize: theme.type.body, fontWeight: '900' },
  headerSeason: { color: theme.colors.textMuted, fontSize: theme.type.label },
  pressed: { opacity: 0.7 },
  table: { borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, overflow: 'hidden' },
  tableHeader: { alignItems: 'center', backgroundColor: theme.colors.surfaceRaised, flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  headerText: { color: theme.colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', letterSpacing: 0.6 },
  rankHeader: { color: theme.colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', width: 22 },
  row: { alignItems: 'center', backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border, borderTopWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 62, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  altRow: { backgroundColor: theme.colors.surfaceRaised },
  aimzRow: { backgroundColor: theme.colors.highlightedSurface },
  leaderRow: { borderLeftColor: theme.colors.warning, borderLeftWidth: 3 },
  rank: { color: theme.colors.textMuted, fontVariant: ['tabular-nums'], fontWeight: '800', width: 22 },
  leaderRank: { color: theme.colors.warning, fontWeight: '900' },
  teamCell: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm },
  team: { flex: 1 },
  teamName: { color: theme.colors.textPrimary, fontWeight: '800' },
  code: { color: theme.colors.lightBlue, fontSize: theme.type.caption, marginTop: 2 },
  stat: { color: theme.colors.textSecondary, fontVariant: ['tabular-nums'], textAlign: 'right', width: 38 },
  points: { color: theme.colors.textPrimary, fontWeight: '900' },
});
