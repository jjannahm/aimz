import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { theme } from '@/src/theme';
import type { LeaderMetric, Player, PlayerLeaderRow } from '@/src/types/api';

const AGE_GROUPS = ['U9', 'U11', 'U13', 'U15', 'U18'] as const;

type Section = { key: string; label: string; metric?: LeaderMetric };

const SECTIONS: Section[] = [
  { key: 'teams', label: copy.teams },
  { key: 'top-scorers', label: copy.topScorers, metric: 'goals' },
  { key: 'top-assisters', label: copy.topAssisters, metric: 'assists' },
];

function Chevron() {
  return <Ionicons accessibilityElementsHidden color={theme.colors.textMuted} name="chevron-forward" size={20} />;
}

function PlayerRow({ player, subtitle, trailing }: { player: Player; subtitle: string; trailing?: ReactNode }) {
  return <Pressable accessibilityLabel={`${player.name}, ${subtitle}`} accessibilityRole="button" onPress={() => router.push(`/player/${player.id}`)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    {player.photo_url ? <Image accessibilityElementsHidden source={{ uri: player.photo_url }} style={styles.photo} /> : <View accessibilityElementsHidden style={styles.number}><Text style={styles.numberText}>{player.jersey_number ?? '–'}</Text></View>}
    <View style={styles.copy}><Text style={styles.name}>{player.name}</Text><Text style={styles.position}>{subtitle}</Text></View>
    {trailing}
    <Chevron />
  </Pressable>;
}

function useRoster() {
  const teams = useQuery({ queryKey: ['teams', 'roster'], queryFn: () => api.teams('?limit=100') });
  const players = useQuery({ queryKey: ['players', 'roster'], queryFn: () => api.players('?limit=100') });
  const byAgeGroup = useMemo(() => {
    const teamAgeGroups = new Map((teams.data?.items ?? []).map((team) => [team.id, team.age_group]));
    const grouped = new Map<string, Player[]>(AGE_GROUPS.map((ageGroup) => [ageGroup, []]));
    for (const player of players.data?.items ?? []) {
      grouped.get(teamAgeGroups.get(player.team_id) ?? '')?.push(player);
    }
    return grouped;
  }, [players.data, teams.data]);
  return { byAgeGroup, isLoading: teams.isLoading || players.isLoading, isError: teams.isError || players.isError, error: (teams.error ?? players.error) as ApiError | null, refetch: () => { teams.refetch(); players.refetch(); } };
}

function TeamsSection() {
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const roster = useRoster();

  if (roster.isLoading) return <LoadingState label="Loading squads" />;
  if (roster.isError) return <ErrorState message={roster.error?.message ?? 'Could not load squads.'} onRetry={roster.refetch} />;

  if (openTeam === null) {
    return <FlatList contentContainerStyle={styles.listContent} data={AGE_GROUPS} keyExtractor={(ageGroup) => ageGroup} renderItem={({ item: ageGroup }) => {
      const count = roster.byAgeGroup.get(ageGroup)?.length ?? 0;
      return <Pressable accessibilityLabel={`${ageGroup}, ${count} ${count === 1 ? 'player' : 'players'}`} accessibilityRole="button" onPress={() => setOpenTeam(ageGroup)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <View accessibilityElementsHidden style={styles.badge}><Text style={styles.badgeText}>{ageGroup}</Text></View>
        <View style={styles.copy}><Text style={styles.name}>{ageGroup}</Text><Text style={styles.position}>{count} {count === 1 ? 'player' : 'players'}</Text></View>
        <Chevron />
      </Pressable>;
    }} showsVerticalScrollIndicator={false} style={styles.list} />;
  }

  const squad = roster.byAgeGroup.get(openTeam) ?? [];
  return <View style={styles.stack}>
    <Pressable accessibilityLabel="Back to all teams" accessibilityRole="button" onPress={() => setOpenTeam(null)} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Ionicons accessibilityElementsHidden color={theme.colors.lightBlue} name="chevron-back" size={20} />
      <Text style={styles.backText}>All teams</Text>
    </Pressable>
    <Text accessibilityRole="header" style={styles.squadTitle}>{openTeam}</Text>
    {squad.length ? <FlatList contentContainerStyle={styles.listContent} data={squad} keyExtractor={(player) => player.id} renderItem={({ item }) => <PlayerRow player={item} subtitle={`${item.position}, number ${item.jersey_number ?? 'not assigned'}`} />} showsVerticalScrollIndicator={false} style={styles.list} /> : <EmptyState body={copy.emptySquad(openTeam)} title={`No ${openTeam} players yet`} />}
  </View>;
}

function LeaderSection({ metric }: { metric: LeaderMetric }) {
  const leaders = useQuery({ queryKey: ['leaders', metric], queryFn: () => api.leaders(metric, { limit: 25 }) });
  const unit = metric === 'goals' ? 'goals' : 'assists';

  if (leaders.isLoading) return <LoadingState label={`Loading ${unit} leaders`} />;
  if (leaders.isError) return <ErrorState message={(leaders.error as ApiError).message} onRetry={() => leaders.refetch()} />;
  if (!leaders.data?.length) return <EmptyState body={copy.emptyLeaders} title={`No ${unit} recorded yet`} />;
  return <FlatList contentContainerStyle={styles.listContent} data={leaders.data} keyExtractor={(row: PlayerLeaderRow) => row.player.id} renderItem={({ item }) => <View style={styles.leaderRow}>
    <Text accessibilityElementsHidden style={styles.rank}>{item.rank}</Text>
    <View style={styles.leaderPlayer}><PlayerRow player={item.player} subtitle={`${item.team.name}, ${item[metric]} ${unit} in ${item.appearances} ${item.appearances === 1 ? 'appearance' : 'appearances'}`} trailing={<Text accessibilityElementsHidden style={styles.tally}>{item[metric]}</Text>} /></View>
  </View>} showsVerticalScrollIndicator={false} style={styles.list} />;
}

export default function PlayersScreen() {
  const [selected, setSelected] = useState<string>('teams');
  const section = SECTIONS.find((item) => item.key === selected) ?? SECTIONS[0]!;

  return <Screen eyebrow="Academy roster" scroll={false} title="Players">
    <ScrollView contentContainerStyle={styles.chips} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar}>
      {SECTIONS.map((item) => {
        const active = item.key === section.key;
        return <Pressable accessibilityLabel={item.label} accessibilityRole="tab" accessibilityState={{ selected: active }} key={item.key} onPress={() => setSelected(item.key)} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}>
          <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
        </Pressable>;
      })}
    </ScrollView>
    {section.metric ? <LeaderSection metric={section.metric} /> : <TeamsSection />}
  </Screen>;
}

