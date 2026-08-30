import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AnimatedTabPill } from '@/src/components/AnimatedTabPill';
import { BracketView } from '@/src/components/BracketView';
import { Screen } from '@/src/components/Screen';
import { SeasonPicker } from '@/src/components/SeasonPicker';
import { SettingsButton } from '@/src/components/SettingsButton';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { FormStrip } from '@/src/components/FormStrip';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { TrophyIcon } from '@/src/components/TrophyIcon';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { invalidateAfterWrite } from '@/src/lib/cache';
import type { PressState } from '@/src/lib/pressState';
import { showMessage } from '@/src/lib/platformAlert';
import { allSeasons, currentSeason, isKnockout, type BracketSlot, type StandingRow } from '@/src/types/api';

/**
 * The only way into a comparison, and there is one of it.
 *
 * Comparing is something you do once, so the control for it belongs in the
 * table's header rather than repeated down every row: it turns the table into a
 * picker, and the rows themselves say who to compare. Small on the page and 44
 * points to the finger, which is what `hitSlop` buys without drawing anything
 * bigger.
 */
function CompareToggle({ comparing, onPress }: { comparing: boolean; onPress: () => void }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  return <Pressable
    accessibilityHint="Then pick two teams from the table"
    accessibilityLabel="Compare two teams"
    accessibilityRole="button"
    accessibilityState={{ selected: comparing }}
    hitSlop={12}
    onPress={onPress}
    style={({ pressed }) => [styles.compare, comparing && styles.compareOn, pressed && styles.pressed]}
    testID="compare-toggle"
  >
    <Ionicons color={comparing ? colors.onAccent : colors.textMuted} name="swap-horizontal" size={14} />
  </Pressable>;
}

const VIEWS = [{ label: 'Groups', value: 'groups' }, { label: 'Bracket', value: 'bracket' }] as const;

