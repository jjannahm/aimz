import { View, type ViewStyle } from 'react-native';

/**
 * The cards' own colours, and the ink that stays readable on them.
 *
 * These are fixed rather than the theme's `warning` and `error`: a caution is
 * yellow and a sending-off is red whatever the app's theme is doing, and the
 * light theme darkens those roles to stay legible as text — which turns a
 * yellow card brown. The two fills match the dark theme's hues exactly, so
 * nothing moves there. Dark ink clears AA on both (8.3:1 and 4.8:1).
 */
export const cardPalette = {
  yellow: { fill: '#F59E0B', ink: '#0F172A' },
  red: { fill: '#EF4444', ink: '#0F172A' },
} as const;

/**
 * The outline every card is drawn with.
 *
 * It is a fixed ink rather than a theme colour because its real job is to
 * separate the two cards in {@link CardsIcon}, where it sits on top of the
 * yellow card and never touches the screen background.
 */
const OUTLINE = '#0F172A';
const CORNER_MARK = '#FFFFFF';
/** Card proportions, as fractions of the box the icon is asked to fill. */
const CARD_HEIGHT = 0.86;
const CARD_ASPECT = 0.7;

type CardProps = {
  /** Fill colour — a {@link cardPalette} hue. */
  color: string;
  /** Height of the box the card is drawn in. The card itself is a little shorter. */
  size?: number;
  label?: string;
  style?: ViewStyle;
};

/** One referee card, upright. */
export function CardIcon({ color, size = 20, label, style }: CardProps) {
  const height = Math.round(size * CARD_HEIGHT);
  const width = Math.round(height * CARD_ASPECT);
  const outline = Math.max(1, Math.round(height * 0.09));
  const mark = Math.max(1, Math.round(height * 0.08));
  return (
    <View
      accessibilityElementsHidden={!label}
      accessibilityLabel={label}
      style={[
        {
          backgroundColor: color,
          borderColor: OUTLINE,
          borderRadius: Math.max(2, Math.round(height * 0.16)),
          borderWidth: outline,
          height,
          width,
        },
        style,
      ]}
    >
      <View
        style={{
          borderColor: CORNER_MARK,
          borderLeftWidth: mark,
          borderTopLeftRadius: mark,
          borderTopWidth: mark,
          height: Math.round(height * 0.24),
          left: Math.round(width * 0.16),
          position: 'absolute',
          top: Math.round(height * 0.14),
          width: Math.round(width * 0.3),
        }}
      />
    </View>
  );
}

/**
 * The pair, fanned — yellow behind and turned out, red upright in front.
 *
 * Overlap comes from a negative margin rather than absolute positioning so the
 * icon keeps an intrinsic width and sits in a row like any glyph. The red card
 * is the later sibling, which is what paints it on top.
 */
export function CardsIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <View
      accessibilityElementsHidden={!label}
      accessibilityLabel={label}
      style={{ alignItems: 'center', flexDirection: 'row', height: size, justifyContent: 'center' }}
    >
      <CardIcon
        color={cardPalette.yellow.fill}
        size={size * 0.92}
        style={{ marginRight: -Math.round(size * 0.28), transform: [{ rotate: '-22deg' }] }}
      />
      <CardIcon color={cardPalette.red.fill} size={size} style={{ transform: [{ rotate: '5deg' }] }} />
    </View>
  );
}