const styles = StyleSheet.create({ chipBar: { flexGrow: 0 }, chips: { gap: theme.spacing.sm }, chip: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md }, chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }, chipText: { color: theme.colors.textSecondary, fontWeight: '700' }, chipTextActive: { color: theme.colors.onAccent, fontWeight: '900' }, stack: { flex: 1, gap: theme.spacing.md }, back: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: theme.spacing.xs, minHeight: theme.touch.minimum, paddingRight: theme.spacing.md }, backText: { color: theme.colors.lightBlue, fontWeight: '800' }, squadTitle: { color: theme.colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, list: { borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, flex: 1, overflow: 'hidden' }, listContent: { paddingBottom: theme.spacing.xl }, row: { alignItems: 'center', backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 72, padding: theme.spacing.md }, leaderRow: { alignItems: 'center', backgroundColor: theme.colors.surface, flexDirection: 'row' }, leaderPlayer: { flex: 1 }, rank: { color: theme.colors.textMuted, fontVariant: ['tabular-nums'], fontWeight: '800', paddingLeft: theme.spacing.md, textAlign: 'center', width: 34 }, tally: { color: theme.colors.lightBlue, fontSize: theme.type.heading, fontVariant: ['tabular-nums'], fontWeight: '900' }, pressed: { opacity: 0.7 }, badge: { alignItems: 'center', backgroundColor: theme.colors.surfaceRaised, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, badgeText: { color: theme.colors.lightBlue, fontSize: theme.type.label, fontWeight: '900' }, number: { alignItems: 'center', backgroundColor: theme.colors.surfaceRaised, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, photo: { borderRadius: 24, height: 48, width: 48 }, numberText: { color: theme.colors.lightBlue, fontSize: theme.type.heading, fontWeight: '900' }, copy: { flex: 1 }, name: { color: theme.colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' }, position: { color: theme.colors.textMuted, marginTop: 3 } });