export default function StandingsScreen() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { user } = useAuth();
  const client = useQueryClient();
  const competitions = useQuery({ queryKey: ['competitions'], queryFn: () => api.competitions('?limit=100') });
  const running = useMemo(() => competitions.data?.items.filter((item) => item.type !== 'friendly') ?? [], [competitions.data]);
  const seasons = useMemo(() => allSeasons(running), [running]);
  const [season, setSeason] = useState<string | null>(null);
  // The season being played, until the reader picks another.
  const openSeason = season ?? currentSeason(running);
  // Each season is its own set of competition rows, so choosing a season is
  // what decides which table, matches, bracket and awards are read — the
  // filtering is the competition id, not a sieve over everything at once.
  const eligible = useMemo(() => running.filter((item) => item.season === openSeason), [running, openSeason]);
  const [selected, setSelected] = useState<string | null>(null);
  // Arriving from Manage names the competition to open, so the admin lands on
  // the table they were just setting up rather than on whichever is first.
  const { competition: requested } = useLocalSearchParams<{ competition?: string }>();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  useEffect(() => { if (requested) setSelected(requested); }, [requested]);
  const chosen = eligible.find((item) => item.id === (selected ?? requested));
  // A season change moves to the same competition in that season rather than
  // dropping the reader back to whichever happens to be first.
  const byName = selectedName ? eligible.find((item) => item.name === selectedName) : undefined;
  const competition = chosen ?? byName ?? eligible[0];
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
   * Comparison is a mode the header control turns on, not something a row can
   * fall into by accident: `null` is off, `[]` is on with nobody picked, and one
   * id is on and waiting for the second. While it is on a row press picks rather
   * than opens, which is the whole of the difference between the two.
   */
  const [picking, setPicking] = useState<string[] | null>(null);
  const toggleCompare = () => setPicking((current) => (current === null ? [] : null));
  const pick = (chosen: string[], teamId: string) => {
    const next = chosen.includes(teamId) ? chosen.filter((id) => id !== teamId) : [...chosen, teamId];
    if (next.length < 2) { setPicking(next); return; }
    setPicking(null);
    router.push({ pathname: '/compare/[a]/[b]', params: { a: next[0]!, b: next[1]! } });
  };
  const open = (teamId: string) => router.push({ pathname: '/team/[id]', params: { id: teamId } });
  const pickedName = table.data?.find((row) => row.team.id === picking?.[0])?.team.name;

  const closed = competition?.status === 'completed';
  // The header's own settings button sits left of a screen's action, which
  // would put the gear between the title and the season. Here the two are
  // given in the order they should read: the season, then settings on the edge.
  return <Screen action={<><SeasonPicker completed={closed} onChange={(next) => { setSeason(next); setSelected(null); }} season={openSeason ?? ''} seasons={seasons} /><SettingsButton /></>} hideSettings title="Standings">
    {closed ? <View style={styles.archived}>
      <Ionicons accessibilityElementsHidden color={colors.textMuted} name="lock-closed-outline" size={14} />
      <Text style={styles.archivedText}>{competition?.name} {competition?.season} has ended. This table is final.</Text>
    </View> : null}
    {/* Only worth a switcher when more than one competition is running. */}
    {eligible.length > 1 ? <ScrollView contentContainerStyle={styles.tabs} horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
      {eligible.map((item) => {
        const active = item.id === competitionId;
        return <AnimatedTabPill key={item.id} label={item.name} onPress={() => { setSelected(item.id); setSelectedName(item.name); }} selected={active} style={styles.tab} testID={`competition-tab-${item.id}`} />;
      })}
    </ScrollView> : competition ? <Text style={styles.soleCompetition}>{competition.name}</Text> : null}
    <View style={styles.content} testID="standings-content">
      {knockout ? <SegmentedControl label="Groups or bracket" onChange={setView} options={VIEWS} value={view} /> : null}
      {picking ? <View style={styles.compareBar}>
        <Text style={styles.comparePrompt}>{picking.length ? `Select another team to compare with ${pickedName ?? 'this team'}.` : 'Select two teams to compare.'}</Text>
        <Pressable accessibilityLabel="Cancel comparison" accessibilityRole="button" onPress={() => setPicking(null)} style={({ pressed }) => [styles.compareCancel, pressed && styles.pressed]}>
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
        {/* The label is left to size itself rather than flexing, so the control
          * sits beside the word and not out at the far end of the column. */}
        <View style={styles.nameSide}>
          <Text style={styles.rankHeader}>#</Text>
          <Text style={styles.headerText}>TEAM</Text>
          <CompareToggle comparing={picking !== null} onPress={toggleCompare} />
        </View>
        <View style={styles.stats}>
          <Text style={[styles.played, styles.headerText]}>P</Text>
          <Text style={[styles.scores, styles.headerText]}>F:A</Text>
          <Text style={[styles.stat, styles.headerText]}>GD</Text>
          <Text style={[styles.pointsHeader, styles.headerText]}>PTS</Text>
        </View>
      </View>
      {rows.map((row: StandingRow, index: number) => {
        const picked = picking?.includes(row.team.id) ?? false;
        const difference = `${row.goal_difference > 0 ? '+' : ''}${row.goal_difference}`;
        // One press, one meaning: the row is a single target again now that
        // nothing sits inside it wanting a press of its own.
        return <View key={row.team.id} style={[styles.row, index % 2 === 1 && styles.altRow, row.team.is_aimz && styles.aimzRow, row.rank === 1 && styles.leaderRow, picked && styles.pickedRow]} testID={`standings-row-${row.team.id}`}>
          {row.rank === 1 ? <View accessibilityElementsHidden style={styles.leaderEdge} /> : null}
          <Pressable
            accessibilityHint={picking ? 'Selects this team to compare' : "Opens this team's profile"}
            accessibilityLabel={`${row.team.name}, ${row.points} points, played ${row.played}, ${row.goals_for} scored and ${row.goals_against} conceded, goal difference ${difference}`}
            accessibilityRole="button"
            accessibilityState={{ selected: picked }}
            onPress={() => (picking ? pick(picking, row.team.id) : open(row.team.id))}
            style={({ pressed, hovered }: PressState) => [styles.rowPress, hovered && styles.hoveredRow, pressed && styles.pressed]}
          >
            <View style={styles.nameSide}>
              {/* The tick takes the rank's own column, so turning the mode on
                * moves nothing along the row. */}
              {picked ? <Ionicons color={colors.accent} name="checkmark" size={16} style={styles.rankSlot} /> : <Text style={[styles.rank, row.rank === 1 && styles.leaderRank]}>{row.rank}</Text>}
              <View style={styles.teamCell}>
                <TeamAvatar badgeStyle={row.team.badge_style} isAimz={row.team.is_aimz} logoUrl={row.team.logo_url} name={row.team.name} size={32} />
                <View style={styles.team}>
                  <View style={styles.nameRow}>
                    <Text numberOfLines={1} style={[styles.teamName, row.rank === 1 && styles.leaderName]}>{row.team.name}</Text>
                    {row.rank === 1 ? <TrophyIcon accessibilityLabel="First place" size={16} /> : null}
                  </View>
                  {row.team.squad_code ? <Text numberOfLines={1} style={styles.code}>{row.team.squad_code}</Text> : null}
                  <View style={styles.formRow}><FormStrip form={row.form ?? []} /></View>
                </View>
              </View>
            </View>
            <View style={styles.stats}>
              <Text style={styles.played}>{row.played}</Text>
              <Text style={styles.scores}>{row.goals_for}:{row.goals_against}</Text>
              <Text style={styles.stat}>{difference}</Text>
              <View style={[styles.pointsBox, row.rank === 1 && styles.leaderPointsBox]}>
                <Text style={[styles.points, row.rank === 1 && styles.leaderPoints]}>{row.points}</Text>
              </View>
            </View>
          </Pressable>
        </View>;
      })}
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
/** The header's compare control, which no row has to make room for. */
const COMPARE_CONTROL = 22;

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
  // The row's one tap target, holding every column: with the compare control
  // gone from the row, nothing inside it wants a press of its own.
  rowPress: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm },
  nameSide: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm, minWidth: 0 },
  // Four narrow columns held closer together than the row's own spacing, so
  // the extra one costs the team name as little width as it can.
  stats: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  played: { color: colors.textSecondary, fontFamily: theme.font.mono, fontVariant: ['tabular-nums'], textAlign: 'right', width: PLAYED_COLUMN },
  scores: { color: colors.textSecondary, fontFamily: theme.font.mono, fontVariant: ['tabular-nums'], textAlign: 'right', width: SCORES_COLUMN },
  // Small enough to stay out of the header's way; `hitSlop` gives the finger
  // the 44 points the drawing does not. The margin stands it off the label
  // rather than sitting on it: `nameSide` sets the gap for the rows too, so
  // widening that would have moved every rank and crest along with it.
  compare: { alignItems: 'center', borderColor: colors.border, borderRadius: theme.radius.pill, borderWidth: 1, height: COMPARE_CONTROL, justifyContent: 'center', marginLeft: theme.spacing.sm, width: COMPARE_CONTROL },
  compareOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pickedRow: { borderColor: colors.accent },
  hoveredRow: { backgroundColor: colors.surfaceRaised },
  archived: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.xs, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  archivedText: { color: colors.textMuted, flex: 1, fontSize: theme.type.caption },
  compareBar: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  comparePrompt: { color: colors.textSecondary, flex: 1, lineHeight: 20 },
  compareCancel: { minHeight: theme.touch.minimum, justifyContent: 'center' },
  compareCancelText: { color: colors.accentSoft, fontFamily: theme.font.bold },
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
  // The tick a picked row shows instead of its rank, on the rank's column so
  // the swap costs the row no width.
  rankSlot: { textAlign: 'center', width: RANK_COLUMN },
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
