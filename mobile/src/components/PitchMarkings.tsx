import { StyleSheet, View } from 'react-native';

import { theme } from '@/src/theme';

/** Pitch green, deliberately the one non-navy surface in the app. */
export const PITCH = '#15603C';
export const PITCH_LINE = '#2E7C55';

/**
 * The pitch itself: the green, and the lines painted on it.
 *
 * Shared by the team sheet a match shows and the one a lineup is picked on, so
 * the two are the same pitch rather than two drawings kept in step by hand.
 * Children are laid over it and positioned against these markings.
 */
export function PitchMarkings({ label, children }: { label: string; children: React.ReactNode }) {
  return <View accessibilityLabel={label} style={styles.pitch}>
    {/* Markings first, so everything else draws on top of them. */}
    <View accessibilityElementsHidden style={styles.halfway} />
    <View accessibilityElementsHidden style={styles.circle} />
    <View accessibilityElementsHidden style={styles.centreSpot} />
    <View accessibilityElementsHidden style={styles.penaltyBox} />
    {/* Only the top of this circle clears the wrapper, which is the arc. */}
    <View accessibilityElementsHidden style={styles.arcWindow}><View style={styles.arc} /></View>
    <View accessibilityElementsHidden style={styles.sixYardBox} />
    {children}
  </View>;
}

const styles = StyleSheet.create({
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
});

/**
 * Where each outfield row sits, as a share of the pitch height, back row first.
 *
 * The numbers are the markings: 67% is the top of the penalty box, so the back
 * line stands on the eighteen-yard line, and 50% is the halfway line, so the
 * midfield stands on it. Anything further forward is spread above the halfway
 * line. A shape with only two rows keeps its back line on the box and pushes
 * the other row into the attacking half rather than stranding it on halfway.
 */
const ROW_TOPS: Record<number, number[]> = { 1: [50], 2: [67, 36], 3: [67, 50, 28], 4: [67, 51, 35, 19] };
export const KEEPER_TOP = 88;

export function rowTops(count: number): number[] {
  const known = ROW_TOPS[count];
  if (known) return known;
  // Beyond four rows, fall back to an even spread across the same band.
  return Array.from({ length: count }, (unused, index) => 67 - (index * 48) / Math.max(1, count - 1));
}
