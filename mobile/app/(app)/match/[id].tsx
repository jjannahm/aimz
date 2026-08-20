import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { FormationPitch } from '@/src/components/FormationPitch';
import { JerseyIcon } from '@/src/components/JerseyIcon';
import { MatchProgressRail, MatchStatusIndicator } from '@/src/components/MatchStatusIndicator';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { computeMinutesPlayed } from '@/src/lib/matchMinutes';
import { confirmAction, showMessage } from '@/src/lib/platformAlert';
import { useMatchClock } from '@/src/lib/matchClock';
import { theme } from '@/src/theme';

const eventLabel = { goal: 'Goal', assist: 'Assist', yellow_card: 'Yellow card', red_card: 'Red card', substitution: 'Substitution' } as const;

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const query = useQuery({ queryKey: ['live-match', id], queryFn: () => api.live(id), enabled: Boolean(id), refetchInterval: (state) => state.state.data?.match.status === 'finished' ? false : 12_000 });
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100') });
  const client = useQueryClient();
  // Finishing by hand always wins over the time-based phase calculation.
  const endMatch = useMutation({
    mutationFn: () => api.setMatchPhase(id, 'finish_match'),
    onSuccess: async () => { await invalidateAfterWrite(client, 'match'); },
    onError: (error) => showMessage('Match not ended', (error as ApiError).message),
  });
  const playerNames = new Map(players.data?.items.map((player) => [player.id, player.name]));
  const clock = useMatchClock(query.data?.match);
  return <Screen action={<Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={10} onPress={() => router.back()} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><Ionicons color={theme.colors.textPrimary} name="chevron-back" size={24} /></Pressable>} eyebrow="Match detail" title="Game centre">
    {query.isLoading ? <LoadingState label="Loading match" /> : query.isError || !query.data ? <ErrorState message={(query.error as ApiError)?.message ?? 'Match not found.'} onRetry={() => query.refetch()} /> : <>
      <View style={styles.hero}><View style={styles.statusRow}><MatchStatusIndicator clock={clock} muted={query.data.match.status !== 'live'} /><Text style={styles.competition}>{query.data.match.competition?.name}</Text></View><View style={styles.scoreRow}><View style={styles.team}><Text style={styles.teamName}>{query.data.match.home_team?.name}</Text></View><Text accessibilityLabel={`${query.data.match.home_score} to ${query.data.match.away_score}`} style={styles.score}>{query.data.match.home_score}–{query.data.match.away_score}</Text><View style={[styles.team, styles.away]}><Text style={[styles.teamName, styles.alignRight]}>{query.data.match.away_team?.name}</Text></View></View><Text style={styles.meta}>{new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(query.data.match.kickoff_datetime))} · {query.data.match.venue}</Text>{query.data.match.status === 'live' ? <MatchProgressRail clock={clock} /> : null}{user?.role === 'admin' ? <View style={styles.adminActions}><AppButton label={query.data.match.status === 'scheduled' ? 'Open match management' : 'Open live scoring'} onPress={() => router.push(`/live/${id}`)} />{query.data.match.status === 'live' ? <View style={styles.quickActions}><AppButton compact label="Log goal" onPress={() => router.push(`/live/${id}?event=goal`)} variant="secondary" /><AppButton compact label="Log substitution" onPress={() => router.push(`/live/${id}?event=substitution`)} variant="secondary" /></View> : null}{query.data.match.status === 'live' ? <AppButton disabled={endMatch.isPending} label={endMatch.isPending ? 'Ending…' : 'End match'} onPress={() => confirmAction('End this match now?', 'Final score will be locked in.', 'End match', () => endMatch.mutate())} variant="secondary" /> : null}</View> : null}</View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Timeline</Text>{query.data.events.length === 0 ? <Text style={styles.empty}>Match events will appear here.</Text> : query.data.events.map((event) => <View key={event.id} style={styles.event}><View style={styles.eventIcon}><Ionicons color={event.type === 'red_card' ? theme.colors.error : event.type === 'yellow_card' ? theme.colors.warning : theme.colors.lightBlue} name={event.type === 'substitution' ? 'swap-horizontal' : event.type.includes('card') ? 'square' : 'football'} size={18} /></View><View style={styles.eventCopy}><Text style={styles.eventTitle}>{eventLabel[event.type]}</Text><Text style={styles.eventPlayer}>{event.player_id ? playerNames.get(event.player_id) ?? 'Player' : query.data.match.home_team_id === event.team_id ? query.data.match.home_team?.name : query.data.match.away_team?.name}</Text></View><Text style={styles.minute}>{event.minute == null ? 'FT' : `${event.minute}'`}</Text></View>)}</View>
      <View style={styles.section}>
        <View style={styles.lineupHeader}>
          <Text style={styles.sectionTitle}>Lineups</Text>
          {query.data.match.lineup_format ? <Text style={styles.formatBadge}>{query.data.match.lineup_format}-a-side</Text> : null}
        </View>
        {(() => {
          // Who is actually on the pitch now, rather than who kicked off.
          const spells = computeMinutesPlayed(query.data.lineup, query.data.events, 999);
          const spellFor = (playerId: string) => spells.find((spell) => spell.playerId === playerId);
          const onPitch = (playerId: string) => { const spell = spellFor(playerId); return Boolean(spell) && spell!.offAt === null; };
          const cameOff = (playerId: string) => { const spell = spellFor(playerId); return Boolean(spell?.offAt !== null && spell); };
          const current = query.data.lineup.filter((entry) => onPitch(entry.player_id));
          const starters = current.length ? current : query.data.lineup.filter((entry) => entry.is_starter);
          const subs = query.data.lineup.filter((entry) => !onPitch(entry.player_id));
          const subsMade = query.data.events.filter((event) => event.type === 'substitution').length;
          const canEdit = user?.role === 'admin' && query.data.match.status === 'scheduled';
          const describe = (entry: typeof query.data.lineup[number]) => entry.position ?? 'Position not set';
          const asPlayer = (entry: typeof query.data.lineup[number]) => ({ id: entry.player_id, name: playerNames.get(entry.player_id) ?? 'Player', position: entry.position ?? '', jersey_number: entry.jersey_number } as never);
          const lineupTeamId = query.data.lineup[0]?.team_id;
          const sides = [query.data.match.home_team, query.data.match.away_team];
          const squad = sides.find((team) => team?.id === lineupTeamId) ?? sides.find((team) => team?.is_aimz) ?? null;
          const status = (entry: typeof query.data.lineup[number]) => {
            const spell = spellFor(entry.player_id);
            if (!spell) return null;
            if (spell.offAt !== null) return `Off ${spell.offAt}'`;
            if (!spell.started) return `On ${spell.onAt}'`;
            return null;
          };
          const row = (entry: typeof query.data.lineup[number]) => {
            const note = status(entry);
            return <View key={entry.id} style={styles.lineupRow}>
              <JerseyIcon number={entry.jersey_number} size={34} />
              <View style={styles.lineupCopy}><Text style={styles.lineupName}>{playerNames.get(entry.player_id) ?? 'Player'}</Text><Text style={styles.lineupMeta}>{describe(entry)}</Text></View>
              {note ? <Text style={[styles.swapNote, cameOff(entry.player_id) && styles.swapOff]}>{note}</Text> : null}
            </View>;
          };
          if (!query.data.lineup.length) {
            return <>
              <Text style={styles.empty}>No lineup has been entered.</Text>
              {canEdit ? <AppButton label="Set lineup" onPress={() => router.push(`/lineup/${id}`)} variant="secondary" /> : null}
            </>;
          }
          return <>
            {squad && (squad.coach || squad.assistant_coach || user?.role === 'admin') ? <View style={styles.staffRow}>
              <View style={styles.staff}><Text style={styles.staffLabel}>Coach</Text><Text numberOfLines={1} style={[styles.staffName, !squad.coach && styles.staffUnset]}>{squad.coach ?? 'Set in Manage'}</Text></View>
              <View style={styles.staff}><Text style={styles.staffLabel}>Assistant coach</Text><Text numberOfLines={1} style={[styles.staffName, !squad.assistant_coach && styles.staffUnset]}>{squad.assistant_coach ?? 'Set in Manage'}</Text></View>
            </View> : null}
            {starters.length ? <FormationPitch formation={query.data.match.formation} starters={starters.map(asPlayer)} /> : null}
            <Text style={styles.groupTitle}>{current.length ? 'On the pitch' : 'Starting'} {starters.length}</Text>
            {starters.map(row)}
            <Text style={styles.groupTitle}>Substitutes {subs.length ? `(${subs.length})` : ''}</Text>
            {subs.length ? subs.map(row) : <Text style={styles.empty}>No substitutes named.</Text>}
            {subsMade ? <Text style={styles.subsNote}>{subsMade} substitution{subsMade === 1 ? '' : 's'} made — see timeline.</Text> : null}
            {canEdit ? <AppButton label="Edit lineup" onPress={() => router.push(`/lineup/${id}`)} variant="secondary" /> : null}
          </>;
        })()}
      </View>
    </>}
  </Screen>;
}
const styles = StyleSheet.create({ swapNote: { color: theme.colors.liveText, fontSize: theme.type.caption, fontVariant: ['tabular-nums'], fontWeight: '900' }, swapOff: { color: theme.colors.textMuted }, quickActions: { flexDirection: 'row', gap: theme.spacing.sm }, staffRow: { flexDirection: 'row', gap: theme.spacing.sm }, staff: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flex: 1, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }, staffLabel: { color: theme.colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }, staffName: { color: theme.colors.textPrimary, fontWeight: '800', marginTop: 2 }, staffUnset: { color: theme.colors.textMuted, fontWeight: '600' }, lineupRow: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.md }, lineupCopy: { flex: 1 }, adminActions: { gap: theme.spacing.sm }, lineupHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' }, formatBadge: { backgroundColor: theme.colors.surfaceRaised, borderRadius: theme.radius.pill, color: theme.colors.lightBlue, fontSize: theme.type.caption, fontWeight: '900', overflow: 'hidden', paddingHorizontal: theme.spacing.sm, paddingVertical: 4 }, groupTitle: { color: theme.colors.textSecondary, fontSize: theme.type.label, fontWeight: '900', letterSpacing: 0.6, marginTop: theme.spacing.xs, textTransform: 'uppercase' }, subsNote: { color: theme.colors.textMuted, fontSize: theme.type.caption, marginTop: theme.spacing.xs }, back: { alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 }, pressed: { opacity: 0.7 }, hero: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.lg, padding: theme.spacing.lg }, statusRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, competition: { color: theme.colors.textSecondary, fontSize: theme.type.caption }, scoreRow: { alignItems: 'center', flexDirection: 'row' }, team: { flex: 1 }, away: { alignItems: 'flex-end' }, teamName: { color: theme.colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' }, alignRight: { textAlign: 'right' }, score: { color: theme.colors.textPrimary, fontSize: 48, fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: -2, marginHorizontal: theme.spacing.md }, meta: { color: theme.colors.textMuted, textAlign: 'center' }, section: { gap: theme.spacing.sm }, sectionTitle: { color: theme.colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, empty: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, color: theme.colors.textMuted, padding: theme.spacing.lg, textAlign: 'center' }, event: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 64, padding: theme.spacing.md }, eventIcon: { alignItems: 'center', backgroundColor: theme.colors.surfaceRaised, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, eventCopy: { flex: 1 }, eventTitle: { color: theme.colors.textPrimary, fontWeight: '800' }, eventPlayer: { color: theme.colors.textMuted, marginTop: 2 }, minute: { color: theme.colors.lightBlue, fontVariant: ['tabular-nums'], fontWeight: '900' }, lineup: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, padding: theme.spacing.md }, lineupName: { color: theme.colors.textPrimary, fontWeight: '800' }, lineupMeta: { color: theme.colors.textMuted, marginTop: 3 } });
