import { Image, StyleSheet } from 'react-native';

export function BrandMark() {
  return <Image accessibilityLabel="AIMZ Egypt logo" accessibilityRole="image" resizeMode="contain" source={require('../../assets/branding/logo.png')} style={styles.logo} />;
}

const styles = StyleSheet.create({
  logo: { height: 150, width: 156 },
});
