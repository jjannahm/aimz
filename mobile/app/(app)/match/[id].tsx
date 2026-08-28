import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { AssignmentsPanel } from '@/src/components/AssignmentsPanel';
import { CloseButton } from '@/src/components/CloseButton';
import { CollapsibleSection } from '@/src/components/CollapsibleSection';
import { ScoreLine } from '@/src/components/ScoreLine';
import { FormationPitch } from '@/src/components/FormationPitch';
import { JerseyIcon } from '@/src/components/JerseyIcon';
import { MatchProgressRail, MatchStatusIndicator } from '@/src/components/MatchStatusIndicator';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { computeMinutesPlayed } from '@/src/lib/matchMinutes';
import { useMatchClock } from '@/src/lib/matchClock';
import { isOpponentOnly } from '@/src/lib/matchKind';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

import { PENALTY_OUTCOMES, SUBSTITUTION_REASONS } from '@/src/types/api';
import type { MatchEvent } from '@/src/types/api';

const eventLabel = { goal: 'Goal', assist: 'Assist', own_goal: 'Own goal', penalty_missed: 'Penalty missed', yellow_card: 'Yellow card', red_card: 'Red card', substitution: 'Substitution' } as const;
const reasonLabel = new Map(SUBSTITUTION_REASONS.map((option) => [option.value, option.label]));
const outcomeLabel = new Map(PENALTY_OUTCOMES.map((option) => [option.value, option.label]));

// An own goal is filed against the team that conceded it, so the timeline says
// which side it counted for rather than leaving it looking like a normal goal.
function eventIcon(type: MatchEvent['type']): keyof typeof Ionicons.glyphMap {
  if (type === 'substitution') return 'swap-horizontal';
  if (type.includes('card')) return 'square';
  if (type === 'own_goal') return 'football-outline';
  return type === 'penalty_missed' ? 'close-circle-outline' : 'football';
}

