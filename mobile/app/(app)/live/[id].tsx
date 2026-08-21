import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { MatchProgressRail, MatchStatusIndicator } from '@/src/components/MatchStatusIndicator';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { computeMinutesPlayed } from '@/src/lib/matchMinutes';
import { formatMatchClock, useMatchClock } from '@/src/lib/matchClock';
import { confirmAction, showMessage } from '@/src/lib/platformAlert';
import { theme } from '@/src/theme';
import type { EventType, LiveMatchSnapshot, MatchEvent, MatchPhaseAction } from '@/src/types/api';

const eventOptions: { label: string; value: EventType; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: 'Goal', value: 'goal', icon: 'football' }, { label: 'Assist', value: 'assist', icon: 'sparkles-outline' }, { label: 'Yellow', value: 'yellow_card', icon: 'square' }, { label: 'Red', value: 'red_card', icon: 'square' }, { label: 'Sub', value: 'substitution', icon: 'swap-horizontal' },
];

export default function LiveScoringScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const client = useQueryClient();
  const matchQuery = useQuery({ queryKey: ['live-match', id], queryFn: () => api.live(id), enabled: Boolean(id), refetchInterval: 12_000 });
  const playersQuery = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100') });
  const [teamId, setTeamId] = useState(''); const [playerId, setPlayerId] = useState(''); const [minute, setMinute] = useState(''); const [eventType, setEventType] = useState<EventType>('goal'); const [isPenalty, setIsPenalty] = useState(false); const [offPlayerId, setOffPlayerId] = useState(''); const [minuteEdited, setMinuteEdited] = useState(false);
  const match = matchQuery.data?.match;
  const clock = useMatchClock(match);
  const eligiblePlayers = useMemo(() => playersQuery.data?.items.filter((player) => player.team_id === match?.home_team_id || player.team_id === match?.away_team_id) ?? [], [playersQuery.data, match]);
  useEffect(() => { if (match && !teamId) setTeamId(match.home_team_id); }, [match, teamId]);
  useEffect(() => { if (teamId && eligiblePlayers.every((player) => player.id !== playerId || player.team_id !== teamId)) setPlayerId(''); }, [teamId, eligiblePlayers, playerId]);
  const phaseMutation = useMutation({
    mutationFn: (action: MatchPhaseAction) => api.setMatchPhase(id, action),
    onError: (error) => showMessage('Match clock not updated', (error as ApiError).message),
    onSuccess: async (updated) => {
      client.setQueryData<LiveMatchSnapshot>(['live-match', id], (current) => current ? { ...current, match: updated, revision: updated.revision } : current);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidateAfterWrite(client, 'event');
    },
  });
  const addEventMutation = useMutation({
    mutationFn: () => api.createEvent(id, { type: eventType, minute: minute ? Number(minute) : null, team_id: teamId, player_id: playerId || null, secondary_player_id: eventType === 'substitution' ? offPlayerId || null : null, is_penalty: eventType === 'goal' && isPenalty, client_operation_id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }),
    onMutate: async () => { await client.cancelQueries({ queryKey: ['live-match', id] }); const previous = client.getQueryData<LiveMatchSnapshot>(['live-match', id]); if (previous) { const optimistic: MatchEvent = { id: `pending-${Date.now()}`, match_id: id, is_penalty: eventType === 'goal' && isPenalty, type: eventType, minute: minute ? Number(minute) : null, team_id: teamId, player_id: playerId || null, secondary_player_id: null, related_event_id: null, notes: null, client_operation_id: 'pending', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; client.setQueryData<LiveMatchSnapshot>(['live-match', id], { ...previous, events: [...previous.events, optimistic], match: { ...previous.match, home_score: previous.match.home_score + (eventType === 'goal' && teamId === previous.match.home_team_id ? 1 : 0), away_score: previous.match.away_score + (eventType === 'goal' && teamId === previous.match.away_team_id ? 1 : 0) } }); } return { previous }; },
    onError: (error, _variables, context) => { if (context?.previous) client.setQueryData(['live-match', id], context.previous); showMessage('Event not saved', (error as ApiError).message); },
    onSuccess: async () => { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setMinuteEdited(false); setIsPenalty(false); setOffPlayerId(''); await invalidateAfterWrite(client, 'event'); },
  });
  if (user?.role !== 'admin') return <Redirect href="/(app)/(tabs)" />;

  const elapsed = clock.currentMinute ?? 0;
  // The minute follows the clock until the admin corrects it, then it is theirs.
  useEffect(() => {
    if (minuteEdited || clock.currentMinute === null) return;
    setMinute(String(clock.currentMinute));
  }, [clock.currentMinute, minuteEdited]);
  const spells = useMemo(
    () => matchQuery.data ? computeMinutesPlayed(matchQuery.data.lineup, matchQuery.data.events, elapsed) : [],
    [matchQuery.data, elapsed],
  );
  const [savingMinutes, setSavingMinutes] = useState(false);
  const saveMinutes = async () => {
    setSavingMinutes(true);
    try {
      await api.stats(id, spells.map((spell) => ({ player_id: spell.playerId, appeared: true, minutes_played: Math.min(150, spell.minutes) })));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await invalidateAfterWrite(client, 'event');
      showMessage('Minutes saved', 'Player season totals now include this match.');
    } catch (error) {
      showMessage('Minutes not saved', (error as ApiError).message);
    } finally {
      setSavingMinutes(false);
    }
  };
  const deleteEvent = (event: MatchEvent) => confirmAction('Remove event?', 'The score and player totals will be recalculated.', 'Remove', async () => { try { await api.deleteEvent(id, event.id); await matchQuery.refetch(); } catch (error) { showMessage('Could not remove event', (error as ApiError).message); } });
  const confirmPhase = (title: string, message: string, action: MatchPhaseAction, actionLabel: string) => confirmAction(title, message, actionLabel, () => phaseMutation.mutate(action));
  const regulationSeconds = (match?.half_length_minutes ?? 45) * (match?.num_halves ?? 2) * 60;
  const secondHalfStart = formatMatchClock(regulationSeconds / 2);
  const extraTimeStart = formatMatchClock(regulationSeconds);
  const phaseControls = !match ? null : match.status === 'scheduled'
    ? <AppButton label="Start match" loading={phaseMutation.isPending} onPress={() => confirmPhase('Start match?', 'The first-half clock will begin immediately.', 'start_match', 'Start match')} />
    : clock.phase === 'first_half'
      ? <AppButton label="Halftime" loading={phaseMutation.isPending} onPress={() => confirmPhase('Call halftime?', 'The live clock will stop until you start the second half.', 'halftime', 'Halftime')} variant="secondary" />
      : clock.phase === 'halftime'
        ? <AppButton label="Start second half" loading={phaseMutation.isPending} onPress={() => confirmPhase('Start second half?', `The live clock will resume from ${secondHalfStart}.`, 'start_second_half', 'Start second half')} />
        : clock.phase === 'second_half'
          ? <View style={styles.phaseActions}>{match.has_extra_time ? <AppButton label="Start extra time" loading={phaseMutation.isPending} onPress={() => confirmPhase('Start extra time?', `The clock will restart from ${extraTimeStart}.`, 'start_extra_time', 'Start extra time')} style={styles.phaseButton} variant="secondary" /> : null}<AppButton label="Finish match" loading={phaseMutation.isPending} onPress={() => confirmPhase('Finish match?', 'Standings will update from this final score.', 'finish_match', 'Finish')} style={match.has_extra_time ? styles.phaseButton : undefined} variant="secondary" /></View>
          : clock.phase === 'extra_time'
            ? <AppButton label="Finish match" loading={phaseMutation.isPending} onPress={() => confirmPhase('Finish match?', 'Standings will update from this final score.', 'finish_match', 'Finish')} variant="secondary" />
            : <Text style={styles.finished}>Finished matches remain open for corrections.</Text>;
  return <Screen action={<Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={() => router.back()} style={styles.back}><Ionicons color={theme.colors.textPrimary} name="chevron-back" size={24} /></Pressable>} eyebrow="One-handed admin controls" title="Live scoring">
    {matchQuery.isLoading ? <LoadingState /> : matchQuery.isError || !match ? <ErrorState message={(matchQuery.error as ApiError)?.message ?? 'Match not found.'} onRetry={() => matchQuery.refetch()} /> : <>
      <View style={styles.scoreCard}><View style={styles.statusRow}><MatchStatusIndicator clock={clock} muted={match.status !== 'live'} /><Text style={styles.sync}>Revision {matchQuery.data?.revision}</Text></View><View style={styles.scoreRow}><Text style={styles.team}>{match.home_team?.name}</Text><Text style={styles.score}>{match.home_score}–{match.away_score}</Text><Text style={[styles.team, styles.away]}>{match.away_team?.name}</Text></View>{match.status === 'live' ? <MatchProgressRail clock={clock} /> : null}{phaseControls}</View>
      {match.status !== 'scheduled' ? <View style={styles.panel}><Text style={styles.heading}>Add event</Text><View style={styles.eventTypes}>{eventOptions.map((option) => <Pressable accessibilityRole="button" accessibilityState={{ selected: eventType === option.value }} key={option.value} onPress={() => setEventType(option.value)} style={({ pressed }) => [styles.eventType, eventType === option.value && styles.eventTypeActive, pressed && styles.pressed]}><Ionicons color={option.value === 'red_card' ? theme.colors.error : option.value === 'yellow_card' ? theme.colors.warning : eventType === option.value ? theme.colors.onAccent : theme.colors.textSecondary} name={option.icon} size={20} /><Text style={[styles.eventLabel, eventType === option.value && styles.eventLabelActive]}>{option.label}</Text></Pressable>)}</View><ChoiceField label="Team" onChange={setTeamId} options={[{ label: match.home_team?.name ?? 'Home', value: match.home_team_id }, { label: match.away_team?.name ?? 'Away', value: match.away_team_id }]} value={teamId} /><ChoiceField label={eventType === 'substitution' ? 'Coming on' : 'Player (optional)'} onChange={setPlayerId} options={[{ label: 'No player selected', value: '' }, ...eligiblePlayers.filter((player) => player.team_id === teamId).map((player) => ({ label: `#${player.jersey_number ?? '–'} ${player.name}`, value: player.id }))]} value={playerId} />{eventType === 'substitution' ? <ChoiceField label="Coming off" onChange={setOffPlayerId} options={[{ label: 'No player selected', value: '' }, ...eligiblePlayers.filter((player) => player.team_id === teamId).map((player) => ({ label: `#${player.jersey_number ?? '–'} ${player.name}`, value: player.id }))]} value={offPlayerId} /> : null}{eventType === 'goal' ? <Pressable accessibilityLabel="Scored from a penalty" accessibilityRole="checkbox" accessibilityState={{ checked: isPenalty }} onPress={() => setIsPenalty((current) => !current)} style={({ pressed }) => [styles.penaltyRow, isPenalty && styles.penaltyRowActive, pressed && styles.pressed]}><View style={[styles.penaltyBox, isPenalty && styles.penaltyBoxActive]}>{isPenalty ? <Ionicons color={theme.colors.onAccent} name="checkmark" size={16} /> : null}</View><View style={styles.penaltyCopy}><Text style={styles.penaltyLabel}>Scored from a penalty</Text><Text style={styles.penaltyHint}>Still counts on the scoreline</Text></View></Pressable> : null}<View><Text style={styles.inputLabel}>Minute{minuteEdited ? '' : ' · from the clock'}</Text><TextInput accessibilityLabel="Event minute" keyboardType="number-pad" maxLength={3} onChangeText={(value) => { setMinuteEdited(true); setMinute(value); }} placeholder="67" placeholderTextColor={theme.colors.textMuted} style={styles.input} value={minute} /></View><AppButton disabled={!teamId || addEventMutation.isPending} label={addEventMutation.isPending ? 'Saving event' : `Add ${eventOptions.find((option) => option.value === eventType)?.label}`} onPress={() => addEventMutation.mutate()} /></View> : null}
      <View style={styles.panel}><Text style={styles.heading}>Timeline corrections</Text>{matchQuery.data?.events.length ? matchQuery.data.events.map((event) => <View key={event.id} style={styles.event}><View style={styles.eventCopy}><Text style={styles.eventTitle}>{event.type.replaceAll('_', ' ')}</Text><Text style={styles.eventMeta}>{event.minute == null ? 'Minute not recorded' : `${event.minute}'`} · {eligiblePlayers.find((player) => player.id === event.player_id)?.name ?? 'Team event'}</Text></View>{!event.id.startsWith('pending-') ? <AppButton compact label="Undo" onPress={() => deleteEvent(event)} variant="danger" /> : <Text style={styles.sync}>Syncing</Text>}</View>) : <Text style={styles.finished}>No events recorded.</Text>}</View>
      <View style={styles.panel}>
        <Text style={styles.heading}>Lineup and minutes</Text>
        {matchQuery.data?.lineup.length ? <>
          <Text style={styles.help}>Minutes come from the match clock. Log a substitution to stop a player's clock.</Text>
          {spells.length ? spells.map((spell) => <View key={spell.playerId} style={styles.rosterRow}>
            <View style={styles.eventCopy}>
              <Text style={styles.eventTitle}>{eligiblePlayers.find((player) => player.id === spell.playerId)?.name ?? 'Player'}</Text>
              <Text style={styles.eventMeta}>{spell.started ? 'Started' : `On ${spell.onAt}'`}{spell.offAt === null ? '' : ` · Off ${spell.offAt}'`}</Text>
            </View>
            <Text style={styles.minuteValue}>{spell.minutes}'</Text>
          </View>) : <Text style={styles.finished}>Nobody has taken the pitch yet.</Text>}
          <AppButton disabled={!spells.length || savingMinutes} label={savingMinutes ? 'Saving…' : 'Save minutes to player stats'} onPress={saveMinutes} variant="secondary" />
        </> : <>
          <Text style={styles.help}>No lineup has been set for this match.</Text>
          <AppButton label="Set lineup" onPress={() => router.push(`/lineup/${id}`)} variant="secondary" />
        </>}
      </View>
    </>}
  </Screen>;
}
const styles = StyleSheet.create({ minuteValue: { color: theme.colors.lightBlue, fontSize: theme.type.heading, fontVariant: ['tabular-nums'], fontWeight: '900', minWidth: 52, textAlign: 'right' }, penaltyRow: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }, penaltyRowActive: { borderColor: theme.colors.accent }, penaltyBox: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: 6, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 }, penaltyBoxActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }, penaltyCopy: { flex: 1 }, penaltyLabel: { color: theme.colors.textPrimary, fontWeight: '800' }, penaltyHint: { color: theme.colors.textMuted, fontSize: theme.type.caption, marginTop: 2 }, back: { alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 22, height: 44, justifyContent: 'center', width: 44 }, scoreCard: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.lg, padding: theme.spacing.lg }, statusRow: { flexDirection: 'row', justifyContent: 'space-between' }, sync: { color: theme.colors.textMuted, fontSize: theme.type.caption }, scoreRow: { alignItems: 'center', flexDirection: 'row' }, team: { color: theme.colors.textPrimary, flex: 1, fontWeight: '800' }, away: { textAlign: 'right' }, score: { color: theme.colors.textPrimary, fontSize: 48, fontVariant: ['tabular-nums'], fontWeight: '900', marginHorizontal: theme.spacing.sm }, phaseActions: { flexDirection: 'row', gap: theme.spacing.sm }, phaseButton: { flex: 1 }, finished: { color: theme.colors.textMuted, lineHeight: 22, textAlign: 'center' }, panel: { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg }, heading: { color: theme.colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, eventTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }, eventType: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexGrow: 1, gap: 4, justifyContent: 'center', minHeight: 60, minWidth: '29%', padding: theme.spacing.sm }, eventTypeActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }, eventLabel: { color: theme.colors.textSecondary, fontSize: theme.type.caption, fontWeight: '800' }, eventLabelActive: { color: theme.colors.onAccent }, pressed: { opacity: 0.7 }, inputLabel: { color: theme.colors.textSecondary, fontSize: theme.type.label, fontWeight: '700', marginBottom: theme.spacing.xs }, input: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: theme.colors.textPrimary, fontSize: theme.type.body, minHeight: 52, paddingHorizontal: theme.spacing.md }, event: { alignItems: 'center', backgroundColor: theme.colors.surface, borderColor: theme.colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md }, eventCopy: { flex: 1 }, eventTitle: { color: theme.colors.textPrimary, fontWeight: '800', textTransform: 'capitalize' }, eventMeta: { color: theme.colors.textMuted, marginTop: 3 }, help: { color: theme.colors.textMuted, lineHeight: 21 }, rosterRow: { alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 64, padding: theme.spacing.sm }, check: { alignItems: 'center', borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 }, checkActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }, minuteInput: { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border, borderRadius: theme.radius.sm, borderWidth: 1, color: theme.colors.textPrimary, height: 44, textAlign: 'center', width: 54 } });
