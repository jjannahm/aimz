import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CloseButton } from '@/src/components/CloseButton';
import { FormStrip } from '@/src/components/FormStrip';
import { Screen } from '@/src/components/Screen';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import { oneDecimal, ordinal, percent, playedMatches, summarise, upcomingMatches, type PlayedMatch } from '@/src/lib/teamRecord';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Match, StandingRow, Team } from '@/src/types/api';

const FIXTURE_VIEWS = [{ label: 'All', value: 'all' }, { label: 'Results', value: 'results' }, { label: 'Upcoming', value: 'upcoming' }] as const;

/** A labelled figure. The profile is mostly these, so they are one shape. */
function Stat({ label, value }: { label: string; value: string | number }) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>;
}

/** One played match, from this team's side, opening the match when tapped. */
function ResultRow({ entry }: { entry: PlayedMatch }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const tint = { W: colors.live, D: colors.textMuted, L: colors.error }[entry.result];
  const said = { W: 'Won', D: 'Drew', L: 'Lost' }[entry.result];
  return <Pressable
    accessibilityHint="Opens the match"
    accessibilityLabel={`${said} ${entry.scored} ${entry.conceded} against ${entry.opponent?.name ?? 'an opponent'}`}
    accessibilityRole="button"
    onPress={() => router.push({ pathname: '/match/[id]', params: { id: entry.match.id } })}
    style={({ pressed, hovered }) => [styles.match, hovered && styles.hovered, pressed && styles.pressed]}
  >
    <View style={[styles.resultFlag, { backgroundColor: tint }]}><Text style={styles.resultLetter}>{entry.result}</Text></View>
    <TeamAvatar badgeStyle={entry.opponent?.badge_style} isAimz={Boolean(entry.opponent?.is_aimz)} logoUrl={entry.opponent?.logo_url ?? null} name={entry.opponent?.name ?? '?'} size={28} />
    <View style={styles.matchCopy}>
      <Text numberOfLines={1} style={styles.matchTitle}>{entry.home ? 'vs' : 'away to'} {entry.opponent?.name ?? 'Opponent'}</Text>
      <Text numberOfLines={1} style={styles.matchMeta}>{formatEgyptDateTime(entry.match.kickoff_datetime)}{entry.match.competition ? ` · ${entry.match.competition.name}` : ''}</Text>
    </View>
    <Text style={styles.score}>{entry.scored}–{entry.conceded}</Text>
  </Pressable>;
}

function FixtureRow({ match, teamId }: { match: Match; teamId: string }) {
  const styles = useThemedStyles(stylesheet);
  const home = match.home_team_id === teamId;
  const opponent = home ? match.away_team : match.home_team;
  return <View style={styles.match}>
    <View style={styles.fixtureFlag}><Text style={styles.fixtureLetter}>vs</Text></View>
    <TeamAvatar badgeStyle={opponent?.badge_style} isAimz={Boolean(opponent?.is_aimz)} logoUrl={opponent?.logo_url ?? null} name={opponent?.name ?? '?'} size={28} />
    <View style={styles.matchCopy}>
      <Text numberOfLines={1} style={styles.matchTitle}>{home ? 'vs' : 'away to'} {opponent?.name ?? 'Opponent'}</Text>
      <Text numberOfLines={1} style={styles.matchMeta}>{formatEgyptDateTime(match.kickoff_datetime)}{match.venue ? ` · ${match.venue}` : ''}</Text>
    </View>
  </View>;
}

