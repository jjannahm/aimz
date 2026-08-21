import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/src/auth/AuthProvider';
import { AppButton } from '@/src/components/AppButton';
import { CardIcon, cardPalette, CardsIcon } from '@/src/components/CardIcon';
import { CloseButton } from '@/src/components/CloseButton';
import { ChoiceField } from '@/src/components/ChoiceField';
import { MatchProgressRail, MatchStatusIndicator } from '@/src/components/MatchStatusIndicator';
import { ScoreLine } from '@/src/components/ScoreLine';
import { Screen } from '@/src/components/Screen';
import { ErrorState, LoadingState } from '@/src/components/StateView';
import { api, ApiError } from '@/src/lib/api';
import { invalidateAfterWrite } from '@/src/lib/cache';
import { computeMinutesPlayed } from '@/src/lib/matchMinutes';
import { formatMatchClock, useMatchClock } from '@/src/lib/matchClock';
import { confirmAction, showMessage } from '@/src/lib/platformAlert';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { EventType, LiveMatchSnapshot, MatchEvent, MatchPhaseAction } from '@/src/types/api';

type CardType = Extract<EventType, 'yellow_card' | 'red_card'>;
type EventGroup = Exclude<EventType, CardType> | 'cards';

// A caution and a sending-off are the same entry with a different card, so they
// share one button and the card is picked inside it.
const eventGroups: { label: string; value: EventGroup; icon?: keyof typeof Ionicons.glyphMap }[] = [
  { label: 'Goal', value: 'goal', icon: 'football' }, { label: 'Cards', value: 'cards' }, { label: 'Sub', value: 'substitution', icon: 'swap-horizontal' },
];
const cardChoices: { label: string; value: CardType }[] = [
  { label: 'Yellow', value: 'yellow_card' }, { label: 'Red', value: 'red_card' },
];

