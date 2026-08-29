import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CloseButton } from '@/src/components/CloseButton';
import { FormStrip } from '@/src/components/FormStrip';
import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { api, ApiError } from '@/src/lib/api';
import { cacheKeys } from '@/src/lib/cache';
import { formatEgyptDateTime } from '@/src/lib/egyptTime';
import type { PressState } from '@/src/lib/pressState';
import { oneDecimal, percent, playedMatches, summarise, type PlayedMatch, type TeamSummary } from '@/src/lib/teamRecord';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Team } from '@/src/types/api';

/**
 * Which side of a comparison a figure favours.
 *
 * `higher` is for the figures where more is better and `lower` for goals
 * against, where it is not. Equal figures favour neither, so nothing is marked.
 */
type Better = 'a' | 'b' | null;
const compare = (a: number, b: number, direction: 'higher' | 'lower'): Better => {
  if (a === b) return null;
  const aWins = direction === 'higher' ? a > b : a < b;
  return aWins ? 'a' : 'b';
};

/** One statistic across both teams, with the better side given weight. */
function Line({ label, a, b, better }: { label: string; a: string | number; b: string | number; better: Better }) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.line}>
    <Text style={[styles.figure, styles.figureLeft, better === 'a' && styles.figureBetter]}>{a}</Text>
    <Text style={styles.lineLabel}>{label}</Text>
    <Text style={[styles.figure, styles.figureRight, better === 'b' && styles.figureBetter]}>{b}</Text>
  </View>;
}

/**
 * Two bars sharing a scale, so their lengths can be read against each other.
 *
 * The longer bar is the larger figure, not the better one — which of the two is
 * better depends on the row, and the figures above already say so.
 */
function Bars({ label, a, b, format = String }: { label: string; a: number; b: number; format?: (value: number) => string }) {
  const styles = useThemedStyles(stylesheet);
  const most = Math.max(a, b, 1);
  return <View style={styles.bars}>
    <Text style={styles.barsLabel}>{label}</Text>
    <View style={styles.barRow}>
      <Text style={styles.barFigure}>{format(a)}</Text>
      <View style={styles.barTrack}><View style={[styles.barFill, styles.barFillA, { width: `${(a / most) * 100}%` }]} /></View>
    </View>
    <View style={styles.barRow}>
      <Text style={styles.barFigure}>{format(b)}</Text>
      <View style={styles.barTrack}><View style={[styles.barFill, styles.barFillB, { width: `${(b / most) * 100}%` }]} /></View>
    </View>
  </View>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>;
}

/** One team's last five, as a column of its own beside the other's. */
function RecentColumn({ team, played }: { team: Team; played: PlayedMatch[] }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const last5 = played.slice(0, 5);
  return <View style={styles.recentColumn}>
    <Text numberOfLines={1} style={styles.recentTeam}>{team.name}</Text>
    {last5.length === 0 ? <Text style={styles.empty}>No matches yet.</Text> : last5.map((entry) => {
      const tint = { W: colors.live, D: colors.textMuted, L: colors.error }[entry.result];
      return <Pressable
        accessibilityLabel={`${entry.scored}–${entry.conceded} against ${entry.opponent?.name ?? 'an opponent'}`}
        accessibilityRole="button"
        key={entry.match.id}
        onPress={() => router.push({ pathname: '/match/[id]', params: { id: entry.match.id } })}
        style={({ pressed, hovered }: PressState) => [styles.recentRow, hovered && styles.hovered, pressed && styles.pressed]}
      >
        <View style={[styles.resultFlag, { backgroundColor: tint }]}><Text style={styles.resultLetter}>{entry.result}</Text></View>
        <Text numberOfLines={1} style={styles.recentOpponent}>{entry.opponent?.name ?? 'Opponent'}</Text>
        <Text style={styles.recentScore}>{entry.scored}–{entry.conceded}</Text>
      </Pressable>;
    })}
  </View>;
}