/** The squad, with each player's season totals beside their shirt. */
function Squad({ teamId }: { teamId: string }) {
  const styles = useThemedStyles(stylesheet);
  const players = useQuery({ queryKey: [...cacheKeys.players, 'team', teamId], queryFn: () => api.players(`?team_id=${encodeURIComponent(teamId)}&limit=100`) });
  const stats = useQuery({ queryKey: ['squad-stats', teamId], queryFn: () => api.squadStats(teamId) });
  if (players.isLoading) return <LoadingState label="Loading squad" />;
  if (players.isError) return <ErrorState message={(players.error as ApiError).message} onRetry={() => players.refetch()} />;
  const roster = players.data?.items ?? [];
  if (!roster.length) return <Text style={styles.empty}>No players are on this squad yet.</Text>;
  const byPlayer = new Map(stats.data?.map((row) => [row.player_id, row]));
  return <View style={styles.card}>
    {roster.map((player, index) => {
      const record = byPlayer.get(player.id);
      return <Pressable
        accessibilityLabel={`${player.name}, ${player.position}`}
        accessibilityRole="button"
        key={player.id}
        onPress={() => router.push({ pathname: '/player/[id]', params: { id: player.id } })}
        style={({ pressed, hovered }) => [styles.player, Boolean(index) && styles.divided, hovered && styles.hovered, pressed && styles.pressed]}
      >
        <Text style={styles.shirt}>{player.jersey_number ?? '–'}</Text>
        <View style={styles.matchCopy}>
          <Text numberOfLines={1} style={styles.matchTitle}>{player.name}</Text>
          <Text numberOfLines={1} style={styles.matchMeta}>{player.position}</Text>
        </View>
        {/* A dash until the totals arrive, rather than a nought that would read
          * as a record of having played and done nothing. */}
        <Text style={styles.playerStat}>{record ? record.appearances : '–'}<Text style={styles.playerStatKey}> app</Text></Text>
        <Text style={styles.playerStat}>{record ? record.goals : '–'}<Text style={styles.playerStatKey}> g</Text></Text>
        <Text style={styles.playerStat}>{record ? record.assists : '–'}<Text style={styles.playerStatKey}> a</Text></Text>
      </Pressable>;
    })}
  </View>;
}

/** Where this squad finished in seasons before this one. */
function History({ team, teams }: { team: Team; teams: Team[] }) {
  const styles = useThemedStyles(stylesheet);
  // The same squad in an earlier season is a separate row carrying the same
  // name. Nothing is inferred beyond that: with one season on record this is
  // empty, and it fills in on its own once a second has been played.
  const past = teams.filter((item) => item.name === team.name && item.season !== team.season && item.competition_id);
  if (!past.length) return <Text style={styles.empty}>No earlier seasons are on record yet. Finishes appear here once this squad has played more than one.</Text>;
  return <View style={styles.card}>{past.map((item, index) => <PastSeason index={index} key={item.id} team={item} />)}</View>;
}

function PastSeason({ team, index }: { team: Team; index: number }) {
  const styles = useThemedStyles(stylesheet);
  const table = useQuery({ queryKey: ['standings', team.competition_id], queryFn: () => api.standings(team.competition_id!), enabled: Boolean(team.competition_id) });
  const row = table.data?.find((entry) => entry.team.id === team.id);
  return <View style={[styles.player, Boolean(index) && styles.divided]}>
    <View style={styles.matchCopy}><Text style={styles.matchTitle}>{team.season}</Text></View>
    <Text style={styles.score}>{row ? `${row.rank}${ordinal(row.rank)}` : '—'}</Text>
  </View>;
}

/** This team against one other, chosen here. */
function HeadToHeadSection({ team, table }: { team: Team; table: StandingRow[] }) {
  const styles = useThemedStyles(stylesheet);
  const [opponentId, setOpponentId] = useState<string | null>(null);
  const others = table.map((row) => row.team).filter((item) => item.id !== team.id);
  const record = useQuery({ queryKey: ['head-to-head', team.id, opponentId], queryFn: () => api.headToHead(team.id, opponentId!), enabled: Boolean(opponentId) });
  if (!others.length) return <Text style={styles.empty}>There is nobody else in this competition yet.</Text>;
  return <>
    <ScrollView contentContainerStyle={styles.chips} horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar}>
      {others.map((other) => <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: opponentId === other.id }}
        key={other.id}
        onPress={() => setOpponentId(opponentId === other.id ? null : other.id)}
        style={({ pressed }) => [styles.chip, opponentId === other.id && styles.chipOn, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={[styles.chipText, opponentId === other.id && styles.chipTextOn]}>{other.name}</Text>
      </Pressable>)}
    </ScrollView>
    {!opponentId ? <Text style={styles.empty}>Pick a team to see how the two have met.</Text>
      : record.isLoading ? <LoadingState label="Loading record" />
      : record.isError ? <ErrorState message={(record.error as ApiError).message} onRetry={() => record.refetch()} />
      : !record.data?.played ? <Text style={styles.empty}>These two have not met in a finished match yet.</Text>
      : <View style={styles.card}>
        <View style={styles.statRow}>
          <Stat label="Played" value={record.data.played} />
          <Stat label="Wins" value={record.data.won} />
          <Stat label="Draws" value={record.data.drawn} />
          <Stat label="Defeats" value={record.data.lost} />
        </View>
        <View style={styles.statRow}>
          <Stat label="Goals for" value={record.data.goals_for} />
          <Stat label="Goals against" value={record.data.goals_against} />
        </View>
        {record.data.meetings.slice(0, 5).map((meeting) => <Pressable
          accessibilityLabel={`${meeting.home_team?.name} ${meeting.home_score} ${meeting.away_score} ${meeting.away_team?.name}`}
          accessibilityRole="button"
          key={meeting.match_id}
          onPress={() => router.push({ pathname: '/match/[id]', params: { id: meeting.match_id } })}
          style={({ pressed, hovered }) => [styles.player, styles.divided, hovered && styles.hovered, pressed && styles.pressed]}
        >
          <View style={styles.matchCopy}>
            <Text numberOfLines={1} style={styles.matchTitle}>{meeting.home_team?.name} {meeting.home_score}–{meeting.away_score} {meeting.away_team?.name}</Text>
            <Text style={styles.matchMeta}>{formatEgyptDateTime(meeting.kickoff_datetime)}</Text>
          </View>
        </Pressable>)}
      </View>}
  </>;
}

