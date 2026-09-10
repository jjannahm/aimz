import React from 'react';
import { StyleSheet, View } from 'react-native';

import { FinancialsPanel } from '@/src/components/player/FinancialsPanel';
import { PersonalDetailsPanel } from '@/src/components/player/PersonalDetailsPanel';
import { SegmentedControl } from '@/src/components/SegmentedControl';
import { theme } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

const HALVES = [
  { label: 'Personal Details', value: 'details' },
  { label: 'Financials', value: 'financials' },
] as const;

/**
 * The half of a player's profile that is not football.
 *
 * Who she is and what her family owes, on two sub-tabs, exactly as the stats
 * half is arranged — so moving between the two halves of the profile is one
 * gesture and not two ideas. Opens on the details: a page that opens on money
 * reads as a bill.
 *
 * Whether this is offered at all is decided by whoever renders it, and by the
 * API underneath: a manager is refused both of these endpoints outright, and a
 * family is refused anybody's but their own.
 */
const stylesheet = () => StyleSheet.create({
  stack: { gap: theme.spacing.sm },
  // Indented a little as well as separated: the sub-row belongs to the tab
  // above it rather than sitting alongside it.
  subTabs: { paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.xs },
});

export function InformationPanel({ playerId }: { playerId: string }) {
  const styles = useThemedStyles(stylesheet);
  const [half, setHalf] = React.useState<'details' | 'financials'>('details');
  return <View style={styles.stack}>
    {/* Set apart from the main tabs above it, and lighter than them, so the
      * two rows read as a choice inside a choice rather than as one control
      * broken in two. */}
    <View style={styles.subTabs}>
      <SegmentedControl label="Which information" onChange={setHalf} options={HALVES} tone="quiet" value={half} />
    </View>
    {half === 'details' ? <PersonalDetailsPanel playerId={playerId} /> : <FinancialsPanel playerId={playerId} />}
  </View>;
}
