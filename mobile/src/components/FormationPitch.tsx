import { StyleSheet, Text, View } from 'react-native';

import { JerseyIcon } from '@/src/components/JerseyIcon';
import { theme } from '@/src/theme';
import { formationRows, type Player } from '@/src/types/api';

/** Pitch green, deliberately the one non-navy surface in the app. */
const PITCH = '#15603C';
const PITCH_LINE = '#2E7C55';

type Bucket = 'GK' | 'DEF' | 'MID' | 'FWD';

/** Players carry free text positions, so map them onto the four rows. */
export function bucketFor(position: string): Bucket {
  const value = position.toLowerCase();
  if (value.startsWith('goal') || value === 'gk') return 'GK';
  if (value.startsWith('def') || value.includes('back')) return 'DEF';
  if (value.startsWith('for') || value.includes('strik') || value.includes('wing')) return 'FWD';
  return 'MID';
}

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
  return { keeper: keeper.slice(0, 1), rows };
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

export function FormationPitch({ starters, formation, captainId }: { starters: Player[]; formation?: string | null; captainId?: string | null }) {
  const shape = formation ?? inferFormation(starters);
  const { keeper, rows } = arrangeByFormation(starters, shape ?? String(Math.max(0, starters.length - 1)));
  // Forwards belong at the top of the pitch, the keeper at the bottom.
  const stacked = [...rows].reverse();

  return <View accessibilityLabel={`Formation ${shape ?? 'not set'}`} style={styles.pitch}>
    <View accessibilityElementsHidden style={styles.halfway} />
    <View accessibilityElementsHidden style={styles.circle} />
    {stacked.map((row, rowIndex) => <View key={`row-${rowIndex}`} style={styles.row}>
      {row.map((player) => <PitchPlayer captain={player.id === captainId} key={player.id} player={player} />)}
    </View>)}
    {keeper.length ? <View style={styles.row}>{keeper.map((player) => <PitchPlayer captain={player.id === captainId} key={player.id} player={player} />)}</View> : null}
    <Text style={styles.badge}>{shape ?? '—'}{formation ? '' : ' · from positions'}</Text>
  </View>;
}

function PitchPlayer({ player, captain = false }: { player: Player; captain?: boolean }) {
  const firstName = player.name.trim().split(/\s+/u)[0] ?? player.name;
  return <View style={styles.player}>
    <View>
      <JerseyIcon color={theme.colors.textPrimary} number={player.jersey_number} size={40} />
      {captain ? <View accessibilityLabel={`${player.name}, captain`} style={styles.armband}><Text style={styles.armbandText}>C</Text></View> : null}
    </View>
    <Text numberOfLines={1} style={styles.playerName}>{firstName}</Text>
  </View>;
}

const styles = StyleSheet.create({
  pitch: {
    backgroundColor: PITCH,
    borderColor: PITCH_LINE,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    gap: theme.spacing.md,
    overflow: 'hidden',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.lg,
  },
  halfway: { backgroundColor: PITCH_LINE, height: 1, left: 0, position: 'absolute', right: 0, top: '50%' },
  circle: {
    alignSelf: 'center', borderColor: PITCH_LINE, borderRadius: 34, borderWidth: 1,
    height: 68, marginTop: -34, position: 'absolute', top: '50%', width: 68,
  },
  row: { flexDirection: 'row', gap: theme.spacing.xs, justifyContent: 'space-evenly' },
  player: { alignItems: 'center', flex: 1, gap: 2, maxWidth: 92 },
  playerName: { color: '#EAF6EF', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  armband: {
    alignItems: 'center', backgroundColor: theme.colors.warning, borderColor: PITCH,
    borderRadius: 9, borderWidth: 1.5, height: 18, justifyContent: 'center',
    position: 'absolute', right: -2, top: -2, width: 18,
  },
  armbandText: { color: theme.colors.onAccent, fontSize: 10, fontWeight: '900', lineHeight: 12 },
  badge: {
    alignSelf: 'flex-start', color: '#CDE9D9', fontSize: theme.type.caption,
    fontVariant: ['tabular-nums'], fontWeight: '900', letterSpacing: 0.6,
    paddingLeft: theme.spacing.xs,
  },
});