export default function CompareTeamsScreen() {
  const styles = useThemedStyles(stylesheet);
  const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
  const teams = useQuery({ queryKey: cacheKeys.teams, queryFn: () => api.teams('?limit=200') });
  const teamA = teams.data?.items.find((item) => item.id === a);
  const teamB = teams.data?.items.find((item) => item.id === b);

  const tableA = useQuery({ queryKey: ['standings', teamA?.competition_id], queryFn: () => api.standings(teamA!.competition_id!), enabled: Boolean(teamA?.competition_id) });
  const tableB = useQuery({ queryKey: ['standings', teamB?.competition_id], queryFn: () => api.standings(teamB!.competition_id!), enabled: Boolean(teamB?.competition_id) });
  const matchesA = useQuery({ queryKey: ['matches', 'team', a], queryFn: () => api.matches(`?team_id=${encodeURIComponent(a!)}&limit=100`), enabled: Boolean(a) });
  const matchesB = useQuery({ queryKey: ['matches', 'team', b], queryFn: () => api.matches(`?team_id=${encodeURIComponent(b!)}&limit=100`), enabled: Boolean(b) });
  const record = useQuery({ queryKey: ['head-to-head', a, b], queryFn: () => api.headToHead(a!, b!), enabled: Boolean(a && b) });

  const playedA = useMemo(() => playedMatches(matchesA.data?.items ?? [], a ?? ''), [matchesA.data, a]);
  const playedB = useMemo(() => playedMatches(matchesB.data?.items ?? [], b ?? ''), [matchesB.data, b]);
  const rowA = tableA.data?.find((entry) => entry.team.id === a);
  const rowB = tableB.data?.find((entry) => entry.team.id === b);
  const summaryA = summarise(rowA, playedA);
  const summaryB = summarise(rowB, playedB);

  if (teams.isLoading) return <Screen action={<CloseButton />} title="Compare teams"><LoadingState label="Loading teams" /></Screen>;
  if (!teamA || !teamB) return <Screen action={<CloseButton />} title="Compare teams"><EmptyState body="One of these teams is no longer on the roster." title="Teams not found" /></Screen>;
  if (tableA.isError || tableB.isError) return <Screen action={<CloseButton />} title="Compare teams"><ErrorState message={((tableA.error ?? tableB.error) as ApiError).message} onRetry={() => { tableA.refetch(); tableB.refetch(); }} /></Screen>;

  return <Screen action={<CloseButton />} title="Compare teams">
    <View style={styles.heads}>
      <TeamHead rank={rowA?.rank} team={teamA} />
      <Text style={styles.versus}>VS</Text>
      <TeamHead rank={rowB?.rank} team={teamB} />
    </View>

    {!summaryA || !summaryB
      ? <EmptyState body="Both teams need a finished match before they can be compared." title="Not enough played yet" />
      : <>
        <Section title="Season">
          <View style={styles.card}>
            {statLines(summaryA, summaryB, rowA?.rank, rowB?.rank).map((line) => <Line a={line.a} b={line.b} better={line.better} key={line.label} label={line.label} />)}
          </View>
        </Section>

        <Section title="Form">
          <View style={styles.card}>
            <View style={styles.formSide}>
              <Text numberOfLines={1} style={styles.formTeam}>{teamA.name}</Text>
              <FormStrip form={summaryA.form} size="large" />
            </View>
            <View style={styles.formSide}>
              <Text numberOfLines={1} style={styles.formTeam}>{teamB.name}</Text>
              <FormStrip form={summaryB.form} size="large" />
            </View>
          </View>
        </Section>

        <Section title="Attack and defence">
          <View style={styles.card}>
            <View style={styles.legend}>
              <View style={styles.legendItem}><View style={[styles.swatch, styles.barFillA]} /><Text numberOfLines={1} style={styles.legendText}>{teamA.name}</Text></View>
              <View style={styles.legendItem}><View style={[styles.swatch, styles.barFillB]} /><Text numberOfLines={1} style={styles.legendText}>{teamB.name}</Text></View>
            </View>
            <Bars a={summaryA.goalsFor} b={summaryB.goalsFor} label="Goals scored" />
            <Bars a={summaryA.goalsAgainst} b={summaryB.goalsAgainst} label="Goals conceded" />
            <Bars a={summaryA.averageScored} b={summaryB.averageScored} format={oneDecimal} label="Scored per game" />
            <Bars a={summaryA.averageConceded} b={summaryB.averageConceded} format={oneDecimal} label="Conceded per game" />
          </View>
        </Section>
      </>}

    <Section title="Previous meetings">
      {record.isLoading ? <LoadingState label="Loading record" />
        : record.isError ? <ErrorState message={(record.error as ApiError).message} onRetry={() => record.refetch()} />
        : !record.data?.played ? <Text style={styles.empty}>These two have not met in a finished match yet.</Text>
        : <View style={styles.card}>
          <Line a={record.data.played} b={record.data.played} better={null} label="Played" />
          <Line a={record.data.won} b={record.data.lost} better={compare(record.data.won, record.data.lost, 'higher')} label="Wins" />
          <Line a={record.data.drawn} b={record.data.drawn} better={null} label="Draws" />
          <Line a={record.data.goals_for} b={record.data.goals_against} better={compare(record.data.goals_for, record.data.goals_against, 'higher')} label="Goals" />
          {record.data.meetings.slice(0, 5).map((meeting) => <Pressable
            accessibilityLabel={`${meeting.home_team?.name} ${meeting.home_score} ${meeting.away_score} ${meeting.away_team?.name}`}
            accessibilityRole="button"
            key={meeting.match_id}
            onPress={() => router.push({ pathname: '/match/[id]', params: { id: meeting.match_id } })}
            style={({ pressed, hovered }: PressState) => [styles.meeting, hovered && styles.hovered, pressed && styles.pressed]}
          >
            <Text numberOfLines={1} style={styles.meetingTitle}>{meeting.home_team?.name} {meeting.home_score}–{meeting.away_score} {meeting.away_team?.name}</Text>
            <Text style={styles.meetingDate}>{formatEgyptDateTime(meeting.kickoff_datetime)}</Text>
          </Pressable>)}
        </View>}
    </Section>

    <Section title="Recent results">
      <View style={styles.recent}>
        <RecentColumn played={playedA} team={teamA} />
        <RecentColumn played={playedB} team={teamB} />
      </View>
    </Section>
  </Screen>;
}

