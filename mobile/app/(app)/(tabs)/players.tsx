import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { useMyChildren } from '@/src/auth/useMyTeam';
import { FlatCard } from '@/src/components/FlatCard';
import { Screen } from '@/src/components/Screen';
import { SegmentedControl, type SegmentedOption } from '@/src/components/SegmentedControl';
import { JerseyIcon } from '@/src/components/JerseyIcon';
import { PlayerStatsPanel } from '@/src/components/PlayerStatsPanel';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { copy } from '@/src/i18n/en';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { mediaUrl } from '@/src/lib/mediaUrl';
import { noFocusRing, theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { AwardRank, Player, PlayerAward } from '@/src/types/api';

type Section = SegmentedOption<string>;

const SECTIONS: Section[] = [
  { value: 'teams', label: copy.teams },
  { value: 'awards', label: copy.awards },
];

/** The academy-wide sections, plus the reader's own stats when they have any. */
const sectionsFor = (linked: boolean): Section[] =>
  linked ? [...SECTIONS, { value: 'mine', label: copy.myStats }] : SECTIONS;

/**
 * A parent's children, one tab each, so each child's stats are read on their
 * own. A player has only themselves here and is shown the panel directly.
 */
function MyStatsSection() {
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const { children, isLoading, isError, refetch } = useMyChildren();
  const [childId, setChildId] = useState<string | null>(null);
  if (user?.role !== 'parent') {
    return user?.player_id
      // Behind the panel, so its glass has something to look through: a flat
      // page leaves translucency nothing to show and the cards read as fills.
      ? <PlayerStatsPanel playerId={user.player_id} />
      : <EmptyState body={copy.accountNotLinked} title="Account not linked" />;
  }
  if (isLoading) return <LoadingState label="Loading your children" />;
  if (isError) return <ErrorState message="Your children could not be loaded." onRetry={refetch} />;
  if (!children.length) return <EmptyState body={copy.accountNotLinked} title="Account not linked" />;
  const selected = children.find((child) => child.id === childId) ?? children[0]!;
  return <View style={styles.stack}>
    {children.length > 1 ? <ScrollView contentContainerStyle={styles.chips} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar}>
      {children.map((child) => {
        const active = child.id === selected.id;
        return <Pressable accessibilityLabel={child.name} accessibilityRole="tab" accessibilityState={{ selected: active }} key={child.id} onPress={() => setChildId(child.id)} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}>
          <Text style={[styles.chipText, active && styles.chipTextActive]}>{child.name}</Text>
        </Pressable>;
      })}
    </ScrollView> : null}
    <PlayerStatsPanel playerId={selected.id} />
  </View>;
}

function Chevron() {
  const colors = useColors();
  return <Ionicons accessibilityElementsHidden color={colors.textMuted} name="chevron-forward" size={20} />;
}

function PlayerRow({ player, subtitle, spoken, trailing, last }: { player: Player; subtitle: string; spoken?: string; trailing?: ReactNode; last?: boolean }) {
  const styles = useThemedStyles(stylesheet);
  return <Pressable accessibilityLabel={`${player.name}, ${spoken ?? subtitle}`} accessibilityRole="button" onPress={() => router.push(`/player/${player.id}`)} style={({ pressed }) => [styles.row, last && styles.lastRow, pressed && styles.pressed]}>
    {player.photo_url ? <Image accessibilityElementsHidden source={{ uri: mediaUrl(player.photo_url) }} style={styles.photo} /> : <JerseyIcon number={player.jersey_number} size={40} />}
    <View style={styles.copy}><Text style={styles.name}>{player.name}</Text><Text style={styles.position}>{subtitle}</Text></View>
    {trailing}
    <Chevron />
  </Pressable>;
}

