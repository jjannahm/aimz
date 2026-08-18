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

type Filter =
  | { key: string; label: string; ageGroup: string; metric?: undefined }
  | { key: string; label: string; metric: LeaderMetric; ageGroup?: undefined };

const squadFilter = (ageGroup: string): Filter => ({ key: ageGroup, label: ageGroup, ageGroup });

const DEFAULT_FILTER = squadFilter(AGE_GROUPS[0]);

const FILTERS: Filter[] = [
  ...AGE_GROUPS.map(squadFilter),
  { key: 'top-scorers', label: copy.topScorers, metric: 'goals' },
  { key: 'top-assisters', label: copy.topAssisters, metric: 'assists' },
];

function PlayerRow({ player, subtitle, trailing }: { player: Player; subtitle: string; trailing?: ReactNode }) {
  return <Pressable accessibilityLabel={`${player.name}, ${subtitle}`} accessibilityRole="button" onPress={() => router.push(`/player/${player.id}`)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    {player.photo_url ? <Image accessibilityElementsHidden source={{ uri: player.photo_url }} style={styles.photo} /> : <View accessibilityElementsHidden style={styles.number}><Text style={styles.numberText}>{player.jersey_number ?? '–'}</Text></View>}
    <View style={styles.copy}><Text style={styles.name}>{player.name}</Text><Text style={styles.position}>{subtitle}</Text></View>
    {trailing}
    <Ionicons accessibilityElementsHidden color={theme.colors.textMuted} name="chevron-forward" size={20} />
  </Pressable>;
}

function SquadList({ ageGroup }: { ageGroup: string }) {
  const teams = useQuery({ queryKey: ['teams', 'roster'], queryFn: () => api.teams('?limit=100') });
  const players = useQuery({ queryKey: ['players', 'roster'], queryFn: () => api.players('?limit=100') });
  const squadPlayers = useMemo(() => {
    const teamIds = new Set((teams.data?.items ?? []).filter((team) => team.age_group === ageGroup).map((team) => team.id));
    return (players.data?.items ?? []).filter((player) => teamIds.has(player.team_id));
  }, [ageGroup, players.data, teams.data]);

  if (teams.isLoading || players.isLoading) return <LoadingState label={`Loading ${ageGroup} squad`} />;
  if (teams.isError || players.isError) {
    return <ErrorState message={((teams.error ?? players.error) as ApiError).message} onRetry={() => { teams.refetch(); players.refetch(); }} />;
  }
  if (!squadPlayers.length) return <EmptyState body={copy.emptySquad(ageGroup)} title={`No ${ageGroup} players yet`} />;
  return <FlatList contentContainerStyle={styles.listContent} data={squadPlayers} keyExtractor={(player) => player.id} renderItem={({ item }) => <PlayerRow player={item} subtitle={`${item.position}, number ${item.jersey_number ?? 'not assigned'}`} />} showsVerticalScrollIndicator={false} style={styles.list} />;
}

function LeaderList({ metric }: { metric: LeaderMetric }) {
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
  const [selected, setSelected] = useState<string>(DEFAULT_FILTER.key);
  const filter = FILTERS.find((item) => item.key === selected) ?? DEFAULT_FILTER;

  return <Screen eyebrow="Academy roster" scroll={false} title="Players">
    <ScrollView contentContainerStyle={styles.chips} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar}>
      {FILTERS.map((item) => {
        const active = item.key === filter.key;
        return <Pressable accessibilityLabel={item.label} accessibilityRole="tab" accessibilityState={{ selected: active }} key={item.key} onPress={() => setSelected(item.key)} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}>
          {item.metric ? <Ionicons accessibilityElementsHidden color={active ? theme.colors.onAccent : theme.colors.textSecondary} name={item.metric === 'goals' ? 'football-outline' : 'share-social-outline'} size={16} /> : null}
          <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
        </Pressable>;
      })}
    </ScrollView>
    {filter.metric ? <LeaderList metric={filter.metric} /> : <SquadList ageGroup={filter.ageGroup} />}
  </Screen>;
}

const styles = StyleSheet.create({ chipBar: { flexGrow: 0 }, chips: { gap: theme.spacing.sm }, chip: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md }, chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }, chipText: { color: theme.colors.textSecondary, fontWeight: '700' }, chipTextActive: { color: theme.colors.onAccent, fontWeight: '900' }, list: { borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, flex: 1, overflow: 'hidden' }, listContent: { paddingBottom: theme.spacing.xl }, row: { alignItems: 'center', backgroundColor: theme.colors.surface, borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 72, padding: theme.spacing.md }, leaderRow: { alignItems: 'center', backgroundColor: theme.colors.surface, flexDirection: 'row' }, leaderPlayer: { flex: 1 }, rank: { color: theme.colors.textMuted, fontVariant: ['tabular-nums'], fontWeight: '800', paddingLeft: theme.spacing.md, textAlign: 'center', width: 34 }, tally: { color: theme.colors.lightBlue, fontSize: theme.type.heading, fontVariant: ['tabular-nums'], fontWeight: '900' }, pressed: { opacity: 0.7 }, number: { alignItems: 'center', backgroundColor: theme.colors.surfaceRaised, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, photo: { borderRadius: 24, height: 48, width: 48 }, numberText: { color: theme.colors.lightBlue, fontSize: theme.type.heading, fontWeight: '900' }, copy: { flex: 1 }, name: { color: theme.colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' }, position: { color: theme.colors.textMuted, marginTop: 3 } });
