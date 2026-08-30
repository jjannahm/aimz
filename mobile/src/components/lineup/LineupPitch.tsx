import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { KEEPER_TOP, PITCH, PitchMarkings, rowTops } from '@/src/components/PitchMarkings';
import { CompactPicker } from '@/src/components/CompactPicker';

import { rowsOfSlots, type FormationSlot } from '@/src/lib/formationSlots';
import type { PressState } from '@/src/lib/pressState';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Player } from '@/src/types/api';

/** Half a slot, so a row sits centred on its line rather than hanging off it. */
const SLOT_HALF = 26;

/**
 * The team sheet as a pitch, with a place for every player a shape asks for.
 *
 * The formation control sits on the pitch it lays out, because the two are one
 * decision: changing the shape is what moves the places about.
 */
export function LineupPitch({ formation, formations, onFormation, slots, assigned, captainId, onSlot, disabled = false }: {
  formation: string | null;
  formations: string[];
  onFormation: (formation: string) => void;
  slots: FormationSlot[];
  /** Who stands in each place, by slot id. */
  assigned: Map<string, Player>;
  captainId: string | null;
  onSlot: (slot: FormationSlot) => void;
  disabled?: boolean;
}) {
  const styles = useThemedStyles(stylesheet);
  const rows = rowsOfSlots(slots);
  const tops = rowTops(rows.length);
  const keeper = slots.find((slot) => slot.row === 0);

  return <View style={styles.stack}>
    <View style={styles.header}>
      <Text style={styles.heading}>Team sheet</Text>
      {/* The same shapes the format offers, in the control that lays them out. */}
      <CompactPicker label="Formation" onChange={onFormation} options={formations} testID="formation-picker" title="Formation" value={formation ?? '—'} />
    </View>
    <PitchMarkings label={`Formation ${formation ?? 'not set'}`}>
      {rows.map((row, index) => <View key={`row-${index}`} style={[styles.row, { top: `${tops[index] ?? 50}%` }]}>
        {row.map((slot) => <Slot disabled={disabled} isCaptain={assigned.get(slot.id)?.id === captainId} key={slot.id} onPress={() => onSlot(slot)} player={assigned.get(slot.id) ?? null} slot={slot} />)}
      </View>)}
      {keeper ? <View style={[styles.row, { top: `${KEEPER_TOP}%` }]}>
        <Slot disabled={disabled} isCaptain={assigned.get(keeper.id)?.id === captainId} onPress={() => onSlot(keeper)} player={assigned.get(keeper.id) ?? null} slot={keeper} />
      </View> : null}
    </PitchMarkings>
  </View>;
}

/** One place: the position it asks for, and whoever is standing in it. */
function Slot({ slot, player, isCaptain, onPress, disabled }: {
  slot: FormationSlot;
  player: Player | null;
  isCaptain: boolean;
  onPress: () => void;
  disabled: boolean;
}) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  const firstName = player ? player.name.trim().split(/\s+/u)[0] ?? player.name : null;
  return <Pressable
    accessibilityHint={disabled ? undefined : 'Opens the players who can fill it'}
    accessibilityLabel={player ? `${slot.code}: ${player.name}` : `${slot.code}, empty`}
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={({ pressed, hovered }: PressState) => [styles.slot, hovered && styles.slotHovered, pressed && styles.pressed]}
    testID={`slot-${slot.id}`}
  >
    <View style={[styles.badge, player ? styles.badgeFilled : styles.badgeEmpty]}>
      {player
        ? <Text style={styles.number}>{player.jersey_number ?? '–'}</Text>
        : <Ionicons accessibilityElementsHidden color={colors.textMuted} name="add" size={18} />}
      {isCaptain ? <View style={styles.armband}><Text style={styles.armbandText}>C</Text></View> : null}
    </View>
    <Text numberOfLines={1} style={styles.code}>{slot.code}</Text>
    {firstName ? <Text numberOfLines={1} style={styles.name}>{firstName}</Text> : null}
  </Pressable>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  header: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, justifyContent: 'space-between' },
  heading: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },

  row: { flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'space-evenly', left: theme.spacing.sm, marginTop: -SLOT_HALF, position: 'absolute', right: theme.spacing.sm },
  slot: { alignItems: 'center', flex: 1, gap: 2, maxWidth: 92 },
  slotHovered: { opacity: 0.85 },

  badge: { alignItems: 'center', borderRadius: 18, borderWidth: 2, height: 36, justifyContent: 'center', width: 36 },
  // An empty place is an outline waiting to be filled; a filled one is solid.
  badgeEmpty: { backgroundColor: 'rgba(0, 0, 0, 0.25)', borderColor: 'rgba(255, 255, 255, 0.45)', borderStyle: 'dashed' },
  badgeFilled: { backgroundColor: colors.accent, borderColor: '#EAF6EF' },
  number: { color: colors.onAccent, fontFamily: theme.font.monoBold, fontSize: theme.type.label },

  code: { color: '#CDE9D9', fontFamily: theme.font.bold, fontSize: 10, letterSpacing: 0.4 },
  name: { color: '#EAF6EF', fontFamily: theme.font.semibold, fontSize: 11, textAlign: 'center' },

  armband: {
    alignItems: 'center', backgroundColor: colors.warning, borderColor: PITCH,
    borderRadius: 9, borderWidth: 1.5, height: 18, justifyContent: 'center',
    position: 'absolute', right: -4, top: -4, width: 18,
  },
  armbandText: { color: colors.onAccent, fontFamily: theme.font.bold, fontSize: 10, lineHeight: 12 },
  pressed: { opacity: 0.6 },
});
