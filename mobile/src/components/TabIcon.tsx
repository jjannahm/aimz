import { Ionicons } from '@expo/vector-icons';
import { View, type ColorValue } from 'react-native';

export type TabIconName = 'manage' | 'matches' | 'players' | 'settings' | 'standings';

type Props = {
  color: ColorValue;
  name: TabIconName;
  size: number;
};

const nativeIconNames: Record<Exclude<TabIconName, 'matches'>, keyof typeof Ionicons.glyphMap> = {
  standings: 'podium-outline',
  players: 'people-outline',
  manage: 'create-outline',
  settings: 'settings-outline',
};

/**
 * A pitch from plain Views, since this project carries no SVG renderer on
 * native. Same construction as {@link FormationPitch}: an outlined box, a
 * halfway line, a centre circle and the two penalty areas. Ionicons has no
 * pitch glyph, and a football stands in for too many other things here.
 */
function MatchesIcon({ color, size }: { color: ColorValue; size: number }) {
  const height = Math.round(size * 0.74);
  const stroke = Math.max(1, Math.round(size * 0.075));
  const circle = Math.round(height * 0.36);
  const box = { borderColor: color, borderWidth: stroke, height: Math.round(height * 0.5), position: 'absolute' as const, top: Math.round(height * 0.25 - stroke), width: Math.round(size * 0.16) };
  return <View accessibilityElementsHidden style={{ alignItems: 'center', borderColor: color, borderRadius: Math.max(2, Math.round(size * 0.08)), borderWidth: stroke, height, justifyContent: 'center', width: size }}>
    <View style={{ backgroundColor: color, height, position: 'absolute', width: stroke }} />
    <View style={{ borderColor: color, borderRadius: circle / 2, borderWidth: stroke, height: circle, width: circle }} />
    <View style={[box, { borderLeftWidth: 0, left: -stroke }]} />
    <View style={[box, { borderRightWidth: 0, right: -stroke }]} />
  </View>;
}

export function TabIcon({ color, name, size }: Props) {
  if (name === 'matches') return <MatchesIcon color={color} size={size} />;
  return <Ionicons accessibilityElementsHidden color={color} name={nativeIconNames[name]} size={size} />;
}
