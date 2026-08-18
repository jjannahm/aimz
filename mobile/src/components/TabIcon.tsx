import { Ionicons } from '@expo/vector-icons';
import type { ColorValue } from 'react-native';

export type TabIconName = 'manage' | 'matches' | 'players' | 'settings' | 'standings';

type Props = {
  color: ColorValue;
  name: TabIconName;
  size: number;
};

const nativeIconNames: Record<TabIconName, keyof typeof Ionicons.glyphMap> = {
  matches: 'football-outline',
  standings: 'podium-outline',
  players: 'people-outline',
  manage: 'create-outline',
  settings: 'settings-outline',
};

export function TabIcon({ color, name, size }: Props) {
  return <Ionicons accessibilityElementsHidden color={color} name={nativeIconNames[name]} size={size} />;
}
