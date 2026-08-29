import { BlurView } from 'expo-blur';
import { useId, type PropsWithChildren } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useAppTheme } from '@/src/theme/ThemeProvider';

/**
 * The material the app's glass surfaces are made of.
 *
 * The blur supplies the translucency, while a broad wash, two diffuse pools of
 * reflected light and a complete inner rim give the material depth. None of
 * those cues is a hard highlight: the surface should read as one pane of glass,
 * not as a flat card with a decorative line across it.
 *
 * Used where the glass look has been asked for — the hub, and a player's own
 * stats. The rest of the app keeps its flat surfaces.
 */

const lightPool = { dark: 0.13, light: 0.44 } as const;
const coolPool = { dark: 0.16, light: 0.09 } as const;
const shadow = { dark: 0.34, light: 0.14 } as const;

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  /** The corner, which the blur has to be clipped to as well as the border. */
  radius: number;
  /** Higher for a surface meant to read as nearer the reader. */
  intensity?: number;
}>;

export function GlassSurface({ style, radius, intensity = 58, children }: Props) {
  const { colors, mode } = useAppTheme();
  const key = mode === 'light' ? 'light' : 'dark';
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const lightId = `glass-light-${id}`;
  const coolId = `glass-cool-${id}`;
  return (
    // The blur clips to the radius only with overflow hidden, and only if the
    // radius is on the same view the blur is.
    <BlurView
      intensity={intensity}
      style={[
        styles.surface,
        {
          backgroundColor: colors.glassSurface,
          borderColor: colors.glassBorder,
          borderRadius: radius,
          shadowOpacity: shadow[key],
        },
        style,
      ]}
      tint={key}
    >
      <Svg height="100%" pointerEvents="none" style={styles.reflection} width="100%">
        <Defs>
          <RadialGradient cx="6%" cy="0%" id={lightId} r="92%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={lightPool[key]} />
            <Stop offset="0.7" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient cx="92%" cy="100%" id={coolId} r="82%">
            <Stop offset="0" stopColor="#0EA2E7" stopOpacity={coolPool[key]} />
            <Stop offset="0.76" stopColor="#0EA2E7" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect fill={`url(#${lightId})`} height="100%" width="100%" />
        <Rect fill={`url(#${coolId})`} height="100%" width="100%" />
      </Svg>
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.innerRim,
          { borderColor: colors.glassHighlight, borderRadius: Math.max(0, radius - 1) },
        ]}
      />
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: 1,
    elevation: 8,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { height: 12, width: 0 },
    shadowRadius: 28,
  },
  reflection: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  innerRim: { borderWidth: StyleSheet.hairlineWidth, opacity: 0.6 },
});
