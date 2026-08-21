import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

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

export function JerseyIcon({ number, size = 48, color, label }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  const shirt = color ?? colors.accent;
  return <View accessibilityElementsHidden={!label} accessibilityLabel={label} style={[styles.wrap, { height: size, width: size }]}>
    <Ionicons color={shirt} name="shirt" size={size} />
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={[styles.number, { fontSize: Math.round(size * NUMBER_SIZE), top: Math.round(size * NUMBER_TOP) }]}
    >
      {number ?? '—'}
    </Text>
  </View>;
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  number: {
    color: colors.onAccent,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    position: 'absolute',
    textAlign: 'center',
    width: '100%',
  },
});