export default function MatchDetailScreen() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const query = useQuery({ queryKey: ['live-match', id], queryFn: () => api.live(id), enabled: Boolean(id), refetchInterval: (state) => state.state.data?.match.status === 'finished' ? false : 12_000 });
  const players = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100') });
  const playerNames = new Map(players.data?.items.map((player) => [player.id, player.name]));
  const clock = useMatchClock(query.data?.match);
  const opponentOnly = isOpponentOnly(query.data?.match);
  return <Screen action={<CloseButton />} title="Game centre">
    {query.isLoading ? <LoadingState label="Loading match" /> : query.isError || !query.data ? <ErrorState message={(query.error as ApiError)?.message ?? 'Match not found.'} onRetry={() => query.refetch()} /> : <>
      <View style={styles.hero}><View style={styles.statusRow}><MatchStatusIndicator clock={clock} muted={query.data.match.status !== 'live'} /><Text style={styles.competition}>{query.data.match.competition?.name}</Text></View><View style={styles.scoreRow}><View style={styles.team}><Text style={styles.teamName}>{query.data.match.home_team?.name}</Text></View><ScoreLine away={query.data.match.away_score} home={query.data.match.home_score} /><View style={[styles.team, styles.away]}><Text style={[styles.teamName, styles.alignRight]}>{query.data.match.away_team?.name}</Text></View></View><Text style={styles.meta}>{new Intl.DateTimeFormat('en-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(query.data.match.kickoff_datetime))} · {query.data.match.venue}</Text>{query.data.match.status === 'live' ? <MatchProgressRail clock={clock} /> : null}
      {!opponentOnly || query.data.events.length ? <View style={styles.timeline}><Text style={styles.timelineTitle}>Timeline</Text>{query.data.events.length === 0 ? <Text style={[styles.empty, styles.timelineEmpty]}>Match events will appear here.</Text> : query.data.events.map((event) => {
        const teamName = query.data.match.home_team_id === event.team_id ? query.data.match.home_team?.name : query.data.match.away_team?.name;
        const lead = event.player_id ? playerNames.get(event.player_id) ?? 'Player' : teamName;
        // A goal owns its assist, so the provider sits under the scorer rather
        // than arriving as a row of its own.
        const assist = event.type === 'goal' && event.secondary_player_id ? playerNames.get(event.secondary_player_id) : null;
        const cameOff = event.type === 'substitution' && event.secondary_player_id ? playerNames.get(event.secondary_player_id) : null;
        return <View key={event.id} style={[styles.event, styles.eventCompact]}>
          <View style={[styles.eventIcon, styles.eventIconCompact]}><Ionicons color={event.type === 'red_card' || event.type === 'own_goal' ? colors.error : event.type === 'yellow_card' ? colors.warning : event.type === 'penalty_missed' ? colors.textMuted : colors.accentSoft} name={eventIcon(event.type)} size={15} /></View>
          <View style={styles.eventCopy}>
            <Text style={[styles.eventTitle, styles.compactText]}>{lead}{event.type === 'goal' && event.is_penalty ? ' (pen)' : ''}</Text>
            {assist ? <Text style={[styles.eventAssist, styles.compactSubText]}>Assist: {assist}</Text> : null}
            {cameOff ? <Text style={[styles.eventAssist, styles.compactSubText]}>Off: {cameOff}</Text> : null}
            {event.type === 'substitution' && event.substitution_reason ? <Text style={[styles.eventAssist, styles.compactSubText]}>Reason: {reasonLabel.get(event.substitution_reason) ?? event.substitution_reason}</Text> : null}
            {event.type === 'penalty_missed' && event.penalty_outcome ? <Text style={[styles.eventAssist, styles.compactSubText]}>{outcomeLabel.get(event.penalty_outcome) ?? event.penalty_outcome}</Text> : null}
            {event.type === 'goal' ? null : <Text style={[styles.eventPlayer, styles.compactSubText]}>{eventLabel[event.type]}{event.type === 'own_goal' ? ` for ${event.team_id === query.data.match.home_team_id ? query.data.match.away_team?.name : query.data.match.home_team?.name}` : ''}</Text>}
          </View>
          <Text style={[styles.minute, styles.compactText]}>{event.minute == null ? 'FT' : `${event.minute}'`}</Text>
        </View>;
      })}</View> : <Text style={styles.intentionalEmpty}>No team sheet or timeline is recorded for matches between two opponent clubs.</Text>}
      {query.data.match.man_of_the_match_player_id ? <View style={styles.award}>
        <Ionicons color={colors.leaderAccent} name="trophy" size={18} />
        <View style={styles.eventCopy}><Text style={styles.awardLabel}>Man of the match</Text><Text style={styles.awardName}>{playerNames.get(query.data.match.man_of_the_match_player_id) ?? 'Player'}</Text></View>
      </View> : null}
      {user?.role === 'admin' ? <View style={styles.adminActions}><AppButton label={opponentOnly ? query.data.match.status === 'finished' ? 'Edit final score' : 'Enter final score' : query.data.match.status === 'scheduled' ? 'Open match management' : 'Open live scoring'} onPress={() => router.push({ pathname: opponentOnly ? '/result/[id]' : '/live/[id]', params: { id } })} /></View> : null}
      </View>
      {(() => {
        if (opponentOnly && !query.data.lineup.length) return null;
        const lineupTeamId = query.data.lineup[0]?.team_id;
        const sides = [query.data.match.home_team, query.data.match.away_team];
        const squad = sides.find((team) => team?.id === lineupTeamId) ?? sides.find((team) => team?.is_aimz) ?? null;
        const spells = computeMinutesPlayed(query.data.lineup, query.data.events, 999);
        const onPitch = (playerId: string) => { const spell = spells.find((item) => item.playerId === playerId); return Boolean(spell) && spell!.offAt === null; };
        const current = query.data.lineup.filter((entry) => onPitch(entry.player_id));
        const starters = current.length ? current : query.data.lineup.filter((entry) => entry.is_starter);
        if (!starters.length) return null;
        const asPlayer = (entry: typeof query.data.lineup[number]) => ({ id: entry.player_id, name: playerNames.get(entry.player_id) ?? 'Player', position: entry.position ?? '', jersey_number: entry.jersey_number } as never);
        return <View style={styles.section}>
          <FormationPitch captainId={query.data.lineup.find((entry) => entry.is_captain)?.player_id ?? null} formation={query.data.match.formation} starters={starters.map(asPlayer)} />
          {squad && (squad.coach || squad.assistant_coach || user?.role === 'admin') ? <View style={styles.staffRow}>
            <View style={styles.staff}><Text style={styles.staffLabel}>Coach</Text><Text numberOfLines={1} style={[styles.staffName, !squad.coach && styles.staffUnset]}>{squad.coach ?? 'Set in Manage'}</Text></View>
            <View style={styles.staff}><Text style={styles.staffLabel}>Assistant coach</Text><Text numberOfLines={1} style={[styles.staffName, !squad.assistant_coach && styles.staffUnset]}>{squad.assistant_coach ?? 'Set in Manage'}</Text></View>
          </View> : null}
        </View>;
      })()}
      {!opponentOnly || query.data.lineup.length ? <View style={styles.section}>
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
              <View style={styles.lineupCopy}><Text style={styles.lineupName}>{playerNames.get(entry.player_id) ?? 'Player'}{entry.is_captain ? ' (C)' : ''}</Text><Text style={styles.lineupMeta}>{describe(entry)}</Text></View>
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
            <CollapsibleSection count={starters.length} defaultOpen size="group" title={current.length ? 'On the pitch' : 'Starting'}>
              {starters.map(row)}
            </CollapsibleSection>
            <CollapsibleSection count={subs.length} size="group" title="Substitutes">
              {subs.length ? subs.map(row) : <Text style={styles.empty}>No substitutes named.</Text>}
            </CollapsibleSection>
            {subsMade ? <Text style={styles.subsNote}>{subsMade} substitution{subsMade === 1 ? '' : 's'} made — see timeline.</Text> : null}
            {canEdit ? <AppButton label="Edit lineup" onPress={() => router.push(`/lineup/${id}`)} variant="secondary" /> : null}
          </>;
        })()}
      </View> : null}
      <AssignmentsPanel eligibleTeamIds={[query.data.match.home_team, query.data.match.away_team].filter((team) => team?.is_aimz).map((team) => team!.id)} eventId={id} kind="match" />
    </>}
  </Screen>;
}
const stylesheet = (colors: ThemeColors) => StyleSheet.create({ swapNote: { color: colors.liveText, fontSize: theme.type.caption, fontVariant: ['tabular-nums'], fontWeight: '900' }, swapOff: { color: colors.textMuted }, intentionalEmpty: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: colors.textMuted, lineHeight: 22, padding: theme.spacing.md, textAlign: 'center' }, award: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.md }, awardLabel: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }, awardName: { color: colors.textPrimary, fontWeight: '900', marginTop: 2 }, staffRow: { flexDirection: 'row', gap: theme.spacing.sm }, staff: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flex: 1, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }, staffLabel: { color: colors.textMuted, fontSize: theme.type.caption, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }, staffName: { color: colors.textPrimary, fontWeight: '800', marginTop: 2 }, staffUnset: { color: colors.textMuted, fontWeight: '600' }, lineupRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, padding: theme.spacing.md }, lineupCopy: { flex: 1 }, adminActions: { gap: theme.spacing.sm }, lineupHeader: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' }, formatBadge: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius.pill, color: colors.accentSoft, fontSize: theme.type.caption, fontWeight: '900', overflow: 'hidden', paddingHorizontal: theme.spacing.sm, paddingVertical: 4 }, subsNote: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: theme.spacing.xs }, hero: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.lg, padding: theme.spacing.lg }, timeline: { gap: theme.spacing.xs }, timelineTitle: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '800', letterSpacing: 0.6, marginBottom: 2, textTransform: 'uppercase' }, timelineEmpty: { fontSize: theme.type.label, padding: theme.spacing.md }, eventCompact: { gap: theme.spacing.sm, minHeight: 48, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.xs }, eventIconCompact: { borderRadius: 15, height: 30, width: 30 }, compactText: { fontSize: theme.type.label }, compactSubText: { fontSize: theme.type.caption, marginTop: 1 }, statusRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, competition: { color: colors.textSecondary, fontSize: theme.type.caption }, scoreRow: { alignItems: 'center', flexDirection: 'row' }, team: { flex: 1 }, away: { alignItems: 'flex-end' }, teamName: { color: colors.textPrimary, fontSize: theme.type.body, fontWeight: '800' }, alignRight: { textAlign: 'right' }, meta: { color: colors.textMuted, textAlign: 'center' }, section: { gap: theme.spacing.sm }, sectionTitle: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, empty: { backgroundColor: colors.surface, borderRadius: theme.radius.md, color: colors.textMuted, padding: theme.spacing.lg, textAlign: 'center' }, event: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: 64, padding: theme.spacing.md }, eventIcon: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, eventCopy: { flex: 1 }, eventTitle: { color: colors.textPrimary, fontWeight: '800' }, eventPlayer: { color: colors.textMuted, marginTop: 2 }, eventAssist: { color: colors.textSecondary, fontSize: theme.type.label, marginTop: 2 }, minute: { color: colors.accentSoft, fontVariant: ['tabular-nums'], fontWeight: '900' }, lineupName: { color: colors.textPrimary, fontWeight: '800' }, lineupMeta: { color: colors.textMuted, marginTop: 3 } });
