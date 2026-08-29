import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useAppTheme } from '@/src/theme/ThemeProvider';

/**
 * What glass has to look through.
 *
 * A flat navy gives translucency nothing to show, so the page is left uniform
 * and the surfaces read as flat fills however they are built. Two very diffuse
 * pools — one warm-side blue high up, one cooler and lower — give the material
 * something to pick up as it passes over them.
 *
 * They stay diffuse, but are strong enough to remain visible through a pane;
 * otherwise even a real blur has nothing to refract and reads as a flat fill.
 */
export function GlassBackdrop() {
  const { mode } = useAppTheme();
  const dark = mode !== 'light';
  return (
    <View pointerEvents="none" style={styles.backdrop}>
      <Svg height="100%" width="100%">
        <Defs>
          <RadialGradient cx="22%" cy="12%" id="high" r="70%">
            <Stop offset="0" stopColor="#3B82F6" stopOpacity={dark ? 0.24 : 0.15} />
            <Stop offset="1" stopColor="#3B82F6" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient cx="88%" cy="62%" id="low" r="60%">
            <Stop offset="0" stopColor="#0EA2E7" stopOpacity={dark ? 0.15 : 0.1} />
            <Stop offset="1" stopColor="#0EA2E7" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#high)" height="100%" width="100%" />
        <Rect fill="url(#low)" height="100%" width="100%" />
      </Svg>
    </View>
  );
}

/** The inset `Screen` puts round its content, which this has to reach past. */
const INSET = 24;

const styles = StyleSheet.create({
  // Bled past the page's own inset so the pools reach the screen's edges, and
  // laid behind everything the hub draws.
  backdrop: { bottom: 0, left: -INSET, position: 'absolute', right: -INSET, top: -INSET },
});
