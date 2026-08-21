import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/src/components/Screen';
import { JerseyIcon } from '@/src/components/JerseyIcon';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { LeaderMetric, Player, PlayerLeaderRow } from '@/src/types/api';

type Section = { key: string; label: string; metric?: LeaderMetric };

const SECTIONS: Section[] = [
  { key: 'teams', label: copy.teams },
  { key: 'top-scorers', label: copy.topScorers, metric: 'goals' },
  { key: 'top-assisters', label: copy.topAssisters, metric: 'assists' },
];

function Chevron() {
  const colors = useColors();
  return <Ionicons accessibilityElementsHidden color={colors.textMuted} name="chevron-forward" size={20} />;
}

function PlayerRow({ player, subtitle, spoken, trailing, last }: { player: Player; subtitle: string; spoken?: string; trailing?: ReactNode; last?: boolean }) {
  const styles = useThemedStyles(stylesheet);
  return <Pressable accessibilityLabel={`${player.name}, ${spoken ?? subtitle}`} accessibilityRole="button" onPress={() => router.push(`/player/${player.id}`)} style={({ pressed }) => [styles.row, last && styles.lastRow, pressed && styles.pressed]}>
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
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const roster = useRoster();

  if (roster.isLoading) return <LoadingState label="Loading squads" />;
  if (roster.isError) return <ErrorState message={roster.error?.message ?? 'Could not load squads.'} onRetry={roster.refetch} />;
  if (!roster.squads.length) return <EmptyState body="Squads added in Manage appear here automatically." title="No squads yet" />;

  const open = roster.squads.find((squad) => squad.team.id === openTeam);
  if (!open) {
    return <View style={styles.list}>{roster.squads.map((item, index) => {
      const count = item.players.length;
      return <Pressable accessibilityLabel={`${item.team.name}, ${count} ${count === 1 ? 'player' : 'players'}`} accessibilityRole="button" key={item.team.id} onPress={() => setOpenTeam(item.team.id)} style={({ pressed }) => [styles.row, index === roster.squads.length - 1 && styles.lastRow, pressed && styles.pressed]}>
        <TeamAvatar logoUrl={item.team.logo_url} name={item.team.age_group ?? item.team.name} size={48} />
        <View style={styles.copy}><Text style={styles.name}>{item.team.name}</Text><Text style={styles.position}>{item.team.age_group ? `${item.team.age_group} · ` : ''}{count} {count === 1 ? 'player' : 'players'}</Text></View>
        <Chevron />
      </Pressable>;
    })}</View>;
  }

  return <View style={styles.stack}>
    <Pressable accessibilityLabel="Back to all teams" accessibilityRole="button" onPress={() => setOpenTeam(null)} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Ionicons accessibilityElementsHidden color={colors.accentSoft} name="chevron-back" size={20} />
      <Text style={styles.backText}>All teams</Text>
    </Pressable>
    <Text accessibilityRole="header" style={styles.squadTitle}>{open.team.name}</Text>
    {open.players.length ? <View style={styles.list}>{open.players.map((item, index) => <PlayerRow key={item.id} last={index === open.players.length - 1} player={item} spoken={`${item.position}, number ${item.jersey_number ?? 'not assigned'}`} subtitle={item.position} />)}</View> : <EmptyState body={copy.emptySquad(open.team.name)} title={`No ${open.team.name} players yet`} />}
  </View>;
}

function LeaderSection({ metric }: { metric: LeaderMetric }) {
  const styles = useThemedStyles(stylesheet);
  const leaders = useQuery({ queryKey: ['leaders', metric], queryFn: () => api.leaders(metric, { limit: 25 }) });
  const unit = metric === 'goals' ? 'goals' : 'assists';

  if (leaders.isLoading) return <LoadingState label={`Loading ${unit} leaders`} />;
  if (leaders.isError) return <ErrorState message={(leaders.error as ApiError).message} onRetry={() => leaders.refetch()} />;
  if (!leaders.data?.length) return <EmptyState body={copy.emptyLeaders} title={`No ${unit} recorded yet`} />;
  return <View style={styles.list}>{leaders.data.map((item: PlayerLeaderRow, index: number) => <View key={item.player.id} style={styles.leaderRow}>
    <Text accessibilityElementsHidden style={styles.rank}>{item.rank}</Text>
    <View style={styles.leaderPlayer}><PlayerRow last={index === leaders.data.length - 1} player={item.player} subtitle={`${item.team.name}, ${item[metric]} ${unit} in ${item.appearances} ${item.appearances === 1 ? 'appearance' : 'appearances'}`} trailing={<Text accessibilityElementsHidden style={styles.tally}>{item[metric]}</Text>} /></View>
  </View>)}</View>;
}

export default function PlayersScreen() {
  const styles = useThemedStyles(stylesheet);
  const [selected, setSelected] = useState<string>('teams');
  const section = SECTIONS.find((item) => item.key === selected) ?? SECTIONS[0]!;

  return <Screen eyebrow="Academy roster" title="Players">
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

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ chipBar: { flexGrow: 0 }, chips: { gap: theme.spacing.sm }, chip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md }, chipActive: { backgroundColor: colors.accent, borderColor: colors.accent }, chipText: { color: colors.textSecondary, fontWeight: '700' }, chipTextActive: { color: colors.onAccent, fontWeight: '900' }, stack: { gap: theme.spacing.md }, back: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: theme.spacing.xs, minHeight: theme.touch.minimum, paddingRight: theme.spacing.md }, backText: { color: colors.accentSoft, fontWeight: '800' }, squadTitle: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, list: { borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, overflow: 'hidden' }, row: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 72, padding: theme.spacing.md }, lastRow: { borderBottomWidth: 0 }, leaderRow: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row' }, leaderPlayer: { flex: 1 }, rank: { color: colors.textMuted, fontVariant: ['tabular-nums'], fontWeight: '800', paddingLeft: theme.spacing.md, textAlign: 'center', width: 34 }, tally: { color: colors.accentSoft, fontSize: theme.type.heading, fontVariant: ['tabular-nums'], fontWeight: '900' }, pressed: { opacity: 0.7 }, badge: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, badgeText: { color: colors.accentSoft, fontSize: theme.type.label, fontWeight: '900' }, number: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, photo: { borderRadius: 24, height: 48, width: 48 }, numberText: { color: colors.accentSoft, fontSize: theme.type.heading, fontWeight: '900' }, copy: { flex: 1 }, name: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' }, position: { color: colors.textMuted, marginTop: 3 } });