export default function TeamProfileScreen() {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [view, setView] = useState<'all' | 'results' | 'upcoming'>('all');
  const teams = useQuery({ queryKey: cacheKeys.teams, queryFn: () => api.teams('?limit=200') });
  const team = teams.data?.items.find((item) => item.id === id);
  const table = useQuery({ queryKey: ['standings', team?.competition_id], queryFn: () => api.standings(team!.competition_id!), enabled: Boolean(team?.competition_id) });
  const matches = useQuery({ queryKey: ['matches', 'team', id], queryFn: () => api.matches(`?team_id=${encodeURIComponent(id!)}&limit=100`), enabled: Boolean(id) });

  const row = table.data?.find((entry) => entry.team.id === id);
  const played = useMemo(() => playedMatches(matches.data?.items ?? [], id ?? ''), [matches.data, id]);
  const upcoming = useMemo(() => upcomingMatches(matches.data?.items ?? []), [matches.data]);
  const record = summarise(row, played);
  const last5 = played.slice(0, 5);
  const league = matches.data?.items.find((match) => match.competition)?.competition?.name;

  if (teams.isLoading) return <Screen action={<CloseButton />} title="Team"><LoadingState label="Loading team" /></Screen>;
  if (!team) return <Screen action={<CloseButton />} title="Team"><EmptyState body="This team is no longer on the roster." title="Team not found" /></Screen>;

  return <Screen action={<CloseButton />} title={team.name}>
    <View style={styles.hero}>
      <TeamAvatar badgeStyle={team.badge_style} isAimz={team.is_aimz} logoUrl={team.logo_url} name={team.name} size={64} />
      <View style={styles.heroCopy}>
        <Text style={styles.heroName}>{team.name}</Text>
        <Text style={styles.heroMeta}>{[team.age_group, league === team.age_group ? null : league, row ? `${row.rank}${ordinal(row.rank)}` : null].filter(Boolean).join(' · ')}</Text>
        {record?.form.length ? <View style={styles.heroForm}><FormStrip form={record.form} /></View> : null}
      </View>
    </View>

    {!record ? <EmptyState body="A table appears once this squad has played a finished match." title="No record yet" /> : <>
      <Section title="Overview">
        <View style={styles.card}>
          <View style={styles.statRow}>
            <Stat label="Played" value={record.played} />
            <Stat label="Won" value={record.won} />
            <Stat label="Drawn" value={record.drawn} />
            <Stat label="Lost" value={record.lost} />
          </View>
          <View style={styles.statRow}>
            <Stat label="Scored" value={record.goalsFor} />
            <Stat label="Conceded" value={record.goalsAgainst} />
            <Stat label="Difference" value={`${record.goalDifference > 0 ? '+' : ''}${record.goalDifference}`} />
            <Stat label="Points" value={record.points} />
          </View>
        </View>
      </Section>

      {last5.length ? <Section title="Recent form">
        <View style={styles.card}>
          <View style={styles.formLarge}><FormStrip form={last5.map((entry) => entry.result)} size="large" /></View>
          <Text style={styles.formSummary}>Last {last5.length} {last5.length === 1 ? 'match' : 'matches'}: {last5.filter((entry) => entry.result === 'W').length} won · {last5.filter((entry) => entry.result === 'D').length} drawn · {last5.filter((entry) => entry.result === 'L').length} lost</Text>
          <Text style={styles.formSummary}>Scored {last5.reduce((sum, entry) => sum + entry.scored, 0)} · conceded {last5.reduce((sum, entry) => sum + entry.conceded, 0)}</Text>
        </View>
      </Section> : null}

      <Section title="Statistics">
        <View style={styles.card}>
          <View style={styles.statRow}>
            <Stat label="Win rate" value={percent(record.winRate)} />
            <Stat label="Points per game" value={oneDecimal(record.pointsPerGame)} />
            <Stat label="Clean sheets" value={record.cleanSheets} />
          </View>
          <View style={styles.statRow}>
            <Stat label="Scored per game" value={oneDecimal(record.averageScored)} />
            <Stat label="Conceded per game" value={oneDecimal(record.averageConceded)} />
            {record.streak ? <Stat label="Current streak" value={`${record.streak.count} ${({ W: 'won', D: 'drawn', L: 'lost' })[record.streak.result]}`} /> : null}
          </View>
        </View>
      </Section>
    </>}

    <Section title="Matches">
      <SegmentedControl label="Which matches to show" onChange={setView} options={FIXTURE_VIEWS} value={view} />
      {matches.isLoading ? <LoadingState label="Loading matches" />
        : matches.isError ? <ErrorState message={(matches.error as ApiError).message} onRetry={() => matches.refetch()} />
        : <View style={styles.matches}>
          {view !== 'upcoming' ? played.map((entry) => <ResultRow entry={entry} key={entry.match.id} />) : null}
          {view !== 'results' ? upcoming.map((match) => <FixtureRow key={match.id} match={match} teamId={id!} />) : null}
          {(view === 'results' ? played.length : view === 'upcoming' ? upcoming.length : played.length + upcoming.length) === 0 ? <Text style={styles.empty}>Nothing to show here yet.</Text> : null}
        </View>}
    </Section>

    <Section title="Squad"><Squad teamId={id!} /></Section>
    <Section title="Head to head"><HeadToHeadSection table={table.data ?? []} team={team} /></Section>
    <Section title="History"><History team={team} teams={teams.data?.items ?? []} /></Section>
    <View style={styles.footer}><Ionicons accessibilityElementsHidden color={colors.textMuted} name="information-circle-outline" size={14} /><Text style={styles.footerText}>Figures come from finished matches only.</Text></View>
  </Screen>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  hero: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.md },
  heroCopy: { flex: 1, gap: 4 },
  heroName: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  heroMeta: { color: colors.textMuted },
  heroForm: { flexDirection: 'row', marginTop: 2 },

  section: { gap: theme.spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.md },
  // Wraps rather than scrolls: four to a row at phone width, fewer where the
  // figures are wide, and never a column that has to be dragged sideways.
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.md },
  // 56 plus three 16-point gaps is 272, which fits four across the card at
  // phone width; they then grow to share what is left.
  stat: { flexBasis: 56, flexGrow: 1, gap: 2 },
  statValue: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.heading },
  statLabel: { color: colors.textMuted, fontSize: theme.type.caption },

  formLarge: { flexDirection: 'row' },
  formSummary: { color: colors.textSecondary, lineHeight: 20 },

  matches: { gap: theme.spacing.sm },
  match: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.size.listRow, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  matchCopy: { flex: 1, gap: 2 },
  matchTitle: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  matchMeta: { color: colors.textMuted, fontSize: theme.type.caption },
  score: { color: colors.textPrimary, fontFamily: theme.font.monoBold },
  resultFlag: { alignItems: 'center', borderRadius: 4, height: 20, justifyContent: 'center', width: 20 },
  resultLetter: { color: colors.background, fontFamily: theme.font.bold, fontSize: 11 },
  fixtureFlag: { alignItems: 'center', borderColor: colors.border, borderRadius: 4, borderWidth: 1, height: 20, justifyContent: 'center', width: 20 },
  fixtureLetter: { color: colors.textMuted, fontFamily: theme.font.bold, fontSize: 9 },

  player: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum, paddingVertical: theme.spacing.xs },
  divided: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  shirt: { color: colors.textMuted, fontFamily: theme.font.monoBold, textAlign: 'center', width: 24 },
  playerStat: { color: colors.textPrimary, fontFamily: theme.font.monoBold, fontSize: theme.type.caption, minWidth: 34, textAlign: 'right' },
  playerStatKey: { color: colors.textMuted, fontFamily: theme.font.regular },

  chipBar: { flexGrow: 0 },
  chips: { gap: theme.spacing.sm },
  chip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, justifyContent: 'center', maxWidth: 180, minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textSecondary, fontFamily: theme.font.semibold },
  chipTextOn: { color: colors.onAccent, fontFamily: theme.font.bold },

  empty: { color: colors.textMuted, lineHeight: 21 },
  footer: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  footerText: { color: colors.textMuted, fontSize: theme.type.caption },
  hovered: { backgroundColor: colors.surfaceRaised },
  pressed: { opacity: 0.7 },
});