function TeamHead({ team, rank }: { team: Team; rank?: number }) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.head}>
    <TeamAvatar badgeStyle={team.badge_style} isAimz={team.is_aimz} logoUrl={team.logo_url} name={team.name} size={52} />
    <Text numberOfLines={2} style={styles.headName}>{team.name}</Text>
    {rank ? <Text style={styles.headRank}>{rank}{rank % 100 >= 11 && rank % 100 <= 13 ? 'th' : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th'}</Text> : null}
  </View>;
}

/** The table, row by row, with the side each figure favours worked out once. */
function statLines(a: TeamSummary, b: TeamSummary, rankA?: number, rankB?: number) {
  return [
    { label: 'Position', a: rankA ?? '—', b: rankB ?? '—', better: rankA && rankB ? compare(rankA, rankB, 'lower') : null },
    { label: 'Points', a: a.points, b: b.points, better: compare(a.points, b.points, 'higher') },
    { label: 'Played', a: a.played, b: b.played, better: null },
    { label: 'Won', a: a.won, b: b.won, better: compare(a.won, b.won, 'higher') },
    { label: 'Drawn', a: a.drawn, b: b.drawn, better: null },
    { label: 'Lost', a: a.lost, b: b.lost, better: compare(a.lost, b.lost, 'lower') },
    { label: 'Goals for', a: a.goalsFor, b: b.goalsFor, better: compare(a.goalsFor, b.goalsFor, 'higher') },
    { label: 'Goals against', a: a.goalsAgainst, b: b.goalsAgainst, better: compare(a.goalsAgainst, b.goalsAgainst, 'lower') },
    { label: 'Goal difference', a: `${a.goalDifference > 0 ? '+' : ''}${a.goalDifference}`, b: `${b.goalDifference > 0 ? '+' : ''}${b.goalDifference}`, better: compare(a.goalDifference, b.goalDifference, 'higher') },
    { label: 'Win rate', a: percent(a.winRate), b: percent(b.winRate), better: compare(a.winRate, b.winRate, 'higher') },
    { label: 'Points per game', a: oneDecimal(a.pointsPerGame), b: oneDecimal(b.pointsPerGame), better: compare(a.pointsPerGame, b.pointsPerGame, 'higher') },
    { label: 'Clean sheets', a: a.cleanSheets, b: b.cleanSheets, better: compare(a.cleanSheets, b.cleanSheets, 'higher') },
  ];
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  heads: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md },
  head: { alignItems: 'center', flex: 1, gap: theme.spacing.xs },
  headName: { color: colors.textPrimary, fontFamily: theme.font.bold, textAlign: 'center' },
  headRank: { color: colors.textMuted, fontFamily: theme.font.mono, fontSize: theme.type.caption },
  versus: { color: colors.textMuted, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 1 },

  section: { gap: theme.spacing.sm },
  sectionTitle: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },

  line: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 28 },
  lineLabel: { color: colors.textMuted, flex: 1, fontSize: theme.type.caption, textAlign: 'center' },
  // Fixed either side so every row's figures stand in the same two columns.
  figure: { color: colors.textSecondary, fontFamily: theme.font.mono, width: 62 },
  figureLeft: { textAlign: 'left' },
  figureRight: { textAlign: 'right' },
  // The whole of the emphasis: darker and heavier, no colour and no badge.
  figureBetter: { color: colors.textPrimary, fontFamily: theme.font.monoBold },

  formSide: { gap: theme.spacing.xs },
  formTeam: { color: colors.textMuted, fontSize: theme.type.caption },

  legend: { flexDirection: 'row', gap: theme.spacing.md },
  legendItem: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.xs },
  legendText: { color: colors.textMuted, flexShrink: 1, fontSize: theme.type.caption },
  swatch: { borderRadius: 3, height: 10, width: 10 },

  bars: { gap: theme.spacing.xs },
  barsLabel: { color: colors.textMuted, fontSize: theme.type.caption },
  barRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm },
  barFigure: { color: colors.textSecondary, fontFamily: theme.font.mono, fontSize: theme.type.caption, textAlign: 'right', width: 34 },
  barTrack: { backgroundColor: colors.surfaceRaised, borderRadius: 4, flex: 1, height: 8, overflow: 'hidden' },
  barFill: { borderRadius: 4, height: 8 },
  barFillA: { backgroundColor: colors.accent },
  barFillB: { backgroundColor: colors.accentSoft },

  meeting: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, gap: 2, minHeight: theme.touch.minimum, paddingTop: theme.spacing.sm },
  meetingTitle: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  meetingDate: { color: colors.textMuted, fontSize: theme.type.caption },

  recent: { flexDirection: 'row', gap: theme.spacing.sm },
  recentColumn: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flex: 1, gap: theme.spacing.xs, padding: theme.spacing.sm },
  recentTeam: { color: colors.textMuted, fontSize: theme.type.caption },
  recentRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs, minHeight: 32 },
  recentOpponent: { color: colors.textSecondary, flex: 1, fontSize: theme.type.caption },
  recentScore: { color: colors.textPrimary, fontFamily: theme.font.mono, fontSize: theme.type.caption },
  resultFlag: { alignItems: 'center', borderRadius: 4, height: 18, justifyContent: 'center', width: 18 },
  resultLetter: { color: colors.background, fontFamily: theme.font.bold, fontSize: 10 },

  empty: { color: colors.textMuted, fontSize: theme.type.caption, lineHeight: 20 },
  hovered: { backgroundColor: colors.surfaceRaised },
  pressed: { opacity: 0.7 },
});
