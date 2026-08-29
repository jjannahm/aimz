import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { PENALTY_OUTCOMES, SUBSTITUTION_REASONS } from '@/src/types/api';
import type { MatchEvent } from '@/src/types/api';

const eventLabel = { goal: 'Goal', assist: 'Assist', own_goal: 'Own goal', penalty_missed: 'Penalty missed', yellow_card: 'Yellow card', red_card: 'Red card', substitution: 'Substitution' } as const;
const reasonLabel = new Map(SUBSTITUTION_REASONS.map((option) => [option.value, option.label]));
const outcomeLabel = new Map(PENALTY_OUTCOMES.map((option) => [option.value, option.label]));

function eventIcon(type: MatchEvent['type']): keyof typeof Ionicons.glyphMap {
  if (type === 'substitution') return 'swap-horizontal';
  if (type.includes('card')) return 'square';
  if (type === 'own_goal') return 'football-outline';
  return type === 'penalty_missed' ? 'close-circle-outline' : 'football';
}

/**
 * The match as both sides played it.
 *
 * Events hang off a thread down the middle on the side of the team that made
 * them, so the two teams read as two columns under the names in the scoreline
 * above rather than as one list that has to name a team on every row.
 */
export function MatchTimeline({ events, homeTeamId, homeTeamName, awayTeamName, playerNames }: {
  events: MatchEvent[];
  homeTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  playerNames: Map<string, string>;
}) {
  const styles = useThemedStyles(stylesheet);
  return <View style={styles.timeline}>
    <Text style={styles.title}>Timeline</Text>
    {events.length === 0 ? <Text style={styles.empty}>Match events will appear here.</Text> : <View style={styles.thread}>
      {/* One line behind every row, so it reads as a single thread. */}
      <View accessibilityElementsHidden style={styles.threadLine} />
      {events.map((event) => <TimelineRow
        awayTeamName={awayTeamName}
        event={event}
        homeTeamName={homeTeamName}
        isHome={event.team_id === homeTeamId}
        key={event.id}
        playerNames={playerNames}
      />)}
    </View>}
  </View>;
}

function TimelineRow({ event, isHome, homeTeamName, awayTeamName, playerNames }: {
  event: MatchEvent;
  isHome: boolean;
  homeTeamName: string;
  awayTeamName: string;
  playerNames: Map<string, string>;
}) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const teamName = isHome ? homeTeamName : awayTeamName;
  const lead = event.player_id ? playerNames.get(event.player_id) ?? 'Player' : teamName;
  // A goal owns its assist, so the provider sits under the scorer rather than
  // arriving as a row of its own.
  const assist = event.type === 'goal' && event.secondary_player_id ? playerNames.get(event.secondary_player_id) : null;
  const cameOff = event.type === 'substitution' && event.secondary_player_id ? playerNames.get(event.secondary_player_id) : null;
  const tint = event.type === 'red_card' || event.type === 'own_goal' ? colors.error : event.type === 'yellow_card' ? colors.warning : event.type === 'penalty_missed' ? colors.textMuted : colors.accentSoft;
  const minute = event.minute == null ? 'FT' : `${event.minute}'`;
  const align = isHome ? styles.alignRight : styles.alignLeft;

  const copy = <View style={styles.copy}>
    <Text style={[styles.lead, align]}>{lead}{event.type === 'goal' && event.is_penalty ? ' (pen)' : ''}</Text>
    {assist ? <Text style={[styles.sub, align]}>Assist: {assist}</Text> : null}
    {cameOff ? <Text style={[styles.sub, align]}>Off: {cameOff}</Text> : null}
    {event.type === 'substitution' && event.substitution_reason ? <Text style={[styles.sub, align]}>Reason: {reasonLabel.get(event.substitution_reason) ?? event.substitution_reason}</Text> : null}
    {event.type === 'penalty_missed' && event.penalty_outcome ? <Text style={[styles.sub, align]}>{outcomeLabel.get(event.penalty_outcome) ?? event.penalty_outcome}</Text> : null}
    {event.type === 'goal' ? null : <Text style={[styles.kind, align]}>{eventLabel[event.type]}{event.type === 'own_goal' ? ` for ${isHome ? awayTeamName : homeTeamName}` : ''}</Text>}
  </View>;
  const stamp = <Text style={styles.minute}>{minute}</Text>;

  return <View accessibilityLabel={`${minute} ${teamName}, ${eventLabel[event.type]}, ${lead}`} style={styles.row}>
    {/* The half belonging to the other side stays empty, which is what puts
      * each event under the team that made it. */}
    <View style={[styles.half, styles.halfHome]}>{isHome ? <>{copy}{stamp}</> : null}</View>
    <View style={styles.marker}>
      <View style={[styles.icon, { borderColor: tint }]}><Ionicons color={tint} name={eventIcon(event.type)} size={13} /></View>
    </View>
    <View style={[styles.half, styles.halfAway]}>{isHome ? null : <>{stamp}{copy}</>}</View>
  </View>;
}

const MARKER = 28;

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  timeline: { gap: theme.spacing.xs },
  title: { color: colors.textSecondary, fontSize: theme.type.label, fontWeight: '800', letterSpacing: 0.6, marginBottom: 2, textTransform: 'uppercase' },
  empty: { backgroundColor: colors.surface, borderRadius: theme.radius.md, color: colors.textMuted, fontSize: theme.type.label, padding: theme.spacing.md, textAlign: 'center' },

  // Reaches out past the card's padding, since two columns either side of a
  // marker have little enough width to share at phone size.
  thread: { marginHorizontal: -theme.spacing.md, position: 'relative' },
  // Centred on the marker column, behind the rows that sit on it.
  threadLine: { backgroundColor: colors.border, bottom: 0, left: '50%', marginLeft: -0.5, position: 'absolute', top: 0, width: 1 },

  row: { alignItems: 'center', flexDirection: 'row', minHeight: 44, paddingVertical: theme.spacing.xs },
  half: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: theme.spacing.xs },
  halfHome: { justifyContent: 'flex-end' },
  halfAway: { justifyContent: 'flex-start' },

  marker: { alignItems: 'center', justifyContent: 'center', width: MARKER },
  // Ringed and filled, so the shape sits on the thread rather than being cut by it.
  icon: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: 13, borderWidth: 1, height: 26, justifyContent: 'center', width: 26 },

  copy: { flexShrink: 1 },
  lead: { color: colors.textPrimary, fontSize: theme.type.label, fontWeight: '800' },
  sub: { color: colors.textSecondary, fontSize: theme.type.caption, marginTop: 1 },
  kind: { color: colors.textMuted, fontSize: theme.type.caption, marginTop: 1 },
  alignRight: { textAlign: 'right' },
  alignLeft: { textAlign: 'left' },
  minute: { color: colors.accentSoft, fontSize: theme.type.label, fontVariant: ['tabular-nums'], fontWeight: '900' },
});
