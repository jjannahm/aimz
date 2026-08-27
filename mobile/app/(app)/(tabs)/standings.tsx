import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { BracketView } from '@/src/components/BracketView';
import { Screen } from '@/src/components/Screen';
import { EmptyState, ErrorState, LoadingState } from '@/src/components/StateView';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { api, ApiError } from '@/src/lib/api';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { showMessage } from '@/src/lib/platformAlert';
import { isKnockout, type BracketSlot, type Competition, type FormResult, type StandingRow } from '@/src/types/api';

// A five-match strip under the team name: the row is too tight for another column.
function FormStrip({ form }: { form: FormResult[] }) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  if (!form.length) return null;
  const tint: Record<FormResult, string> = { W: colors.live, D: colors.textMuted, L: colors.error };
  const spoken = form.map((result) => ({ W: 'won', D: 'drew', L: 'lost' })[result]).join(', ');
  return <View accessibilityLabel={`Recent form: ${spoken}`} style={styles.form}>
    {form.map((result, index) => <View key={index} style={[styles.formDot, { backgroundColor: tint[result] }]}>
      <Text accessibilityElementsHidden style={styles.formLetter}>{result}</Text>
    </View>)}
  </View>;
}

function CompetitionHeader({ competition }: { competition: Competition }) {
  const styles = useThemedStyles(stylesheet);
  return <View accessibilityLabel={`${competition.name}, season ${competition.season}`} style={styles.headerCard}>
    <View style={styles.headerCopy}>
      <Text numberOfLines={1} style={styles.headerName}>{competition.name}</Text>
      <Text numberOfLines={1} style={styles.headerSeason}>{competition.season}</Text>
    </View>
  </View>;
}

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
  // Tapping a team picks it, then a second team compares the two.
  const [comparing, setComparing] = useState<{ teamId: string; opponentId: string | null } | null>(null);
  const setOpponentsFor = (teamId: string) => setComparing((current) =>
    current === null || current.teamId === teamId ? { teamId, opponentId: null } : { teamId: current.teamId, opponentId: teamId });

  return <Screen title="Standings">
    {/* Only worth a switcher when more than one competition is running. */}
    {eligible.length > 1 ? <ScrollView contentContainerStyle={styles.tabs} horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
      {eligible.map((item) => {
        const active = item.id === competitionId;
        return <Pressable accessibilityLabel={item.name} accessibilityRole="tab" accessibilityState={{ selected: active }} key={item.id} onPress={() => setSelected(item.id)} style={({ pressed }) => [styles.tab, active && styles.activeTab, pressed && styles.pressed]}>
          <Text style={[styles.tabLabel, active && styles.activeLabel]}>{item.name}</Text>
        </Pressable>;
      })}
    </ScrollView> : null}
    {competition ? <CompetitionHeader competition={competition} /> : null}
    {knockout ? <View accessibilityRole="tablist" style={styles.viewToggle}>{([['groups', 'Groups'], ['bracket', 'Bracket']] as const).map(([value, label]) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === value }} key={value} onPress={() => setView(value)} style={({ pressed }) => [styles.viewTab, view === value && styles.activeTab, pressed && styles.pressed]}><Text style={[styles.tabLabel, view === value && styles.activeLabel]}>{label}</Text></Pressable>)}</View> : null}
    {comparing ? (comparing.opponentId
      ? <HeadToHead onClose={() => setComparing(null)} opponentId={comparing.opponentId} teamId={comparing.teamId} />
      : <View style={styles.h2h}><Text style={styles.h2hPrompt}>Pick another team to compare with {table.data?.find((row) => row.team.id === comparing.teamId)?.team.name ?? 'this team'}.</Text></View>) : null}
    {competitions.isLoading || table.isLoading ? <LoadingState label="Calculating table" /> : competitions.isError || table.isError ? <ErrorState message={(competitions.error as ApiError | null)?.message ?? (table.error as ApiError | null)?.message ?? 'Could not load standings.'} onRetry={() => { competitions.refetch(); table.refetch(); }} /> : knockout && view === 'bracket' ? (bracket.data?.rounds.length ? <BracketView bracket={bracket.data} busy={draw.isPending || pickWinner.isPending} onAdvance={user?.role === 'admin' ? (round) => draw.mutate(round) : undefined} onPickWinner={user?.role === 'admin' ? (slot, teamId) => pickWinner.mutate({ slot, teamId }) : undefined} /> : <EmptyState body="The bracket appears once the competition is drawn." title="No bracket yet" />)
      : !competitionId || !table.data?.length ? <EmptyState body="Finished matches will create the table automatically." title="No standings yet" />
      : knockout ? <View style={styles.groups}>{groupedRows.map((group) => <View key={group.name} style={styles.group}><Text style={styles.groupName}>{group.name}</Text>{tableFor(group.rows)}</View>)}</View>
      : tableFor(table.data)}
  </Screen>;

  function tableFor(rows: StandingRow[]) {
    return <View style={styles.table}>
      <View style={styles.tableHeader}>
        <Text style={styles.rankHeader}>#</Text>
        <Text style={[styles.team, styles.headerText]}>TEAM</Text>
        <Text style={[styles.stat, styles.headerText]}>P</Text>
        <Text style={[styles.stat, styles.headerText]}>GD</Text>
        <Text style={[styles.stat, styles.headerText]}>PTS</Text>
      </View>
      {rows.map((row: StandingRow, index: number) => <Pressable accessibilityHint="Opens head-to-head records against the other teams" accessibilityLabel={`${row.team.name}, ${row.points} points`} accessibilityRole="button" key={row.team.id} onPress={() => setOpponentsFor(row.team.id)} style={({ pressed }) => [styles.row, index % 2 === 1 && styles.altRow, row.team.is_aimz && styles.aimzRow, row.rank === 1 && styles.leaderRow, pressed && styles.pressed]}>
        <Text style={[styles.rank, row.rank === 1 && styles.leaderRank]}>{row.rank}</Text>
        <View style={styles.teamCell}>
          <TeamAvatar isAimz={row.team.is_aimz} logoUrl={row.team.logo_url} name={row.team.name} size={34} />
          <View style={styles.team}>
            <View style={styles.nameRow}>
              <Text numberOfLines={1} style={[styles.teamName, row.rank === 1 && styles.leaderName]}>{row.team.name}</Text>
              {row.rank === 1 ? <Ionicons accessibilityLabel="First place" color={colors.leaderAccent} name="trophy" size={16} /> : null}
            </View>
            {row.team.squad_code ? <Text numberOfLines={1} style={styles.code}>{row.team.squad_code}</Text> : null}
            <FormStrip form={row.form ?? []} />
          </View>
        </View>
        <Text style={styles.stat}>{row.played}</Text>
        <Text style={styles.stat}>{row.goal_difference > 0 ? '+' : ''}{row.goal_difference}</Text>
        <Text style={[styles.stat, styles.points, row.rank === 1 && styles.leaderPoints]}>{row.points}</Text>
      </Pressable>)}
    </View>;
  }
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  tabBar: { flexGrow: 0 },
  viewToggle: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', padding: theme.spacing.xs },
  viewTab: { alignItems: 'center', borderRadius: theme.radius.sm, flex: 1, justifyContent: 'center', minHeight: theme.touch.minimum },
  groups: { gap: theme.spacing.lg },
  group: { gap: theme.spacing.sm },
  groupName: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  tabs: { gap: theme.spacing.sm },
  tab: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, justifyContent: 'center', minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md },
  activeTab: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabLabel: { color: colors.textSecondary, fontWeight: '800' },
  activeLabel: { color: colors.onAccent, fontWeight: '900' },
  headerCard: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 80, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  headerCopy: { flex: 1, gap: 2 },
  headerName: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '900' },
  headerSeason: { color: colors.textMuted, fontSize: theme.type.label },
  pressed: { opacity: 0.7 },
  form: { flexDirection: 'row', gap: 3, marginTop: 4 },
  formDot: { alignItems: 'center', borderRadius: 3, height: 14, justifyContent: 'center', width: 14 },
  formLetter: { color: colors.background, fontSize: 9, fontWeight: '900' },
  h2h: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.sm, padding: theme.spacing.md },
  h2hHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  h2hTitle: { color: colors.textPrimary, flex: 1, fontWeight: '900' },
  h2hClose: { alignItems: 'center', height: theme.touch.minimum, justifyContent: 'center', width: theme.touch.minimum },
  h2hRecord: { color: colors.accentSoft, fontVariant: ['tabular-nums'], fontWeight: '900' },
  h2hRow: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: theme.spacing.xs },
  h2hFixture: { color: colors.textPrimary, fontSize: theme.type.label },
  h2hDate: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: 2 },
  h2hEmpty: { color: colors.textMuted, lineHeight: 21 },
  h2hPrompt: { color: colors.textSecondary, lineHeight: 21 },
  table: { borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, overflow: 'hidden' },
  tableHeader: { alignItems: 'center', backgroundColor: colors.surfaceRaised, flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  headerText: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', letterSpacing: 0.6 },
  rankHeader: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', width: 22 },
  row: { alignItems: 'center', backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 62, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  altRow: { backgroundColor: colors.surfaceRaised },
  aimzRow: { backgroundColor: colors.highlightedSurface },
  leaderRow: { backgroundColor: colors.leaderSurface, borderLeftColor: colors.leaderAccent, borderLeftWidth: 4 },
  rank: { color: colors.textMuted, fontVariant: ['tabular-nums'], fontWeight: '800', width: 22 },
  leaderRank: { color: colors.leaderAccent, fontWeight: '900' },
  teamCell: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.sm },
  team: { flex: 1 },
  nameRow: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.xs },
  teamName: { color: colors.textPrimary, flexShrink: 1, fontWeight: '800' },
  leaderName: { fontWeight: '900' },
  leaderPoints: { color: colors.leaderAccent },
  code: { color: colors.accentSoft, fontSize: theme.type.caption, marginTop: 2 },
  stat: { color: colors.textSecondary, fontVariant: ['tabular-nums'], textAlign: 'right', width: 38 },
  points: { color: colors.textPrimary, fontWeight: '900' },
});
