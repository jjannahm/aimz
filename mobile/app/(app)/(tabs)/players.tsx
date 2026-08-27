import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { Screen } from '@/src/components/Screen';
import { JerseyIcon } from '@/src/components/JerseyIcon';
import { PlayerStatsPanel } from '@/src/components/PlayerStatsPanel';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { mediaUrl } from '@/src/lib/mediaUrl';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AwardRank, Player, PlayerAward } from '@/src/types/api';

type Section = { key: string; label: string };

const SECTIONS: Section[] = [
  { key: 'teams', label: copy.teams },
  { key: 'awards', label: copy.awards },
];

/** The academy-wide sections, plus the signed-in player's own stats. */
const sectionsFor = (playerId: string | null | undefined): Section[] =>
  playerId ? [...SECTIONS, { key: 'mine', label: copy.myStats }] : SECTIONS;

function Chevron() {
  const colors = useColors();
  return <Ionicons accessibilityElementsHidden color={colors.textMuted} name="chevron-forward" size={20} />;
}

function PlayerRow({ player, subtitle, spoken, trailing, last }: { player: Player; subtitle: string; spoken?: string; trailing?: ReactNode; last?: boolean }) {
  const styles = useThemedStyles(stylesheet);
  return <Pressable accessibilityLabel={`${player.name}, ${spoken ?? subtitle}`} accessibilityRole="button" onPress={() => router.push(`/player/${player.id}`)} style={({ pressed }) => [styles.row, last && styles.lastRow, pressed && styles.pressed]}>
    {player.photo_url ? <Image accessibilityElementsHidden source={{ uri: mediaUrl(player.photo_url) }} style={styles.photo} /> : <JerseyIcon number={player.jersey_number} size={48} />}
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
      .filter((team) => team.is_aimz && team.is_active)
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
        <TeamAvatar badgeStyle={item.team.badge_style} isAimz={item.team.is_aimz} logoUrl={item.team.logo_url} name={item.team.name} size={48} />
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

/** Every award unit is a regular plural, so one of anything just drops the s. */
function amount(value: number, unit: string) {
  return `${value} ${value === 1 ? unit.replace(/s$/, '') : unit}`;
}

/** "5 goals in 4 appearances" reads well; "3 appearances in 3 appearances" does not. */
function record(row: AwardRank) {
  return row.unit === 'appearances' ? amount(row.value, row.unit) : `${amount(row.value, row.unit)} in ${amount(row.appearances, 'appearances')}`;
}

/** The full ranking behind an award, fetched only once the row opens. */
function AwardRanking({ award, competitionId }: { award: PlayerAward; competitionId: string }) {
  const styles = useThemedStyles(stylesheet);
  const name = award.label.toLowerCase();
  const ranking = useQuery({ queryKey: ['award-ranking', competitionId, award.metric], queryFn: () => api.awardRanking(competitionId, award.metric) });

  if (ranking.isLoading) return <LoadingState label={`Loading the ${name} ranking`} />;
  if (ranking.isError) return <ErrorState message={(ranking.error as ApiError).message} onRetry={() => ranking.refetch()} />;
  if (!ranking.data?.length) return <EmptyState body={copy.emptyLeaders} title={`No ${name} ranking yet`} />;
  return <View style={styles.list}>{ranking.data.map((item: AwardRank, index: number) => <View key={item.player.id} style={styles.leaderRow}>
    <Text accessibilityElementsHidden style={styles.rank}>{item.rank}</Text>
    <View style={styles.leaderPlayer}><PlayerRow last={index === ranking.data.length - 1} player={item.player} subtitle={`${item.team.name}, ${record(item)}`} trailing={<Text accessibilityElementsHidden style={styles.tally}>{item.value}</Text>} /></View>
  </View>)}</View>;
}

/** One award, opening to reveal everybody it was won against. */
function AwardRow({ award, competitionId }: { award: PlayerAward; competitionId: string }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.awardOpen}>
    <Pressable
      accessibilityLabel={`${expanded ? 'Hide' : 'Show'} the full ${award.label.toLowerCase()} ranking`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => setExpanded((current) => !current)}
      style={({ pressed }) => [styles.award, pressed && styles.pressed]}
    >
      <Ionicons accessibilityElementsHidden color={colors.leaderAccent} name="trophy" size={20} />
      <View style={styles.copy}><Text style={styles.awardLabel}>{award.label}</Text><Text style={styles.name}>{award.player.name}</Text><Text style={styles.position}>{award.team.name}</Text></View>
      <Text accessibilityElementsHidden style={styles.tally}>{award.value}</Text>
      <Ionicons accessibilityElementsHidden color={colors.textMuted} name={expanded ? 'chevron-up' : 'chevron-down'} size={18} />
    </Pressable>
    {expanded ? <AwardRanking award={award} competitionId={competitionId} /> : null}
  </View>;
}

