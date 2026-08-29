import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AnimatedTabPill } from '@/src/components/AnimatedTabPill';
import { BracketView } from '@/src/components/BracketView';
import { Screen } from '@/src/components/Screen';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { FormStrip } from '@/src/components/FormStrip';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { invalidateAfterWrite } from '@/src/lib/cache';
import type { PressState } from '@/src/lib/pressState';
import { showMessage } from '@/src/lib/platformAlert';
import { isKnockout, type BracketSlot, type FormResult, type StandingRow } from '@/src/types/api';

function HeadToHead({ teamId, opponentId, onClose }: { teamId: string; opponentId: string; onClose: () => void }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const record = useQuery({ queryKey: ['head-to-head', teamId, opponentId], queryFn: () => api.headToHead(teamId, opponentId) });
  return <View style={styles.h2h}>
    <View style={styles.h2hHeader}>
      <Text style={styles.h2hTitle}>{record.data ? `${record.data.team.name} vs ${record.data.opponent.name}` : 'Head to head'}</Text>
      <Pressable accessibilityLabel="Close head to head" accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.h2hClose, pressed && styles.pressed]}>
        <Ionicons color={colors.textSecondary} name="close" size={18} />
      </Pressable>
    </View>
    {record.isLoading ? <LoadingState label="Loading record" /> : record.isError ? <ErrorState message={(record.error as ApiError).message} onRetry={() => record.refetch()} /> : !record.data?.played ? <Text style={styles.h2hEmpty}>These two have not met in a finished match yet.</Text> : <>
      <Text accessibilityLabel={`Won ${record.data.won}, drawn ${record.data.drawn}, lost ${record.data.lost}`} style={styles.h2hRecord}>
        {record.data.won}W · {record.data.drawn}D · {record.data.lost}L · {record.data.goals_for}–{record.data.goals_against}
      </Text>
      {record.data.meetings.slice(0, 5).map((meeting) => <View key={meeting.match_id} style={styles.h2hRow}>
        <Text numberOfLines={1} style={styles.h2hFixture}>{meeting.home_team?.name} {meeting.home_score}–{meeting.away_score} {meeting.away_team?.name}</Text>
        <Text style={styles.h2hDate}>{new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium' }).format(new Date(meeting.kickoff_datetime))}</Text>
      </View>)}
    </>}
  </View>;
}

/**
 * The only way into a comparison.
 *
 * It sits inside the row, which opens the team, so the press is stopped here:
 * on native the responder system already keeps it, and on web the click would
 * otherwise carry on up to the row. Small on the page and 44 points to the
 * finger, which is what `hitSlop` buys without drawing anything bigger.
 */
function CompareButton({ onPress, selected, teamName }: { onPress: () => void; selected: boolean; teamName: string }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  return <Pressable
    accessibilityHint="Selects this team to compare, without opening it"
    accessibilityLabel={selected ? `${teamName} selected to compare` : `Compare ${teamName}`}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    hitSlop={12}
    onPress={(event) => { event.stopPropagation?.(); onPress(); }}
    style={({ pressed }) => [styles.compare, selected && styles.compareOn, pressed && styles.pressed]}
    testID={`compare-${teamName}`}
  >
    <Ionicons color={selected ? colors.onAccent : colors.textMuted} name={selected ? 'checkmark' : 'swap-horizontal'} size={14} />
  </Pressable>;
}

const VIEWS = [{ label: 'Groups', value: 'groups' }, { label: 'Bracket', value: 'bracket' }] as const;

