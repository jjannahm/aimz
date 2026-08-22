import { Ionicons } from '@expo/vector-icons';
import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';

import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * A shield silhouette, on a 0-100 viewBox: a three-peak crown top, sides that
 * bulge outward around the middle, tapering to a point at the bottom.
 *
 * Traced from the club's actual crest, not drawn from a description of it:
 * measured pixel-by-pixel from the source image (edge-detected per row/column,
 * averaged to remove JPEG noise, then simplified to these ~40 points), so the
 * proportions are the real ones rather than an approximation of them. Shared
 * by both badge kinds so an AIMZ crest and an opponent shield read as the
 * same family of mark, just filled differently.
 */
const SHIELD_PATH = 'M3.8 12.5 L14.0 3.5 L15.9 3.2 L24.8 5.2 L31.2 5.5 L39.5 4.1 L50.3 0.6 L62.4 4.4 L69.4 5.5 L77.1 5.0 L83.4 3.3 L87.3 3.4 L97.5 13.4 L97.1 13.1 L97.6 15.8 L90.4 24.0 L89.2 29.5 L90.0 33.9 L97.7 49.7 L99.8 56.8 L100.0 64.5 L98.0 71.6 L94.0 77.6 L86.6 83.6 L53.8 98.9 L49.7 100.0 L46.5 98.9 L43.2 96.7 L12.8 83.1 L8.9 80.3 L3.0 72.7 L0.8 66.7 L0.8 56.8 L3.2 48.6 L9.4 37.7 L11.5 29.5 L9.6 22.4 L4.2 15.8 L3.3 13.1 Z';

/**
 * The club crest's own colours: navy face, a muted warm-tan edge (not a
 * saturated gold), white stripes and wordmark. Sampled the same way as the
 * shape — median pixel colour from several interior points, not eyeballed.
 *
 * Fixed rather than theme roles, for the same reason `cardPalette` is: a club
 * crest is the club's colours whatever the app's theme is doing, and the light
 * theme would wash the navy out.
 */
const CREST_NAVY = '#020F4D';
const CREST_EDGE = '#8B8579';
const CREST_WHITE = '#FFFFFF';
const BORDER_WIDTH = 4;

/**
 * Six bars on the same 0-100 viewBox as the shield, measured at their widest
 * row — sitting below the wordmark. `STRIPE_HEIGHT` runs well past where the
 * outer stripes actually end: the shield's own taper clips them shorter than
 * the centre ones, the same way it does in the source crest, rather than each
 * stripe needing its own hand-picked height.
 */
const STRIPE_X = [12.1, 25.5, 39.5, 54.8, 69.4, 83.4];
const STRIPE_WIDTH = 6.3;
const STRIPE_Y = 32.8;
const STRIPE_HEIGHT = 65;

/** Below this the stripes and wordmark are mud, so the crest goes plain. */
const DETAIL_FROM = 40;

type Props = {
  /** AIMZ squads wear the club crest; everyone else gets the neutral shield. */
  isAimz?: boolean;
  size?: number;
};

/**
 * A team's badge: the club crest for AIMZ squads, a plain shield with a ball
 * for everyone else.
 *
 * Always the same crest, home or away — there is nothing here that changes
 * with which side of the fixture it is drawn on.
 *
 * A real vector shield now, not a layered-glyph approximation: the stripes are
 * clipped to `SHIELD_PATH` itself, so they are provably confined to the crest
 * rather than sized to probably fit inside whatever an icon font's glyph
 * happens to look like. The wordmark sits under the top edge, and the stripes
 * fill the shield below it down toward the point. The wordmark stays a plain
 * RN `<Text>` overlay — SVG text has more cross-platform font quirks than
 * RN's for comparatively little gain here, since the shape was the actual
 * quality problem.
 */
export function TeamBadge({ isAimz = false, size = 44 }: Props) {
  const colors = useColors();
  const styles = useThemedStyles(stylesheet);
  // A standings table renders many of these at once. On web react-native-svg
  // draws a real DOM <svg> per instance, and an id shared across siblings is
  // undefined behaviour for a url(#id) reference, so each crest gets its own.
  // React's id contains colons, which are safe in an HTML id but not worth
  // trusting across three different SVG renderers (web DOM, iOS/Android XML).
  const clipId = `crest-face-${useId().replace(/[^a-zA-Z0-9]/gu, '')}`;

  if (!isAimz) {
    // The ball sits slightly high because the shield tapers to a point.
    return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-opponent">
      <Svg height={size} viewBox="0 0 100 100" width={size}>
        <Path d={SHIELD_PATH} fill="none" stroke={colors.textSecondary} strokeLinejoin="round" strokeWidth={BORDER_WIDTH} />
      </Svg>
      <Ionicons color={colors.textSecondary} name="football" size={Math.round(size * 0.38)} style={{ position: 'absolute', top: Math.round(size * 0.3) }} />
    </View>;
  }

  const detailed = size >= DETAIL_FROM;
  return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-aimz">
    <Svg height={size} viewBox="0 0 100 100" width={size}>
      {detailed ? <Defs><ClipPath id={clipId}><Path d={SHIELD_PATH} /></ClipPath></Defs> : null}
      <Path d={SHIELD_PATH} fill={CREST_NAVY} stroke={CREST_EDGE} strokeLinejoin="round" strokeWidth={BORDER_WIDTH} />
      {detailed ? STRIPE_X.map((x) => (
        <Rect clipPath={`url(#${clipId})`} fill={CREST_WHITE} height={STRIPE_HEIGHT} key={x} width={STRIPE_WIDTH} x={x} y={STRIPE_Y} />
      )) : null}
    </Svg>
    {detailed ? <Text allowFontScaling={false} style={[styles.mark, { fontSize: Math.round(size * 0.13), top: Math.round(size * 0.13) }]}>aimz</Text> : null}
  </View>;
}

const stylesheet = (_colors: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  mark: { color: CREST_WHITE, fontWeight: '900', letterSpacing: 0.2, position: 'absolute', width: '100%', textAlign: 'center' },
});
