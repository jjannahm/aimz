import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/src/components/AppButton';
import type { FormationSlot } from '@/src/lib/formationSlots';
import { lineFor, positionName } from '@/src/lib/positions';
import type { PressState } from '@/src/lib/pressState';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import type { Player } from '@/src/types/api';

const LINE_NAMES: Record<string, string> = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Attackers' };

/**
 * Who can fill one place on the pitch.
 *
 * The players listed for that line come first, because that is who is being
 * asked for. Everyone else follows rather than being hidden: a squad rarely has
 * exactly the shape a formation wants, and a coach who cannot field a side has
 * no way out of it.
 */
export function SlotPicker({ slot, squad, taken, chosen, onPick, onClear, onClose }: {
  slot: FormationSlot | null;
  squad: Player[];
  /** Players standing in some other place, who cannot be in two at once. */
  taken: Set<string>;
  chosen: Player | null;
  onPick: (player: Player) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(stylesheet);
  const colors = useColors();
  if (!slot) return null;
  const free = squad.filter((player) => !taken.has(player.id) || player.id === chosen?.id);
  const inLine = free.filter((player) => lineFor(player.position) === slot.line);
  const others = free.filter((player) => lineFor(player.position) !== slot.line);

  const row = (player: Player) => <Pressable
    accessibilityLabel={`${player.name}, ${positionName(player.position)}`}
    accessibilityRole="button"
    accessibilityState={{ selected: player.id === chosen?.id }}
    key={player.id}
    onPress={() => onPick(player)}
    style={({ pressed, hovered }: PressState) => [styles.row, hovered && styles.hovered, pressed && styles.pressed]}
    testID={`pick-${player.id}`}
  >
    <Text style={styles.shirt}>{player.jersey_number ?? '–'}</Text>
    <View style={styles.copy}>
      <Text numberOfLines={1} style={styles.name}>{player.name}</Text>
      <Text numberOfLines={1} style={styles.meta}>{positionName(player.position)}</Text>
    </View>
    {player.id === chosen?.id ? <Ionicons color={colors.accent} name="checkmark" size={18} /> : null}
  </Pressable>;

  return <Modal animationType="fade" onRequestClose={onClose} transparent visible>
    {/* The scrim is a sibling laid under the sheet, not its parent: a sheet
      * inside a pressable scrim is a button inside a button. */}
    <View style={styles.stage}>
      <Pressable accessibilityLabel="Close the list" accessibilityRole="button" onPress={onClose} style={styles.scrim} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <View>
            <Text accessibilityRole="header" style={styles.title}>{positionName(slot.code) || slot.code}</Text>
            <Text style={styles.subtitle}>{LINE_NAMES[slot.line] ?? 'Players'}</Text>
          </View>
          <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={({ pressed }) => pressed && styles.pressed}>
            <Ionicons color={colors.textSecondary} name="close" size={20} />
          </Pressable>
        </View>
        <ScrollView style={styles.list}>
          {inLine.length ? inLine.map(row) : <Text style={styles.empty}>Nobody on this squad is listed as {LINE_NAMES[slot.line]?.toLowerCase() ?? 'this'}.</Text>}
          {others.length ? <>
            <Text style={styles.groupTitle}>Other positions</Text>
            {others.map(row)}
          </> : null}
        </ScrollView>
        {chosen ? <AppButton label={`Take ${chosen.name.split(' ')[0]} out`} onPress={onClear} variant="danger" /> : null}
      </View>
    </View>
  </Modal>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  stage: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: theme.spacing.lg },
  scrim: { backgroundColor: 'rgba(0, 0, 0, 0.5)', bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  sheet: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: theme.radius.lg, borderWidth: 1, gap: theme.spacing.sm, maxHeight: '80%', maxWidth: 360, padding: theme.spacing.md, width: '100%' },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.textPrimary, fontFamily: theme.font.bold, fontSize: theme.type.heading },
  subtitle: { color: colors.textMuted, fontSize: theme.type.caption },
  list: { flexGrow: 0 },
  groupTitle: { color: colors.textMuted, fontFamily: theme.font.bold, fontSize: theme.type.caption, letterSpacing: 0.6, marginTop: theme.spacing.sm, textTransform: 'uppercase' },
  row: { alignItems: 'center', flexDirection: 'row', gap: theme.spacing.sm, minHeight: theme.touch.minimum },
  shirt: { color: colors.textMuted, fontFamily: theme.font.monoBold, textAlign: 'center', width: 24 },
  copy: { flex: 1 },
  name: { color: colors.textPrimary, fontFamily: theme.font.semibold },
  meta: { color: colors.textMuted, fontSize: theme.type.caption },
  empty: { color: colors.textMuted, lineHeight: 20, paddingVertical: theme.spacing.xs },
  hovered: { opacity: 0.85 },
  pressed: { opacity: 0.6 },
});
