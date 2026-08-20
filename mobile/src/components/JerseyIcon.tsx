import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { theme } from '@/src/theme';

type Props = {
  /** Squad number printed on the shirt. Null shows a dash, as elsewhere in the app. */
  number?: number | null;
  size?: number;
  /** Fill for the shirt body. Defaults to the accent already used for these avatars. */
  color?: string;
  label?: string;
};

// Shirt silhouette: collar dip at the top, sleeves out to each side, body below.
const SHIRT = 'M17.5 5.2 24 8.4l6.5-3.2 8 3.9-3.1 8.2-4.1-1.6V43H14.7V15.7l-4.1 1.6-3.1-8.2 8-3.9Z';

export function JerseyIcon({ number, size = 48, color = theme.colors.accent, label }: Props) {
  // The viewBox is 48 wide; keep the number centred on the body as the icon scales.
  const scale = size / 48;
  return <View accessibilityElementsHidden={!label} accessibilityLabel={label} style={[styles.wrap, { height: size, width: size }]}>
    <Svg height={size} viewBox="0 0 48 48" width={size}>
      <Path d={SHIRT} fill={color} />
    </Svg>
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      style={[styles.number, { fontSize: Math.round(15 * scale), top: Math.round(20 * scale) }]}
    >
      {number ?? '–'}
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
  },
});