function useRoster() {
  // The same keys the rest of the app reads these two lists under, so a tab
  // opened second is served from cache rather than fetching them again.
  const teams = useQuery({ queryKey: cacheKeys.teams, queryFn: () => api.teams('?limit=100') });
  const players = useQuery({ queryKey: cacheKeys.players, queryFn: () => api.players('?limit=100') });
  // Squads are whatever the admin has created, so a new one shows up here
  // without a code change or a restart.
  const squads = useMemo(() => {
    const counts = new Map<string, Player[]>();
    for (const player of players.data?.items ?? []) {
      const bucket = counts.get(player.team_id);
      if (bucket) bucket.push(player); else counts.set(player.team_id, [player]);
    }
    return (teams.data?.items ?? [])
      // The academy's own age squads. `is_aimz` alone is not the line: the
      // league's clubs carry it too, so that players, lineups and live scoring
      // work for them — what marks a squad of ours is the age group it plays.
      .filter((team) => team.is_aimz && team.is_active && team.age_group)
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
    return <FlatCard radius={theme.radius.md} style={styles.list}>{roster.squads.map((item, index) => {
      const count = item.players.length;
      return <Pressable accessibilityLabel={`${item.team.name}, ${count} ${count === 1 ? 'player' : 'players'}`} accessibilityRole="button" key={item.team.id} onPress={() => setOpenTeam(item.team.id)} style={({ pressed }) => [styles.row, index === roster.squads.length - 1 && styles.lastRow, pressed && styles.pressed]}>
        <TeamAvatar badgeStyle={item.team.badge_style} isAimz={item.team.is_aimz} logoUrl={item.team.logo_url} name={item.team.name} size={40} />
        <View style={styles.copy}><Text style={styles.name}>{item.team.name}</Text><Text style={styles.position}>{item.team.age_group ? `${item.team.age_group} · ` : ''}{count} {count === 1 ? 'player' : 'players'}</Text></View>
        <Chevron />
      </Pressable>;
    })}</FlatCard>;
  }

  return <View style={styles.stack}>
    <Pressable accessibilityLabel="Back to all teams" accessibilityRole="button" onPress={() => setOpenTeam(null)} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
      <Ionicons accessibilityElementsHidden color={colors.accentSoft} name="chevron-back" size={20} />
      <Text style={styles.backText}>All teams</Text>
    </Pressable>
    <Text accessibilityRole="header" style={styles.squadTitle}>{open.team.name}</Text>
    {open.players.length ? <FlatCard radius={theme.radius.md} style={styles.list}>{open.players.map((item, index) => <PlayerRow key={item.id} last={index === open.players.length - 1} player={item} spoken={`${item.position}, number ${item.jersey_number ?? 'not assigned'}`} subtitle={item.position} />)}</FlatCard> : <EmptyState body={copy.emptySquad(open.team.name)} title={`No ${open.team.name} players yet`} />}
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
  return <FlatCard radius={theme.radius.md} style={styles.list}>{ranking.data.map((item: AwardRank, index: number) => <View key={item.player.id} style={styles.leaderRow}>
    <Text accessibilityElementsHidden style={styles.rank}>{item.rank}</Text>
    <View style={styles.leaderPlayer}><PlayerRow last={index === ranking.data.length - 1} player={item.player} subtitle={`${item.team.name}, ${record(item)}`} trailing={<Text accessibilityElementsHidden style={styles.tally}>{item.value}</Text>} /></View>
  </View>)}</FlatCard>;
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
      style={({ pressed }) => pressed && styles.pressed}
    >
      <FlatCard radius={theme.radius.md} style={styles.award}>
      <Ionicons accessibilityElementsHidden color={colors.leaderAccent} name="trophy" size={20} />
      <View style={styles.copy}><Text style={styles.awardLabel}>{award.label}</Text><Text style={styles.name}>{award.player.name}</Text><Text style={styles.position}>{award.team.name}</Text></View>
      <Text accessibilityElementsHidden style={styles.tally}>{award.value}</Text>
      <Ionicons accessibilityElementsHidden color={colors.textMuted} name={expanded ? 'chevron-up' : 'chevron-down'} size={18} />
      </FlatCard>
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
  const { user } = useAuth();
  const [selected, setSelected] = useState<string>('teams');
  // An account with no roster record behind it has no stats of its own to show,
  // which is every administrator and any player not linked yet.
  // An administrator manages the academy rather than playing in it, so the tab
  // is not theirs even when their own login happens to be linked to a player.
  const sections = useMemo(() => sectionsFor(user?.role !== 'admin' && (user?.role === 'parent' || Boolean(user?.player_id))), [user?.role, user?.player_id]);
  const section = sections.find((item) => item.value === selected) ?? sections[0]!;

  return <Screen title="Players">
      <SegmentedControl label="Player section" onChange={setSelected} options={sections} value={section.value} />
      {section.value === 'mine' ? <MyStatsSection /> : section.value === 'awards' ? <AwardsSection /> : <TeamsSection />}
    </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({ chipBar: { flexGrow: 0 }, chips: { gap: theme.spacing.sm }, chip: { ...noFocusRing, alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md }, chipActive: { backgroundColor: colors.surfaceRaised }, chipText: { color: colors.textSecondary, fontFamily: theme.font.semibold }, chipTextActive: { color: colors.textPrimary, fontFamily: theme.font.bold }, stack: { gap: theme.spacing.md }, back: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: theme.spacing.xs, minHeight: theme.touch.minimum, paddingRight: theme.spacing.md }, backText: { color: colors.accentSoft, fontFamily: theme.font.bold }, squadTitle: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading }, list: { overflow: 'hidden', paddingHorizontal: 0 },
  row: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: theme.spacing.md, minHeight: theme.size.listRow, padding: theme.spacing.md },
  lastRow: { borderBottomWidth: 0 }, leaderRow: { alignItems: 'center', flexDirection: 'row' }, leaderPlayer: { flex: 1 }, rank: { color: colors.textMuted, fontFamily: theme.font.monoBold, fontVariant: ['tabular-nums'], paddingLeft: theme.spacing.md, textAlign: 'center', width: 34 }, tally: { color: colors.accentSoft, fontFamily: theme.font.monoBold, fontSize: theme.type.heading, fontVariant: ['tabular-nums'] }, awardList: { gap: theme.spacing.sm }, awardOpen: { gap: theme.spacing.sm }, award: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.md }, awardLabel: { color: colors.textMuted, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 0.8, textTransform: 'uppercase' }, pressed: { opacity: 0.7 }, badge: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, badgeText: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.label }, number: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, photo: { borderRadius: 20, height: 40, width: 40 }, numberText: { color: colors.accentSoft, fontFamily: theme.font.bold, fontSize: theme.type.heading }, copy: { flex: 1 }, name: { color: colors.textPrimary, fontFamily: theme.font.semibold, fontSize: theme.type.body }, position: { color: colors.textMuted, fontFamily: theme.font.regular, marginTop: 2 } });
