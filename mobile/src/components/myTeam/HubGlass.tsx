import { BlurView } from 'expo-blur';
import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/src/theme/ThemeProvider';

/**
 * The material the hub's surfaces are made of.
 *
 * Neutral, not blue: what tints it is whatever it is laid over, which is the
 * whole point of the thing. `expo-blur` does the blurring on all three
 * platforms, so this is real translucency rather than a flat fill pretending.
 *
 * Two layers sit over the blur — a wash that lifts it off the page, and a
 * hairline along the top edge standing in for light catching the near side.
 * Both are white at single-figure opacity: any more and it stops reading as
 * glass and starts reading as a card.
 *
 * Scoped to the hub. The rest of the app keeps its own flat surfaces.
 */

/** Dark glass is lifted with white; on a pale page it has to be deepened instead. */
const wash = { dark: 'rgba(255, 255, 255, 0.06)', light: 'rgba(255, 255, 255, 0.55)' } as const;
const rim = { dark: 'rgba(255, 255, 255, 0.12)', light: 'rgba(15, 23, 42, 0.10)' } as const;
const specular = { dark: 'rgba(255, 255, 255, 0.20)', light: 'rgba(255, 255, 255, 0.75)' } as const;

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  /** The corner, which the blur has to be clipped to as well as the border. */
  radius: number;
  /** Higher for a surface meant to read as nearer the reader. */
  intensity?: number;
}>;

export function HubGlass({ style, radius, intensity = 40, children }: Props) {
  const { mode } = useAppTheme();
  const key = mode === 'light' ? 'light' : 'dark';
  return (
    // The blur clips to the radius only with overflow hidden, and only if the
    // radius is on the same view the blur is.
    <BlurView intensity={intensity} style={[styles.surface, { borderColor: rim[key], borderRadius: radius }, style]} tint={key}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: wash[key] }]} />
      <View pointerEvents="none" style={[styles.specular, { backgroundColor: specular[key] }]} />
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  surface: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  // Inset from the corners so the highlight fades out where the radius turns,
  // rather than running flat into it.
  specular: { height: StyleSheet.hairlineWidth, left: '8%', position: 'absolute', right: '8%', top: 0 },
});
