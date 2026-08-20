import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/src/theme';

type Props = {
  /** Squad number printed on the shirt. Null falls back to an em dash. */
  number?: number | null;
  size?: number;
  /** Shirt colour. Defaults to the accent these avatars already used. */
  color?: string;
  label?: string;
};

// The number sits on the chest rather than dead centre, because the Ionicons
// shirt has shoulders across its top third and the digits would collide.
const NUMBER_TOP = 0.46;
const NUMBER_SIZE = 0.29;

export function JerseyIcon({ number, size = 48, color = theme.colors.accent, label }: Props) {
  return <View accessibilityElementsHidden={!label} accessibilityLabel={label} style={[styles.wrap, { height: size, width: size }]}>
    <Ionicons color={color} name="shirt" size={size} />
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={[styles.number, { fontSize: Math.round(size * NUMBER_SIZE), top: Math.round(size * NUMBER_TOP) }]}
    >
      {number ?? '—'}
    </Text>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  number: {
    color: theme.colors.onAccent,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    position: 'absolute',
    textAlign: 'center',
    width: '100%',
  },
});