function AwardsSection() {
  const styles = useThemedStyles(stylesheet);
  const competitions = useQuery({ queryKey: ['competitions'], queryFn: () => api.competitions('?limit=100') });
  const eligible = useMemo(() => competitions.data?.items.filter((item) => item.type !== 'friendly') ?? [], [competitions.data]);
  const [chosen, setChosen] = useState<string | null>(null);
  const competition = eligible.find((item) => item.id === chosen) ?? eligible[0];
  const awards = useQuery({ queryKey: ['awards', competition?.id], queryFn: () => api.awards(competition!.id), enabled: Boolean(competition) });

  if (competitions.isLoading) return <LoadingState label="Loading competitions" />;
  if (!eligible.length) return <EmptyState body={copy.emptyAwards} title="No competitions yet" />;
  if (awards.isError) return <ErrorState message={(awards.error as ApiError).message} onRetry={() => awards.refetch()} />;
  const rows = awards.data?.player_awards ?? [];
  return <View style={styles.awardList}>
    {eligible.length > 1 ? <ScrollView contentContainerStyle={styles.chips} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar}>
      {eligible.map((item) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: competition?.id === item.id }} key={item.id} onPress={() => setChosen(item.id)} style={({ pressed }) => [styles.chip, competition?.id === item.id && styles.chipActive, pressed && styles.pressed]}>
        <Text style={[styles.chipText, competition?.id === item.id && styles.chipTextActive]}>{item.name}</Text>
      </Pressable>)}
    </ScrollView> : null}
    {awards.isLoading ? <LoadingState label="Loading awards" /> : rows.length === 0 ? <EmptyState body={copy.emptyAwards} title="No awards yet" /> : rows.map((award: PlayerAward) => <AwardRow award={award} competitionId={competition!.id} key={award.label} />)}
  </View>;
}

export default function PlayersScreen() {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const [selected, setSelected] = useState<string>('teams');
  // An account with no roster record behind it has no stats of its own to show,
  // which is every administrator and any player not linked yet.
  const sections = useMemo(() => sectionsFor(user?.player_id), [user?.player_id]);
  const section = sections.find((item) => item.key === selected) ?? sections[0]!;

  return <Screen title="Players">
    <ScrollView contentContainerStyle={styles.chips} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar}>
      {sections.map((item) => {
        const active = item.key === section.key;
        return <Pressable accessibilityLabel={item.label} accessibilityRole="tab" accessibilityState={{ selected: active }} key={item.key} onPress={() => setSelected(item.key)} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}>
          <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
        </Pressable>;
      })}
    </ScrollView>
    {section.key === 'mine' && user?.player_id ? <PlayerStatsPanel playerId={user.player_id} /> : section.key === 'awards' ? <AwardsSection /> : <TeamsSection />}
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ chipBar: { flexGrow: 0 }, chips: { gap: theme.spacing.sm }, chip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md }, chipActive: { backgroundColor: colors.accent, borderColor: colors.accent }, chipText: { color: colors.textSecondary, fontWeight: '700' }, chipTextActive: { color: colors.onAccent, fontWeight: '900' }, stack: { gap: theme.spacing.md }, back: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: theme.spacing.xs, minHeight: theme.touch.minimum, paddingRight: theme.spacing.md }, backText: { color: colors.accentSoft, fontWeight: '800' }, squadTitle: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, list: { borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, overflow: 'hidden' }, row: { alignItems: 'center', backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 72, padding: theme.spacing.md }, lastRow: { borderBottomWidth: 0 }, leaderRow: { alignItems: 'center', backgroundColor: colors.surface, flexDirection: 'row' }, leaderPlayer: { flex: 1 }, rank: { color: colors.textMuted, fontVariant: ['tabular-nums'], fontWeight: '800', paddingLeft: theme.spacing.md, textAlign: 'center', width: 34 }, tally: { color: colors.accentSoft, fontSize: theme.type.heading, fontVariant: ['tabular-nums'], fontWeight: '900' }, awardList: { gap: theme.spacing.sm }, awardOpen: { gap: theme.spacing.sm }, award: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.md }, awardLabel: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }, pressed: { opacity: 0.7 }, badge: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, badgeText: { color: colors.accentSoft, fontSize: theme.type.label, fontWeight: '900' }, number: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, photo: { borderRadius: 24, height: 48, width: 48 }, numberText: { color: colors.accentSoft, fontSize: theme.type.heading, fontWeight: '900' }, copy: { flex: 1 }, name: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' }, position: { color: colors.textMuted, marginTop: 3 } });
