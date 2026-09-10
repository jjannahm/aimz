import React from 'react';
import { View } from 'react-native';

import { FinancialsPanel } from '@/src/components/player/FinancialsPanel';
import { PersonalDetailsPanel } from '@/src/components/player/PersonalDetailsPanel';
import { SegmentedControl } from '@/src/components/SegmentedControl';

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
export function InformationPanel({ playerId }: { playerId: string }) {
  const [half, setHalf] = React.useState<'details' | 'financials'>('details');
  return <View>
    <SegmentedControl label="Which information" onChange={setHalf} options={HALVES} value={half} />
    {half === 'details' ? <PersonalDetailsPanel playerId={playerId} /> : <FinancialsPanel playerId={playerId} />}
  </View>;
}
