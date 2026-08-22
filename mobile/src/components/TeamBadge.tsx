import { Ionicons } from '@expo/vector-icons';
import { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';

import { type ThemeColors } from '@/src/theme';
import { useColors, useThemedStyles } from '@/src/theme/ThemeProvider';

/**
 * A shield silhouette, on a 0-100 viewBox: flat-ish top with rounded corners,
 * straight sides, tapering to a point at the bottom. Shared by both badge
 * kinds so an AIMZ crest and an opponent shield read as the same family of
 * mark, just filled differently.
 */
const SHIELD_PATH = 'M8 8 Q50 2 92 8 Q98 10 97 25 L96 55 Q95 75 78 88 Q60 98 50 99 Q40 98 22 88 Q5 75 4 55 L3 25 Q2 10 8 8 Z';

/**
 * The club crest's own colours: navy face, gold edge, white stripes and
 * wordmark.
 *
 * Fixed rather than theme roles, for the same reason `cardPalette` is: a club
 * crest is the club's colours whatever the app's theme is doing, and the light
 * theme would wash the navy out.
 */
const CREST_NAVY = '#1E2A5A';
const CREST_EDGE = '#C9A227';
const CREST_WHITE = '#FFFFFF';
const BORDER_WIDTH = 6;

/** Five bars, evenly spaced, on the same 0-100 viewBox as the shield. */
const STRIPE_X = [20, 31, 42, 53, 64];
const STRIPE_WIDTH = 7.5;
const STRIPE_Y = 22;
const STRIPE_HEIGHT = 36;

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
 * happens to look like. The wordmark stays a plain RN `<Text>` overlay — SVG
 * text has more cross-platform font quirks than RN's for comparatively little
 * gain here, since the shape was the actual quality problem.
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
        <Path d={SHIELD_PATH} fill="none" stroke={colors.textSecondary} strokeWidth={BORDER_WIDTH} />
      </Svg>
      <Ionicons color={colors.textSecondary} name="football" size={Math.round(size * 0.38)} style={{ position: 'absolute', top: Math.round(size * 0.26) }} />
    </View>;
  }

  const detailed = size >= DETAIL_FROM;
  return <View accessibilityElementsHidden style={[styles.wrap, { height: size, width: size }]} testID="badge-aimz">
    <Svg height={size} viewBox="0 0 100 100" width={size}>
      {detailed ? <Defs><ClipPath id={clipId}><Path d={SHIELD_PATH} /></ClipPath></Defs> : null}
      <Path d={SHIELD_PATH} fill={CREST_NAVY} stroke={CREST_EDGE} strokeWidth={BORDER_WIDTH} />
      {detailed ? STRIPE_X.map((x) => (
        <Rect clipPath={`url(#${clipId})`} fill={CREST_WHITE} height={STRIPE_HEIGHT} key={x} width={STRIPE_WIDTH} x={x} y={STRIPE_Y} />
      )) : null}
    </Svg>
    {detailed ? <Text allowFontScaling={false} style={[styles.mark, { fontSize: Math.round(size * 0.19), top: Math.round(size * 0.62) }]}>aimz</Text> : null}
  </View>;
}

const stylesheet = (_colors: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  mark: { color: CREST_WHITE, fontWeight: '900', letterSpacing: 0.2, position: 'absolute', width: '100%', textAlign: 'center' },
});