export default function StandingsScreen() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const client = useQueryClient();
  const competitions = useQuery({ queryKey: ['competitions'], queryFn: () => api.competitions('?limit=100') });
  const eligible = useMemo(() => competitions.data?.items.filter((item) => item.type !== 'friendly') ?? [], [competitions.data]);
  const [selected, setSelected] = useState<string | null>(null);
  // Arriving from Manage names the competition to open, so the admin lands on
  // the table they were just setting up rather than on whichever is first.
  const { competition: requested } = useLocalSearchParams<{ competition?: string }>();
  useEffect(() => { if (requested) setSelected(requested); }, [requested]);
  const competition = eligible.find((item) => item.id === (selected ?? requested)) ?? eligible[0];
  const competitionId = competition?.id;
  const knockout = isKnockout(competition);
  const table = useQuery({ queryKey: ['standings', competitionId], queryFn: () => api.standings(competitionId!), enabled: Boolean(competitionId) });
  const bracket = useQuery({ queryKey: ['bracket', competitionId], queryFn: () => api.bracket(competitionId!), enabled: Boolean(competitionId) && knockout });
  const [view, setView] = useState<'groups' | 'bracket'>('groups');
  // Who goes through is the admin's call, so both writes are explicit actions.
  const draw = useMutation({
    mutationFn: (round: number) => api.advanceRound(competitionId!, round),
    onError: (error) => showMessage('Round not drawn', (error as ApiError).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'bracket'); },
  });
  const pickWinner = useMutation({
    mutationFn: ({ slot, teamId }: { slot: BracketSlot; teamId: string }) => api.setBracketWinner(slot.id, slot.winner_team_id === teamId ? null : teamId),
    onError: (error) => showMessage('Winner not saved', (error as ApiError).message),
    onSuccess: async () => { await invalidateAfterWrite(client, 'bracket'); },
  });
  // A knockout's rows arrive ordered by group, so grouping them keeps that order.
  const groupedRows = useMemo(() => {
    const groups = new Map<string, { name: string; rows: StandingRow[] }>();
    for (const row of table.data ?? []) {
      const key = row.group?.id ?? 'undrawn';
      const existing = groups.get(key) ?? { name: row.group?.name ?? 'Not yet drawn', rows: [] };
      existing.rows.push(row);
      groups.set(key, existing);
    }
    return [...groups.values()];
  }, [table.data]);
  /**
   * Comparison is its own action, reached only through the compare control on a
   * row. Tapping the row itself opens the team, at every stage — the two never
   * stand in for one another.
   */
  const [comparing, setComparing] = useState<string | null>(null);
  const compare = (teamId: string) => {
    if (comparing === teamId) { setComparing(null); return; }
    if (comparing === null) { setComparing(teamId); return; }
    const first = comparing;
    setComparing(null);
    router.push({ pathname: '/compare/[a]/[b]', params: { a: first, b: teamId } });
  };
  const open = (teamId: string) => router.push({ pathname: '/team/[id]', params: { id: teamId } });
  const comparingName = table.data?.find((row) => row.team.id === comparing)?.team.name;

  return <Screen title="Standings">
    {/* Only worth a switcher when more than one competition is running. */}
    {eligible.length > 1 ? <ScrollView contentContainerStyle={styles.tabs} horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
      {eligible.map((item) => {
        const active = item.id === competitionId;
        return <AnimatedTabPill key={item.id} label={item.name} onPress={() => setSelected(item.id)} selected={active} style={styles.tab} testID={`competition-tab-${item.id}`} />;
      })}
    </ScrollView> : competition ? <Text style={styles.soleCompetition}>{competition.name}</Text> : null}
    <View style={styles.content} testID="standings-content">
      {knockout ? <SegmentedControl label="Groups or bracket" onChange={setView} options={VIEWS} value={view} /> : null}
      {comparing ? <View style={styles.compareBar}>
        <Text style={styles.comparePrompt}>Select another team to compare with {comparingName ?? 'this team'}.</Text>
        <Pressable accessibilityLabel="Cancel comparison" accessibilityRole="button" onPress={() => setComparing(null)} style={({ pressed }) => [styles.compareCancel, pressed && styles.pressed]}>
          <Text style={styles.compareCancelText}>Cancel</Text>
        </Pressable>
      </View> : null}
      {competitions.isLoading || table.isLoading ? <LoadingState label="Calculating table" /> : competitions.isError || table.isError ? <ErrorState message={(competitions.error as ApiError | null)?.message ?? (table.error as ApiError | null)?.message ?? 'Could not load standings.'} onRetry={() => { competitions.refetch(); table.refetch(); }} /> : knockout && view === 'bracket' ? (bracket.data?.rounds.length ? <BracketView bracket={bracket.data} busy={draw.isPending || pickWinner.isPending} onAdvance={user?.role === 'admin' ? (round) => draw.mutate(round) : undefined} onPickWinner={user?.role === 'admin' ? (slot, teamId) => pickWinner.mutate({ slot, teamId }) : undefined} /> : <EmptyState body="The bracket appears once the competition is drawn." title="No bracket yet" />)
        : !competitionId || !table.data?.length ? <EmptyState body="Finished matches will create the table automatically." title="No standings yet" />
        : knockout ? <View style={styles.groups}>{groupedRows.map((group) => <View key={group.name} style={styles.group}><Text style={styles.groupName}>{group.name}</Text>{tableFor(group.rows)}</View>)}</View>
        : tableFor(table.data)}
    </View>
  </Screen>;

  function tableFor(rows: StandingRow[]) {
    return <View style={styles.table}>
      <View style={styles.tableHeader}>
        <View style={styles.nameSide}>
          <Text style={styles.rankHeader}>#</Text>
          <Text style={[styles.team, styles.headerText]}>TEAM</Text>
        </View>
        {/* Stands in for the compare control, so the columns above the rows are
          * set back by exactly as much as the rows are. */}
        <View accessibilityElementsHidden style={styles.compareSlot} />
        <View style={styles.stats}>
          <Text style={[styles.played, styles.headerText]}>P</Text>
          <Text style={[styles.scores, styles.headerText]}>F:A</Text>
          <Text style={[styles.stat, styles.headerText]}>GD</Text>
          <Text style={[styles.pointsHeader, styles.headerText]}>PTS</Text>
        </View>
      </View>
      {rows.map((row: StandingRow, index: number) => <View key={row.team.id} style={[styles.row, index % 2 === 1 && styles.altRow, row.team.is_aimz && styles.aimzRow, row.rank === 1 && styles.leaderRow, comparing === row.team.id && styles.comparingRow]} testID={`standings-row-${row.team.id}`}>
        {row.rank === 1 ? <View accessibilityElementsHidden style={styles.leaderEdge} /> : null}
        <Pressable accessibilityHint="Opens this team's profile" accessibilityLabel={`${row.team.name}, ${row.points} points`} accessibilityRole="button" onPress={() => open(row.team.id)} style={({ pressed, hovered }: PressState) => [styles.nameSide, hovered && styles.hoveredRow, pressed && styles.pressed]}>
        <Text style={[styles.rank, row.rank === 1 && styles.leaderRank]}>{row.rank}</Text>
        <View style={styles.teamCell}>
          <TeamAvatar badgeStyle={row.team.badge_style} isAimz={row.team.is_aimz} logoUrl={row.team.logo_url} name={row.team.name} size={32} />
          <View style={styles.team}>
            <View style={styles.nameRow}>
              <Text numberOfLines={1} style={[styles.teamName, row.rank === 1 && styles.leaderName]}>{row.team.name}</Text>
              {row.rank === 1 ? <Ionicons accessibilityLabel="First place" color={colors.leaderAccent} name="trophy" size={16} /> : null}
            </View>
            {row.team.squad_code ? <Text numberOfLines={1} style={styles.code}>{row.team.squad_code}</Text> : null}
            <View style={styles.formRow}><FormStrip form={row.form ?? []} /></View>
          </View>
        </View>
        </Pressable>
        <CompareButton onPress={() => compare(row.team.id)} selected={comparing === row.team.id} teamName={row.team.name} />
        <Pressable accessibilityHint="Opens this team's profile" accessibilityLabel={`${row.team.name}: played ${row.played}, ${row.goals_for} scored and ${row.goals_against} conceded, goal difference ${row.goal_difference}`} accessibilityRole="button" onPress={() => open(row.team.id)} style={({ pressed, hovered }: PressState) => [styles.stats, hovered && styles.hoveredRow, pressed && styles.pressed]}>
          <Text style={styles.played}>{row.played}</Text>
          <Text style={styles.scores}>{row.goals_for}:{row.goals_against}</Text>
          <Text style={styles.stat}>{row.goal_difference > 0 ? '+' : ''}{row.goal_difference}</Text>
          <View style={[styles.pointsBox, row.rank === 1 && styles.leaderPointsBox]}>
            <Text style={[styles.points, row.rank === 1 && styles.leaderPoints]}>{row.points}</Text>
          </View>
        </Pressable>
      </View>)}
    </View>;
  }
}

