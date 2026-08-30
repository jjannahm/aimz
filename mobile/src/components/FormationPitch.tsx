import { Pressable, StyleSheet, Text, View } from 'react-native';

import { JerseyIcon } from '@/src/components/JerseyIcon';
import { acrossThePitch, lineFor, type PositionLine } from '@/src/lib/positions';
import { theme, type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';
import { formationRows, type Player } from '@/src/types/api';

/** Pitch green, deliberately the one non-navy surface in the app. */
const PITCH = '#15603C';
const PITCH_LINE = '#2E7C55';

type Bucket = PositionLine;

/**
 * Which row of the pitch a player stands in.
 *
 * Positions used to be free text, so this had to read the prose and guess —
 * and only placed a wing-back correctly because "back" happened to be tested
 * before "wing". The vocabulary answers it outright now.
 */
export const bucketFor = lineFor;

/**
 * Lay starters out to match the formation.
 *
 * The shape decides how many stand in each row; players fill those rows in
 * position order, so a squad tagged only by position still lands sensibly
 * without anyone placing each shirt by hand.
 */
export function arrangeByFormation(starters: Player[], formation: string): { keeper: Player[]; rows: Player[][] } {
  const counts = formationRows(formation);
  const keeper = starters.filter((player) => bucketFor(player.position) === 'GK');
  const order: Bucket[] = ['DEF', 'MID', 'FWD'];
  const pool = [
    ...order.flatMap((bucket) => starters.filter((player) => bucketFor(player.position) === bucket)),
  ];
  // Anyone left over (an extra keeper, say) still gets a place rather than vanishing.
  const outfield = [...pool, ...starters.filter((player) => !keeper.includes(player) && !pool.includes(player))];

  const rows: Player[][] = [];
  let index = 0;
  for (const count of counts) {
    rows.push(outfield.slice(index, index + count));
    index += count;
  }
  if (index < outfield.length && rows.length) rows[rows.length - 1]!.push(...outfield.slice(index));
  // Each line is then stood in across the pitch, so a right-back is on the
  // right of the defence rather than wherever the squad list left them.
  return { keeper: keeper.slice(0, 1), rows: rows.map((row) => acrossThePitch(row)) };
}

/**
 * Work out a shape from the players themselves.
 *
 * Lineups saved before formations existed, and any saved during a live match
 * that can no longer be edited, still deserve a pitch. Counting the outfield
 * positions gives the shape they were already playing.
 */
export function inferFormation(starters: Player[]): string | null {
  const outfield = starters.filter((player) => bucketFor(player.position) !== 'GK');
  if (!outfield.length) return null;
  const rows = (['DEF', 'MID', 'FWD'] as const)
    .map((bucket) => outfield.filter((player) => bucketFor(player.position) === bucket).length)
    .filter((count) => count > 0);
  return rows.length >= 2 ? rows.join('-') : String(outfield.length);
}

/**
 * Where each outfield row sits, as a share of the pitch height, back row first.
 *
 * The numbers are the markings: 67% is the top of the penalty box, so the back
 * line stands on the eighteen-yard line, and 50% is the halfway line, so the
 * midfield stands on it. Anything further forward is spread above the halfway
 * line. A shape with only two rows keeps its back line on the box and pushes the
 * other row into the attacking half rather than stranding it on halfway.
 */
const ROW_TOPS: Record<number, number[]> = { 1: [50], 2: [67, 36], 3: [67, 50, 28], 4: [67, 51, 35, 19] };
const KEEPER_TOP = 88;
/** Half a row: jersey, its gap, and the name beneath it. */
const ROW_HALF = 28;

function rowTops(count: number): number[] {
  const known = ROW_TOPS[count];
  if (known) return known;
  // Beyond four rows, fall back to an even spread across the same band.
  return Array.from({ length: count }, (unused, index) => 67 - (index * 48) / Math.max(1, count - 1));
}

export function FormationPitch({ starters, formation, captainId, onSelect }: { starters: Player[]; formation?: string | null; captainId?: string | null; onSelect?: (playerId: string) => void }) {
  const styles = useThemedStyles(stylesheet);
  const shape = formation ?? inferFormation(starters);
  const { keeper, rows } = arrangeByFormation(starters, shape ?? String(Math.max(0, starters.length - 1)));
  // Rows arrive back to front, which is the order they are placed in.
  const tops = rowTops(rows.length);

  return <View accessibilityLabel={`Formation ${shape ?? 'not set'}`} style={styles.pitch}>
    {/* Markings first, so every shirt draws on top of them. */}
    <View accessibilityElementsHidden style={styles.halfway} />
    <View accessibilityElementsHidden style={styles.circle} />
    <View accessibilityElementsHidden style={styles.centreSpot} />
    <View accessibilityElementsHidden style={styles.penaltyBox} />
    {/* Only the top of this circle clears the wrapper, which is the arc. */}
    <View accessibilityElementsHidden style={styles.arcWindow}><View style={styles.arc} /></View>
    <View accessibilityElementsHidden style={styles.sixYardBox} />
    {rows.map((row, rowIndex) => <View key={`row-${rowIndex}`} style={[styles.row, { top: `${tops[rowIndex] ?? 50}%` }]}>
      {row.map((player) => <PitchPlayer captain={player.id === captainId} key={player.id} onSelect={onSelect} player={player} />)}
    </View>)}
    {keeper.length ? <View style={[styles.row, { top: `${KEEPER_TOP}%` }]}>{keeper.map((player) => <PitchPlayer captain={player.id === captainId} key={player.id} onSelect={onSelect} player={player} />)}</View> : null}
    <Text style={styles.badge}>{shape ?? '—'}{formation ? '' : ' · from positions'}</Text>
  </View>;
}

function PitchPlayer({ player, captain = false, onSelect }: { player: Player; captain?: boolean; onSelect?: (playerId: string) => void }) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const firstName = player.name.trim().split(/\s+/u)[0] ?? player.name;
  const shirt = <>
    <View>
      <JerseyIcon color={colors.textPrimary} number={player.jersey_number} size={40} />
      {captain ? <View accessibilityLabel={`${player.name}, captain`} style={styles.armband}><Text style={styles.armbandText}>C</Text></View> : null}
    </View>
    <Text numberOfLines={1} style={styles.playerName}>{firstName}</Text>
  </>;
  // A shirt is only a button where there is somewhere for it to go.
  if (!onSelect) return <View style={styles.player}>{shirt}</View>;
  return <Pressable accessibilityLabel={`${player.name}, open stats`} accessibilityRole="button" onPress={() => onSelect(player.id)} style={({ pressed }) => [styles.player, pressed && styles.pressed]}>{shirt}</Pressable>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  pitch: {
    // Rows are placed against the markings rather than stacked, so the card
    // needs a height of its own to place them in.
    aspectRatio: 0.86,
    backgroundColor: PITCH,
    borderColor: PITCH_LINE,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    minHeight: 300,
    overflow: 'hidden',
  },
  halfway: { backgroundColor: PITCH_LINE, height: 1, left: 0, position: 'absolute', right: 0, top: '50%' },
  centreSpot: { alignSelf: 'center', backgroundColor: PITCH_LINE, borderRadius: 2, height: 4, marginTop: -2, position: 'absolute', top: '50%', width: 4 },
  // The keeper's end. Widths are percentages so the box keeps its proportions at
  // any card width, and each box drops its bottom border to read as open to the
  // goal line rather than as a floating rectangle.
  penaltyBox: { borderColor: PITCH_LINE, borderWidth: 1, borderBottomWidth: 0, bottom: 0, height: '33%', left: '19%', position: 'absolute', right: '19%' },
  sixYardBox: { borderColor: PITCH_LINE, borderWidth: 1, borderBottomWidth: 0, bottom: 0, height: '15%', left: '34%', position: 'absolute', right: '34%' },
  arcWindow: { bottom: '33%', height: 13, left: '38%', overflow: 'hidden', position: 'absolute', right: '38%' },
  arc: { borderColor: PITCH_LINE, borderRadius: 44, borderWidth: 1, bottom: 0, height: 44, position: 'absolute', width: '100%' },
  circle: {
    alignSelf: 'center', borderColor: PITCH_LINE, borderRadius: 34, borderWidth: 1,
    height: 68, marginTop: -34, position: 'absolute', top: '50%', width: 68,
  },
  row: { flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'space-evenly', left: theme.spacing.sm, marginTop: -ROW_HALF, position: 'absolute', right: theme.spacing.sm },
  player: { alignItems: 'center', flex: 1, gap: 2, maxWidth: 92 },
  pressed: { opacity: 0.6 },
  playerName: { color: '#EAF6EF', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  armband: {
    alignItems: 'center', backgroundColor: colors.warning, borderColor: PITCH,
    borderRadius: 9, borderWidth: 1.5, height: 18, justifyContent: 'center',
    position: 'absolute', right: -2, top: -2, width: 18,
  },
  armbandText: { color: colors.onAccent, fontSize: 10, fontWeight: '900', lineHeight: 12 },
  badge: {
    bottom: theme.spacing.xs,
    left: theme.spacing.sm,
    position: 'absolute',
    alignSelf: 'flex-start', color: '#CDE9D9', fontSize: theme.type.caption,
    fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: 0.6,
    paddingLeft: theme.spacing.xs,
  },
});