export default function LiveScoringScreen() {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const client = useQueryClient();
  const matchQuery = useQuery({ queryKey: ['live-match', id], queryFn: () => api.live(id), enabled: Boolean(id), refetchInterval: 12_000 });
  const playersQuery = useQuery({ queryKey: ['players'], queryFn: () => api.players('?limit=100') });
  const [teamId, setTeamId] = useState(''); const [playerId, setPlayerId] = useState(''); const [minute, setMinute] = useState(''); const [group, setGroup] = useState<EventGroup>('goal'); const [cardType, setCardType] = useState<CardType | null>(null); const [isPenalty, setIsPenalty] = useState(false); const [offPlayerId, setOffPlayerId] = useState(''); const [minuteEdited, setMinuteEdited] = useState(false);
  const selectedCard = group === 'cards' ? cardChoices.find((choice) => choice.value === cardType) : undefined;
  // Cards submit as the card that was picked; every other group is its own type.
  // The fallback only stands in while the picker is still open, and the form —
  // the only way to submit — is hidden until a card is chosen.
  const eventType: EventType = group === 'cards' ? cardType ?? 'yellow_card' : group;
  const awaitingCard = group === 'cards' && cardType === null;
  const cardTint = (card: CardType) => card === 'red_card' ? cardPalette.red : cardPalette.yellow;
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
    mutationFn: () => api.createEvent(id, { type: eventType, minute: minute ? Number(minute) : null, team_id: teamId, player_id: playerId || null, secondary_player_id: eventType === 'substitution' || eventType === 'goal' ? offPlayerId || null : null, is_penalty: eventType === 'goal' && isPenalty, client_operation_id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }),
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
  const deleteEvent = (event: MatchEvent) => confirmAction('Remove event?', 'The score and player totals will be recalculated.', 'Remove', async () => { try { await api.deleteEvent(id, event.id); await matchQuery.refetch(); } catch (error) { showMessage('Could not remove event', (error as ApiError).message); } }, { destructive: true });
  const confirmPhase = (title: string, message: string, action: MatchPhaseAction, actionLabel: string, destructive = false) =>
    confirmAction(title, message, actionLabel, () => phaseMutation.mutate(action), { destructive });
  const regulationSeconds = (match?.half_length_minutes ?? 45) * (match?.num_halves ?? 2) * 60;
  const secondHalfStart = formatMatchClock(regulationSeconds / 2);
  const extraTimeStart = formatMatchClock(regulationSeconds);
  const endMatch = <AppButton label="End match" loading={phaseMutation.isPending} onPress={() => confirmPhase('End this match now?', 'Standings will update from this final score.', 'finish_match', 'End match', true)} variant="danger" />;
  const phaseControls = !match ? null : match.status === 'scheduled'
    ? <AppButton label="Start match" loading={phaseMutation.isPending} onPress={() => confirmPhase('Start match?', 'The first-half clock will begin immediately.', 'start_match', 'Start match')} />
    : clock.phase === 'first_half'
      ? <View style={styles.phaseStack}><AppButton label="Halftime" loading={phaseMutation.isPending} onPress={() => confirmPhase('Call halftime?', 'The live clock will stop until you start the second half.', 'halftime', 'Halftime')} variant="secondary" />{endMatch}</View>
      : clock.phase === 'halftime'
        ? <View style={styles.phaseStack}><AppButton label="Start second half" loading={phaseMutation.isPending} onPress={() => confirmPhase('Start second half?', `The live clock will resume from ${secondHalfStart}.`, 'start_second_half', 'Start second half')} />{endMatch}</View>
        : clock.phase === 'second_half'
          ? <View style={styles.phaseStack}>{match.has_extra_time ? <AppButton label="Start extra time" loading={phaseMutation.isPending} onPress={() => confirmPhase('Start extra time?', `The clock will restart from ${extraTimeStart}.`, 'start_extra_time', 'Start extra time')} variant="secondary" /> : null}{endMatch}</View>
          : clock.phase === 'extra_time'
            ? <AppButton label="End match" loading={phaseMutation.isPending} onPress={() => confirmPhase('End this match now?', 'Standings will update from this final score.', 'finish_match', 'End match', true)} variant="danger" />
            : <Text style={styles.finished}>Finished matches remain open for corrections.</Text>;
  return <Screen action={<CloseButton />} eyebrow="One-handed admin controls" title="Live scoring">
    {matchQuery.isLoading ? <LoadingState /> : matchQuery.isError || !match ? <ErrorState message={(matchQuery.error as ApiError)?.message ?? 'Match not found.'} onRetry={() => matchQuery.refetch()} /> : <>
      <View style={styles.scoreCard}><View style={styles.statusRow}><MatchStatusIndicator clock={clock} muted={match.status !== 'live'} /><Text style={styles.sync}>Revision {matchQuery.data?.revision}</Text></View><View style={styles.scoreRow}><Text style={styles.team}>{match.home_team?.name}</Text><ScoreLine away={match.away_score} home={match.home_score} /><Text style={[styles.team, styles.away]}>{match.away_team?.name}</Text></View>{match.status === 'live' ? <MatchProgressRail clock={clock} /> : null}{phaseControls}</View>
      {match.status !== 'scheduled' ? <View style={styles.panel}><Text style={styles.heading}>Add event</Text><View style={styles.eventTypes}>{eventGroups.map((option) => <Pressable accessibilityRole="button" accessibilityState={{ selected: group === option.value }} key={option.value} onPress={() => { setGroup(option.value); if (option.value === 'cards') setCardType(null); }} style={({ pressed }) => [styles.eventType, group === option.value && styles.eventTypeActive, pressed && styles.pressed]}>{option.icon ? <Ionicons color={group === option.value ? colors.onAccent : colors.textSecondary} name={option.icon} size={20} /> : <CardsIcon size={20} />}<Text style={[styles.eventLabel, group === option.value && styles.eventLabelActive]}>{option.label}</Text></Pressable>)}</View>
        {group === 'cards' ? <View style={styles.cardChoices}>{cardChoices.map((choice) => <Pressable accessibilityRole="button" accessibilityState={{ selected: cardType === choice.value }} key={choice.value} onPress={() => setCardType(choice.value)} style={({ pressed }) => [styles.cardChoice, cardType === choice.value && styles.cardChoiceActive, pressed && styles.pressed]}><CardIcon color={cardTint(choice.value).fill} size={44} /><Text style={[styles.eventLabel, cardType === choice.value && styles.cardChoiceLabelActive]}>{choice.label}</Text></Pressable>)}</View> : null}
        {awaitingCard ? <Text style={styles.cardHint}>Pick a card to log it.</Text> : <>
        <ChoiceField label="Team" onChange={setTeamId} options={[{ label: match.home_team?.name ?? 'Home', value: match.home_team_id }, { label: match.away_team?.name ?? 'Away', value: match.away_team_id }]} value={teamId} /><ChoiceField label={eventType === 'substitution' ? 'Coming on' : eventType === 'goal' ? 'Scorer' : 'Player (optional)'} onChange={setPlayerId} options={[{ label: 'No player selected', value: '' }, ...eligiblePlayers.filter((player) => player.team_id === teamId).map((player) => ({ label: `#${player.jersey_number ?? '–'} ${player.name}`, value: player.id }))]} value={playerId} />{eventType === 'substitution' || eventType === 'goal' ? <ChoiceField label={eventType === 'goal' ? 'Assisted by (optional)' : 'Coming off'} onChange={setOffPlayerId} options={[{ label: eventType === 'goal' ? 'No assist' : 'No player selected', value: '' }, ...eligiblePlayers.filter((player) => player.team_id === teamId && player.id !== playerId).map((player) => ({ label: `#${player.jersey_number ?? '–'} ${player.name}`, value: player.id }))]} value={offPlayerId} /> : null}{eventType === 'goal' ? <Pressable accessibilityLabel="Scored from a penalty" accessibilityRole="checkbox" accessibilityState={{ checked: isPenalty }} onPress={() => setIsPenalty((current) => !current)} style={({ pressed }) => [styles.penaltyRow, isPenalty && styles.penaltyRowActive, pressed && styles.pressed]}><View style={[styles.penaltyBox, isPenalty && styles.penaltyBoxActive]}>{isPenalty ? <Ionicons color={colors.onAccent} name="checkmark" size={16} /> : null}</View><View style={styles.penaltyCopy}><Text style={styles.penaltyLabel}>Scored from a penalty</Text><Text style={styles.penaltyHint}>Still counts on the scoreline</Text></View></Pressable> : null}<View><Text style={styles.inputLabel}>Minute (optional)</Text><TextInput accessibilityLabel="Event minute" keyboardType="number-pad" maxLength={3} onChangeText={setMinute} placeholder="67" placeholderTextColor={colors.textMuted} style={styles.input} value={minute} /></View><AppButton disabled={!teamId || addEventMutation.isPending} label={addEventMutation.isPending ? 'Saving event' : `Add ${selectedCard?.label ?? eventGroups.find((option) => option.value === group)?.label}`} onPress={() => addEventMutation.mutate()} tint={selectedCard ? cardTint(selectedCard.value) : undefined} />
        </>}
      </View> : null}
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
const stylesheet = (colors: ThemeColors) => StyleSheet.create({ minuteValue: { color: colors.accentSoft, fontSize: theme.type.heading, fontVariant: ['tabular-nums'], fontWeight: '900', minWidth: 52, textAlign: 'right' }, penaltyRow: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.md, minHeight: theme.touch.minimum, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }, penaltyRowActive: { borderColor: colors.accent }, penaltyBox: { alignItems: 'center', borderColor: colors.border, borderRadius: 6, borderWidth: 2, height: 24, justifyContent: 'center', width: 24 }, penaltyBoxActive: { backgroundColor: colors.accent, borderColor: colors.accent }, penaltyCopy: { flex: 1 }, penaltyLabel: { color: colors.textPrimary, fontWeight: '800' }, penaltyHint: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: 2 }, scoreCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.lg, padding: theme.spacing.lg }, statusRow: { flexDirection: 'row', justifyContent: 'space-between' }, sync: { color: colors.textMuted, fontSize: theme.type.caption }, scoreRow: { alignItems: 'center', flexDirection: 'row' }, team: { color: colors.textPrimary, flex: 1, fontWeight: '800' }, away: { textAlign: 'right' }, phaseStack: { gap: theme.spacing.sm }, finished: { color: colors.textMuted, lineHeight: 22, textAlign: 'center' }, panel: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.md, padding: theme.spacing.lg }, heading: { color: colors.textPrimary, fontSize: theme.type.heading, fontWeight: '900' }, eventTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }, eventType: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexGrow: 1, gap: 4, justifyContent: 'center', minHeight: 60, minWidth: '29%', padding: theme.spacing.sm }, eventTypeActive: { backgroundColor: colors.accent, borderColor: colors.accent }, eventLabel: { color: colors.textSecondary, fontSize: theme.type.caption, fontWeight: '800' }, eventLabelActive: { color: colors.onAccent }, cardChoices: { flexDirection: 'row', gap: theme.spacing.sm }, cardChoice: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 2, flex: 1, gap: theme.spacing.xs, justifyContent: 'center', minHeight: 96, padding: theme.spacing.sm }, cardChoiceActive: { backgroundColor: colors.highlightedSurface, borderColor: colors.accent }, cardChoiceLabelActive: { color: colors.textPrimary }, cardHint: { color: colors.textMuted, fontSize: theme.type.caption, textAlign: 'center' }, pressed: { opacity: 0.7 }, inputLabel: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '700', marginBottom: theme.spacing.xs }, input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, color: colors.textPrimary, fontSize: theme.type.body, minHeight: 52, paddingHorizontal: theme.spacing.md }, event: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, flexDirection: 'row', gap: theme.spacing.sm, padding: theme.spacing.md }, eventCopy: { flex: 1 }, eventTitle: { color: colors.textPrimary, fontWeight: '800', textTransform: 'capitalize' }, eventMeta: { color: colors.textMuted, marginTop: 3 }, help: { color: colors.textMuted, lineHeight: 21 }, rosterRow: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: theme.radius.md, flexDirection: 'row', gap: theme.spacing.sm, minHeight: 64, padding: theme.spacing.sm }, check: { alignItems: 'center', borderColor: colors.border, borderRadius: theme.radius.sm, borderWidth: 1, height: 44, justifyContent: 'center', width: 44 }, checkActive: { backgroundColor: colors.accent, borderColor: colors.accent }, minuteInput: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.sm, borderWidth: 1, color: colors.textPrimary, height: 44, textAlign: 'center', width: 54 } });