/**
 * The table's columns, shared by the header and every row.
 *
 * Fixed rather than shared out, so a long team name cannot push the numbers
 * around and the header cannot drift away from the values under it. Only the
 * team cell flexes, taking whatever is left.
 */
const RANK_COLUMN = 20;
/** Two digits at most. */
const PLAYED_COLUMN = 20;
/** "12:10" at its widest. */
const SCORES_COLUMN = 34;
/** A sign and two digits. */
const STAT_COLUMN = 26;
const POINTS_COLUMN = 34;
const COMPARE_COLUMN = 22;

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  // The section the switcher swaps, which keeps the page's own rhythm between
  // whatever it is showing.
  content: { gap: theme.spacing.lg },
  tabBar: { flexGrow: 0 },
  soleCompetition: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.body, paddingHorizontal: theme.spacing.xs },
  groups: { gap: theme.spacing.lg },
  group: { gap: theme.spacing.sm },
  groupName: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.label, letterSpacing: 1.2, textTransform: 'uppercase' },
  tabs: { gap: theme.spacing.sm },
  // AnimatedTabPill draws the pill itself — radius, border and focus-ring
  // reset included — so this only spaces the label inside it.
  tab: { paddingHorizontal: theme.spacing.md },
  pressed: { opacity: 0.7 },
  formRow: { marginTop: 4 },
  // Small enough to stay out of the table's way; `hitSlop` gives the finger the
  // 44 points the drawing does not.
  // The row's own tap target. It holds every column, so the compare control
  // beside it is the only thing in the row that is not "open this team".
  // The team's side of the row, which is one tap target; the figures are
  // another, and the compare control sits between them belonging to neither.
  nameSide: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minWidth: 0 },
  compareSlot: { width: COMPARE_COLUMN },
  // Four narrow columns held closer together than the row's own spacing, so
  // the extra one costs the team name as little width as it can.
  stats: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  played: { color: colors.textSecondary, fontFamily: theme.font.mono, fontVariant: ['tabular-nums'], textAlign: 'right', width: PLAYED_COLUMN },
  scores: { color: colors.textSecondary, fontFamily: theme.font.mono, fontVariant: ['tabular-nums'], textAlign: 'right', width: SCORES_COLUMN },
  compare: { alignItems: 'center', borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, height: COMPARE_COLUMN, justifyContent: 'center', width: COMPARE_COLUMN },
  compareOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  comparingRow: { borderColor: colors.accent },
  hoveredRow: { backgroundColor: colors.surfaceRaised },
  compareBar: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  comparePrompt: { color: colors.textSecondary, flex: 1, lineHeight: 20 },
  compareCancel: { minHeight: theme.touch.minimum, justifyContent: 'center' },
  compareCancelText: { color: colors.accentSoft, fontFamily: theme.font.bold },
  h2h: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  h2hHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  h2hTitle: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.bold },
  h2hClose: { alignItems: 'center', height: theme.touch.minimum, justifyContent: 'center', width: theme.touch.minimum },
  h2hRecord: { color: colors.accentSoft, fontFamily: theme.font.monoBold, fontVariant: ['tabular-nums'] },
  h2hRow: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: theme.spacing.xs },
  h2hFixture: { color: colors.textPrimary, fontFamily: theme.font.regular, fontSize: theme.type.label },
  h2hDate: { color: colors.textMuted, fontFamily: theme.font.mono, fontSize: theme.type.caption, marginTop: 2 },
  h2hEmpty: { color: colors.textMuted, fontFamily: theme.font.regular, lineHeight: 21 },
  h2hPrompt: { color: colors.textSecondary, fontFamily: theme.font.regular, lineHeight: 21 },
  table: { gap: 6 },
  // Each row is a bordered card, and with border-box that border eats a pixel
  // of its content on both sides. The header carries the same border in nothing
  // but air, so its cells sit in the same box as the values under them.
  tableHeader: { alignItems: 'center', borderColor: 'transparent', borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 32, paddingHorizontal: theme.spacing.md },
  headerText: { color: colors.textMuted, fontFamily: theme.font.monoBold, fontSize: theme.type.caption, letterSpacing: 0.8 },
  rankHeader: { color: colors.textMuted, fontFamily: theme.font.monoBold, fontSize: theme.type.caption, width: RANK_COLUMN },
  row: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.size.listRow, overflow: 'hidden', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
  altRow: { backgroundColor: colors.surface },
  aimzRow: { backgroundColor: colors.highlightedSurface },
  leaderRow: { backgroundColor: colors.leaderSurface },
  // Laid over the row rather than bordering it. A left border is part of the
  // box, so it inset the leader's cells by its own width and left the rank,
  // crest, name and form sitting a few pixels right of every row beneath — and
  // of the header, which has no border to match. The table clips it to the
  // rounded corner.
  leaderEdge: { backgroundColor: colors.leaderAccent, bottom: 0, left: 0, position: 'absolute', top: 0, width: 4 },
  rank: { color: colors.textMuted, fontFamily: theme.font.monoBold, fontVariant: ['tabular-nums'], width: RANK_COLUMN },
  leaderRank: { color: colors.leaderAccent },
  teamCell: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm },
  team: { flex: 1 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  teamName: { color: colors.textPrimary, flexShrink: 1, fontFamily: theme.font.semibold },
  leaderName: { fontFamily: theme.font.bold },
  code: { color: colors.accentSoft, fontFamily: theme.font.medium, fontSize: theme.type.caption, marginTop: 2 },
  stat: { color: colors.textSecondary, fontFamily: theme.font.mono, fontVariant: ['tabular-nums'], textAlign: 'right', width: STAT_COLUMN },
  // Centred over the badge below it, and the same width, so the label sits on
  // the number rather than beside it.
  pointsHeader: { textAlign: 'center', width: POINTS_COLUMN },
  pointsBox: { alignItems: 'center', backgroundColor: colors.textPrimary, borderRadius: theme.radius.sm, justifyContent: 'center', minHeight: 40, width: POINTS_COLUMN },
  leaderPointsBox: { backgroundColor: colors.accent },
  points: { color: colors.background, fontFamily: theme.font.monoBold, textAlign: 'center' },
  leaderPoints: { color: colors.onAccent },
});
