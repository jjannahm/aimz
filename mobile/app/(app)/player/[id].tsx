import { useLocalSearchParams } from 'expo-router';

import { CloseButton } from '@/src/components/CloseButton';
import { PlayerStatsPanel } from '@/src/components/PlayerStatsPanel';
import { Screen } from '@/src/components/Screen';

export default function PlayerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Screen action={<CloseButton />} title="Player stats">
    {id ? <PlayerStatsPanel playerId={id} /> : null}
  </Screen>;
}
