import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import { TeamAvatar } from '@/src/components/TeamAvatar';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Bracket, BracketSlot, Team } from '@/src/types/api';

type Props = {
  bracket: Bracket;
  /** Admin only: draw this round from the group tables or the round before it. */
  onAdvance?: (round: number) => void;
  /** Admin only: a tie has no winner in the data until someone says so. */
  onPickWinner?: (slot: BracketSlot, teamId: string) => void;
  busy?: boolean;
};

/**
 * The knockout bracket, round by round down the screen.
 *
 * A drawn tree needs the width of a desktop; stacking the rounds keeps every
 * tie legible at phone width, which is where this is read.
 */
export function BracketView({ bracket, onAdvance, onPickWinner, busy = false }: Props) {
  const styles = useThemedStyles(stylesheet);
  return (
    <View style={styles.rounds}>
      {bracket.rounds.map((round) => (
        <View key={round.round} style={styles.round}>
          <Text style={styles.roundLabel}>{round.label}</Text>
          <View style={styles.ties}>
            {round.slots.map((slot) => <Tie key={slot.id} onPickWinner={onPickWinner} slot={slot} />)}
          </View>
          {onAdvance ? <AppButton compact disabled={busy} label={round.slots.some((slot) => slot.home_team || slot.away_team) ? `Redraw ${round.label.toLowerCase()}` : `Advance to ${round.label.toLowerCase()}`} onPress={() => onAdvance(round.round)} variant="secondary" /> : null}
        </View>
      ))}
    </View>
  );
}

function Tie({ slot, onPickWinner }: { slot: BracketSlot; onPickWinner?: (slot: BracketSlot, teamId: string) => void }) {
  const styles = useThemedStyles(stylesheet);
  const decided = Boolean(slot.winner_team_id);
  const side = (team: Team | null) => {
    const inner = <Side decided={decided} team={team} winner={slot.winner_team_id === team?.id} />;
    // A drawn tie is settled by the admin: the scoreline cannot say who went
    // through when it ends level, and shootouts are not recorded anywhere.
    if (!onPickWinner || !team) return inner;
    return <Pressable accessibilityHint="Marks this team as going through" accessibilityLabel={`${team.name} wins this tie`} accessibilityRole="button" onPress={() => onPickWinner(slot, team.id)} style={({ pressed }) => pressed && styles.pressed}>{inner}</Pressable>;
  };
  return (
    <View style={styles.tie}>
      {side(slot.home_team)}
      <View style={styles.divider} />
      {side(slot.away_team)}
    </View>
  );
}

function Side({ team, winner, decided }: { team: Team | null; winner: boolean; decided: boolean }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  if (!team) {
    // Before the draw a slot is simply waiting; after it, an empty side means
    // the team that stood here is gone, which is not the same thing.
    return <View style={styles.side}><Text style={styles.pending}>{decided ? 'Withdrawn' : 'To be decided'}</Text></View>;
  }
  return (
    <View style={styles.side}>
      <TeamAvatar badgeStyle={team.badge_style} isAimz={team.is_aimz} logoUrl={team.logo_url} name={team.name} size={28} />
      <Text numberOfLines={1} style={[styles.name, winner && styles.winnerName]}>{team.name}</Text>
      {winner ? <Ionicons accessibilityLabel="Winner" color={colors.leaderAccent} name="checkmark-circle" size={18} /> : null}
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  rounds: { gap: theme.spacing.lg },
  round: { gap: theme.spacing.sm },
  roundLabel: { color: colors.textSecondary, fontFamily: theme.font.bold, fontSize: theme.type.label, letterSpacing: 0.8, textTransform: 'uppercase' },
  ties: { gap: theme.spacing.sm },
  tie: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: theme.radius.md, borderWidth: 1, overflow: 'hidden' },
  side: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: 52, paddingHorizontal: theme.spacing.md },
  divider: { backgroundColor: colors.border, height: StyleSheet.hairlineWidth, marginHorizontal: theme.spacing.md },
  name: { color: colors.textPrimary, flex: 1, fontFamily: theme.font.semibold },
  winnerName: { color: colors.leaderAccent, fontFamily: theme.font.bold },
  pending: { color: colors.textMuted, flex: 1, fontStyle: 'italic' },
  pressed: { opacity: 0.7 },
});
