import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/src/theme';

export function BrandMark() {
  return (
    <View
      accessibilityLabel="AIMZ Egypt placeholder logo"
      accessibilityRole="image"
      style={styles.container}
    >
      <View style={styles.bars}>
        <View style={[styles.bar, styles.barShort]} />
        <View style={[styles.bar, styles.barTall]} />
        <View style={[styles.bar, styles.barMedium]} />
      </View>
      <Text allowFontScaling={false} style={styles.wordmark}>
        aimz
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceRaised,
    borderColor: theme.colors.accent,
    borderRadius: 30,
    borderWidth: 2,
    height: 60,
    justifyContent: 'center',
    width: 60,
  },
  bars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    height: 14,
  },
  bar: {
    backgroundColor: theme.colors.accent,
    borderRadius: 2,
    width: 4,
  },
  barShort: { height: 7 },
  barTall: { height: 14 },
  barMedium: { height: 10 },
  wordmark: {
    color: theme.colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginTop: 2,
  },
});
