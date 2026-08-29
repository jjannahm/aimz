import { StyleSheet, Text, View } from 'react-native';

import { theme, type ThemeColors } from '@/src/theme';
import { useThemedStyles } from '@/src/theme/ThemeProvider';

type Size = 'hero' | 'row';

type Props = {
  home: number;
  away: number;
  size?: Size;
  /** Set when a parent already announces the score, so it is not read twice. */
  decorative?: boolean;
};

// Each side reserves the same width, so the dash sits on the centre line
// whether the score reads 1–0 or 10–12. The dash is set smaller than the
// digits: at the same size it reads as heavy as a goal tally.
const SIZES = {
  hero: { number: 48, dash: 30, side: 54 },
  row: { number: 22, dash: 15, side: 26 },
} as const;

export function ScoreLine({ home, away, size = 'hero', decorative = false }: Props) {
  const styles = useThemedStyles(stylesheet);
  const scale = SIZES[size];
  const number = [styles.number, { fontSize: scale.number, minWidth: scale.side }];

  return (
    <View
      accessibilityElementsHidden={decorative}
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : `${home} to ${away}`}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      style={styles.line}
    >
      <Text style={[...number, styles.home]}>{home}</Text>
      <Text style={[styles.dash, { fontSize: scale.dash }]}>–</Text>
      <Text style={[...number, styles.away]}>{away}</Text>
    </View>
  );
}

const stylesheet = (colors: ThemeColors) => StyleSheet.create({
  line: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  number: {
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    fontFamily: theme.font.monoBold,
  },
  home: { textAlign: 'right' },
  away: { textAlign: 'left' },
  dash: {
    color: colors.textPrimary,
    fontFamily: theme.font.monoBold,
    paddingHorizontal: theme.spacing.xs,
  },
});
