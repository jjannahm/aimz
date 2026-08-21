import { Image, StyleSheet } from 'react-native';

type Props = {
  /** Height in points. The wordmark keeps its own aspect ratio around it. */
  size?: number;
};

const ASPECT = 156 / 150;

export function BrandMark({ size = 150 }: Props) {
  return <Image accessibilityLabel="AIMZ Egypt logo" accessibilityRole="image" resizeMode="contain" source={require('../../assets/branding/logo.png')} style={[styles.logo, { height: size, width: size * ASPECT }]} />;
}

const styles = StyleSheet.create({
  logo: { height: 150, width: 156 },
});
