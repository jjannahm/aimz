import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/Screen';
import { JerseyIcon } from '@/src/components/JerseyIcon';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { theme } from '@/src/theme';
import type { LeaderMetric, Player, PlayerLeaderRow } from '@/src/types/api';

type Section = { key: string; label: string; metric?: LeaderMetric };

const SECTIONS: Section[] = [
  { key: 'teams', label: copy.teams },
  { key: 'top-scorers', label: copy.topScorers, metric: 'goals' },
  { key: 'top-assisters', label: copy.topAssisters, metric: 'assists' },
];

function Chevron() {
  return <Ionicons accessibilityElementsHidden color={theme.colors.textMuted} name="chevron-forward" size={20} />;
}

function PlayerRow({ player, subtitle, spoken, trailing }: { player: Player; subtitle: string; spoken?: string; trailing?: ReactNode }) {
  return <Pressable accessibilityLabel={`${player.name}, ${spoken ?? subtitle}`} accessibilityRole="button" onPress={() => router.push(`/player/${player.id}`)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    {player.photo_url ? <Image accessibilityElementsHidden source={{ uri: player.photo_url }} style={styles.photo} /> : <JerseyIcon number={player.jersey_number} size={48} />}
    <View style={styles.copy}><Text style={styles.name}>{player.name}</Text><Text style={styles.position}>{subtitle}</Text></View>
    {trailing}
    <Chevron />
  </Pressable>;
}

function useRoster() {
  const teams = useQuery({ queryKey: ['teams', 'roster'], queryFn: () => api.teams('?limit=100') });
  const players = useQuery({ queryKey: ['players', 'roster'], queryFn: () => api.players('?limit=100') });
  // Squads are whatever the admin has created, so a new one shows up here
  // without a code change or a restart.
  const squads = useMemo(() => {
    const counts = new Map<string, Player[]>();
    for (const player of players.data?.items ?? []) {
      const bucket = counts.get(player.team_id);
      if (bucket) bucket.push(player); else counts.set(player.team_id, [player]);
    }
    return (teams.data?.items ?? [])
      .filter((team) => team.is_aimz)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((team) => ({ team, players: counts.get(team.id) ?? [] }));
  }, [players.data, teams.data]);
  return { squads, isLoading: teams.isLoading || players.isLoading, isError: teams.isError || players.isError, error: (teams.error ?? players.error) as ApiError | null, refetch: () => { teams.refetch(); players.refetch(); } };
}

function TeamsSection() {
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const roster = useRoster();

  if (roster.isLoading) return <LoadingState label="Loading squads" />;
  if (roster.isError) return <ErrorState message={roster.error?.message ?? 'Could not load squads.'} onRetry={roster.refetch} />;
  if (!roster.squads.length) return <EmptyState body="Squads added in Manage appear here automatically." title="No squads yet" />;

  const open = roster.squads.find((squad) => squad.team.id === openTeam);
  if (!open) {
    return <FlatList contentContainerStyle={styles.listContent} data={roster.squads} keyExtractor={(squad) => squad.team.id} renderItem={({ item }) => {
      const count = item.players.length;
      return <Pressable accessibilityLabel={`${item.team.name}, ${count} ${count === 1 ? 'player' : 'players'}`} accessibilityRole="button" onPress={() => setOpenTeam(item.team.id)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <TeamAvatar logoUrl={item.team.logo_url} name={item.team.age_group ?? item.team.name} size={48} />
        <View style={styles.copy}><Text style={styles.name}>{item.team.name}</Text><Text style={styles.position}>{item.team.age_group ? `${item.team.age_group} · ` : ''}{count} {count === 1 ? 'player' : 'players'}</Text></View>
        <Chevron />
      </Pressable>;
    }} showsVerticalScrollIndicator={false} style={styles.list} />;
  }

  return <View style={styles.stack}>
    <Pressable accessibilityLabel="Back to all teams" accessibilityRole="button" onPress={() => setOpenTeam(null)} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Ionicons accessibilityElementsHidden color={theme.colors.lightBlue} name="chevron-back" size={20} />
      <Text style={styles.backText}>All teams</Text>
    </Pressable>
    <Text accessibilityRole="header" style={styles.squadTitle}>{open.team.name}</Text>
    {open.players.length ? <FlatList contentContainerStyle={styles.listContent} data={open.players} keyExtractor={(player) => player.id} renderItem={({ item }) => <PlayerRow player={item} spoken={`${item.position}, number ${item.jersey_number ?? 'not assigned'}`} subtitle={item.position} />} showsVerticalScrollIndicator={false} style={styles.list} /> : <EmptyState body={copy.emptySquad(open.team.name)} title={`No ${open.team.name} players yet`} />}
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
